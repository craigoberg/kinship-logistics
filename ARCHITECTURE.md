# ARCHITECTURE.md — NDIS Safety & Compliance System

This document is the master reference for all future feature development. Every change must align with the safety model described below.

---

## 1. The Trust Model (Red / Yellow / Green)

| State | Meaning | Action |
|-------|---------|--------|
| **RED** (Grounded / Escalation) | Severity-1 fault. Hard block on all operations. | Requires Manager "Super-Resolution" via an audit-logged form. No workaround, no bypass. |
| **YELLOW** (Caution) | Operational notice. Does not block flow. | Must be logged to the General Ledger. |
| **GREEN** (Clear) | Standard operating state. | Normal operations proceed. |

Rules:
- RED state is absolute. If any subsystem reports RED, the gate stays closed until a Manager resolves it.
- YELLOW must never be ignored. It is the early-warning signal that prevents RED.

---

## 2. The General Ledger (Immutable Audit Trail)

### 2.1 Source of Truth
All critical state changes must generate a receipt in `public.operational_ledger`:
- Vehicle walkarounds (pre-trip / post-trip)
- Escalation raised / resolved
- Trip starts and ends
- Client events (medication, behaviour, incident)

### 2.2 Immutability
The ledger is **append-only**.
- **Never UPDATE a ledger row.**
- **Never DELETE a ledger row.**
- If a correction is needed, write a new reversing entry with `action_type = 'CORRECTION'` and reference the original `id` in `metadata`.

### 2.3 Compliance Requirements
Every ledger entry **must** include:
- `staff_id` — who performed the action
- `category` — domain classification (e.g. `VEHICLE`, `CLIENT`, `TRIP`, `MEDICATION`)
- `severity` — `RED`, `YELLOW`, or `GREEN`
- `action_type` — machine-readable verb (e.g. `VEHICLE_GROUNDED`, `VEHICLE_RELEASED`, `TRIP_STARTED`)
- `metadata` — JSONB payload with context, notes, and references
- `gps_lat` / `gps_lng` — GPS coordinates (attempted on every write; null if permission denied)

### 2.4 Writing to the Ledger
Use the canonical helper `writeToLedger()` in `src/lib/api/ledger.ts`. It wraps the Supabase insert and handles GPS capture automatically via `tryGetGps()`.

---

## 3. The Escalation Loop

### 3.1 No Loopholes
If a vehicle is **Grounded** (`RED`), the `ClearanceGate` must block rendering of any trip, manifest, or route view for that asset. The UI must surface the grounding prominently and route the user to resolution.

### 3.2 Double-Grounding
A vehicle is a single asset. Multiple concurrent `resolved_denied` escalations for the same vehicle must be treated as one logical grounding:
- The Coordinator dashboard deduplicates by `vehicleInfo`, showing only the latest active denial.
- When a Manager resolves the grounding, all pending denials for that vehicle must be superseded (`resolved_superseded`) so the vehicle cannot re-ground on stale data.
- The ledger receipt for the resolution must record `superseded_older_count` in `metadata`.

### 3.3 Resolution Flow
1. Manager opens **Unground Vehicle** modal.
2. Enters **Safety Clearance Notes** (minimum 20 characters).
3. System attempts GPS capture.
4. System updates the escalation to `resolved_approved`.
5. System supersedes older denials for the same vehicle.
6. System writes a `VEHICLE_RELEASED` receipt to the ledger.
7. Toast confirmation; vehicle returns to `GREEN`.

---

## 4. Future Modules (Start Day, Events, Pickups)

All new modules must adopt the following patterns:

### 4.1 Receipt Hook Pattern (`useLedgerLogger`)
Every high-impact action must be receipted to the ledger. Wrap business-logic mutations with a logger that fires `writeToLedger()` on success, failure, or state transition.

### 4.2 Red-State Integration
If an action triggers a `RED` state, the module must integrate with the standard **Route Guard** (`manifest.tsx`) to trigger an immediate block. Do not invent custom blocking logic; reuse the shared gate.

### 4.3 GPS Awareness
Any action that changes operational state must attempt GPS capture. If the browser denies permission, the ledger entry records `null` coordinates — that is acceptable. Skipping the attempt is not.

---

## 5. Enforcement

- **Code Review Checklist:** Does this PR touch a state transition? If yes, is there a ledger receipt?
- **Lint Rule (aspirational):** All mutations to `operational_escalations`, `asset_daily_clearance`, or `trip` tables must be paired with a ledger call.
- **Migration Policy:** Any schema change to the ledger or escalation tables requires an accompanying update to this document.

---

*Last updated: 2026-06-20*
