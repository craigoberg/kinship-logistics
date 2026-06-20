## Objective
Add a Fleet Registry + Vehicle Maintenance module that inherits the YADA compliance patterns (RED/YELLOW/GREEN, append-only ledger, Manager-resolved exceptions).

## Discovery — Reuse, Don't Duplicate
`public.transport_assets` already exists (id, name, make_model, rego_plate, passenger_capacity, is_active). The user's "fleet_registry" proposal overlaps with it. Plan: **extend `transport_assets`** with the new compliance fields rather than create a parallel table. This avoids dual sources of truth for vehicle identity and keeps `asset_daily_clearance` joins intact.

---

## 1. Schema Changes

### 1.1 Migration: `docs/sql/2026-07-01_fleet_compliance_fields.sql`
Extend `transport_assets` with compliance metadata:

```sql
ALTER TABLE public.transport_assets
  ADD COLUMN IF NOT EXISTS vin text,
  ADD COLUMN IF NOT EXISTS registration_expiry date,
  ADD COLUMN IF NOT EXISTS service_interval_km integer
    CHECK (service_interval_km IS NULL OR service_interval_km > 0),
  ADD COLUMN IF NOT EXISTS last_service_odo integer
    CHECK (last_service_odo IS NULL OR last_service_odo >= 0),
  ADD COLUMN IF NOT EXISTS last_service_date date,
  ADD COLUMN IF NOT EXISTS deferred_until date;

CREATE UNIQUE INDEX IF NOT EXISTS transport_assets_vin_uniq
  ON public.transport_assets (vin) WHERE vin IS NOT NULL;

CREATE INDEX IF NOT EXISTS transport_assets_rego_expiry_idx
  ON public.transport_assets (registration_expiry)
  WHERE registration_expiry IS NOT NULL;
```

**Field roles**
- `vin` — VIN/chassis number; unique when present (nullable for legacy rows).
- `registration_expiry` — drives Rego dashboard exceptions.
- `service_interval_km` — distance between scheduled services (e.g. 10000).
- `last_service_odo` + `last_service_date` — anchors the next-service calculation. `next_service_due_km = last_service_odo + service_interval_km`, compared against the latest `asset_daily_clearance.start_odometer`.
- `deferred_until` — mirrors the staff_certification "Defer" pattern so Managers can snooze a Yellow flag (max +30 days, enforced in UI).

No new GRANT block needed (existing grants cover the table). RLS already enabled.

---

## 2. Reusing `operational_ledger` for Maintenance Receipts

Mirrors the `CERTIFICATION_RESOLVED` pattern in `src/lib/api/ledger.ts`. New helper `resolveVehicleMaintenance()` and a new `action_type`.

### 2.1 Ledger row shape
```
staff_id     : actor (manager)
category     : 'VEHICLE'
severity     : GREEN (serviced/renewed) | YELLOW (deferred) | INFO (decommissioned)
action_type  : 'VEHICLE_MAINTENANCE_RESOLVED'
gps_lat/lng  : tryGetGps() (mandatory attempt, ARCHITECTURE.md §4.3)
metadata     : {
  subject_type      : 'transport_asset',
  subject_id        : '<asset_id>:<flag_kind>',  // 'rego' | 'service' | 'vin_missing'
  asset_id, asset_name, rego_plate,
  flag_kind         : 'rego' | 'service',
  resolution_type   : 'renewed' | 'serviced' | 'deferred' | 'decommissioned',
  previous_value    : old expiry or last_service_odo,
  new_value         : new expiry or new last_service_odo,
  deferred_until    : ISO date | null,
  evidence_ref      : string | null,   // required only for 'renewed'/'serviced'
  justification     : string,          // min 20 chars, ALWAYS required
  gps_attempted, gps_captured,
  source            : 'resolve_vehicle_maintenance_modal'
}
```

Mirror back to `transport_assets` (update `registration_expiry`, `last_service_odo`, `last_service_date`, or `deferred_until`) in the same call, exactly like `resolveCertification()` mirrors `staff_registry.certifications`.

### 2.2 Compliance properties preserved
- **Append-only** — no UPDATE/DELETE on prior rows. Double-flag collapse is implicit: next dashboard scan reads the mirrored fields and the prior YELLOW/RED disappears.
- **Conditional evidence** (same rule we just shipped for certs): `evidence_ref` required for `renewed`/`serviced`; optional for `deferred`/`decommissioned`. `justification` always required.
- **GPS attempt mandatory**, captured value optional.
- All `ARCHITECTURE.md §2.3` required columns are populated.

---

## 3. Dashboard Exception Linking

Extend `src/hooks/use-exception-feed.ts` with a new `vehicleMaintenance` stream alongside the existing certification/clearance streams. Surfaced inside the existing **OperationsExceptionHub** tile (no new tile — keeps "No News is Good News" philosophy).

### 3.1 Computation rules
For every active `transport_assets` row, evaluate against `today`:

| Condition | Severity | Row Title |
|---|---|---|
| `registration_expiry < today` | **RED** | `Rego EXPIRED · {name}` |
| `registration_expiry` within next 30 days AND `deferred_until` is null or past | **YELLOW** | `Rego due in N days · {name}` |
| `next_service_due_km - latest_odo <= 500` (or odo already past) | **YELLOW** | `Service due · {name}` |
| `deferred_until >= today` | **hidden** (Deferred bucket) | — |
| `vin IS NULL` | **YELLOW** (low priority) | `VIN missing · {name}` |

`latest_odo` is `MAX(start_odometer)` from `asset_daily_clearance` for that asset. Computed via one batched query, same shape as existing feed hooks.

### 3.2 Resolve action
- RED/YELLOW maintenance rows render a "Resolve" button (Manager-only), wired to a new `ResolveVehicleMaintenanceModal` modelled directly on `ResolveCertificationModal`:
  - Resolution types: `Renewed` (rego), `Serviced` (service), `Defer`, `Decommission`.
  - Conditional fields: new rego expiry date / new odometer / defer date / none.
  - Evidence Reference: required for Renewed + Serviced; hidden+optional for Defer/Decommission.
  - Justification: always required, min 20 chars.
- On success: invalidate `transport-assets` + `exception-feed` query caches.

### 3.3 No new ClearanceGate coupling (yet)
RED-rego does **not** auto-ground the vehicle in this phase — grounding remains the explicit `operational_escalations` flow. We surface it as a RED dashboard exception so a Manager makes the call. (Future phase can wire `registration_expiry < today` into `ClearanceGate` if requested.)

---

## 4. Files

**New**
- `docs/sql/2026-07-01_fleet_compliance_fields.sql`
- `src/components/dashboard/resolve-vehicle-maintenance-modal.tsx`
- `src/lib/api/fleet.ts` — `listFleet()`, `updateFleetAsset()`, `getLatestOdometer(assetId)`.

**Edited**
- `src/lib/api/ledger.ts` — add `resolveVehicleMaintenance()` + `VehicleResolutionType` exports.
- `src/lib/data-store.ts` — extend `TransportAsset` type with new compliance fields.
- `src/hooks/use-exception-feed.ts` — add `vehicleMaintenance` stream and merge into hub feed.
- `src/components/dashboard/OperationsExceptionHub.tsx` — render new rows + wire Resolve button.

**Out of scope (future phases)**
- Fleet Registry admin CRUD screen (read/write UI for the new fields). This plan ships dashboard surfacing + Resolve workflow; bulk editing of VIN/intervals can land in a follow-up.
- Auto-grounding on expired rego.
- Recurring service schedule (uses simple interval-from-last-service math for now).

---

## 5. Verification
- Insert a `transport_assets` row with `registration_expiry = today + 10 days` → appears as YELLOW "Rego due in 10 days".
- Set `registration_expiry = today - 1` → appears as RED "Rego EXPIRED".
- Resolve via Renewed with future date + evidence + justification → ledger row written with `action_type='VEHICLE_MAINTENANCE_RESOLVED'`, asset `registration_expiry` updated, dashboard clears.
- Resolve via Defer (no evidence) → ledger row has `evidence_ref: null`, `deferred_until` set, row hidden until that date passes.