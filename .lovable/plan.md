# Compliance Governance Engine

Centralize every "thing that expires" (rego, certs, insurance, equipment audits, council inspections…) into one registry. The dashboard, the admin CRUD UI, and the Resolve modals all read from this one table and dispatch off a per-asset `action_module` key.

## 1. Schema — `docs/sql/2026-07-06_compliance_governance.sql`

```text
public.compliance_assets
  id                uuid pk
  category          text     -- 'VEHICLE' | 'STAFF' | 'INSURANCE' | 'EQUIPMENT' | 'FACILITY' | …
  type              text     -- 'rego' | 'service' | 'certification' | 'policy' | 'extinguisher' | …
  name              text     -- "HiAce Bus 1 — Registration"
  description       text
  subject_table     text     -- 'transport_assets' | 'staff_registry' | null
  subject_id        uuid     -- FK-by-convention to row in subject_table; null for standalone
  expiry_date       date
  next_action_at    timestamptz
  action_module     text     -- dispatch key: 'vehicle_rego' | 'vehicle_service' | 'staff_cert'
                             --   | 'formal_audit' | 'insurance_renewal' | 'generic_resolve'
  config            jsonb    -- { yellow_days:30, red_days:7, checklist_category?:'…',
                             --   handshake?:'single'|'dual', notify_roles?:['manager'] }
  status            text     -- 'active' | 'archived'
  created_by        uuid, created_at timestamptz, updated_at timestamptz
```

Indexes: `(status, next_action_at)`, `(category)`, `(action_module)`, `(subject_table, subject_id)`.

RLS: `SELECT` for `authenticated`; `INSERT/UPDATE` gated by `has_role(auth.uid(),'manager')`; `service_role` full. GRANTs per house rules.

Audit trigger: on `INSERT/UPDATE/DELETE`, append a `COMPLIANCE_ASSET_CHANGE` row to `operational_ledger` with `{op, before, after, actor}` in metadata. (Mirrors the `system_parameters` change-log pattern.)

Seed migration: backfill existing rego/service rows from `transport_assets` and existing cert rows from `staff_registry.certifications` so the dashboard keeps showing them after the cutover.

## 2. API — `src/lib/api/compliance-assets.ts`

- `listComplianceAssets({ category?, status? })` — ordered by `next_action_at`.
- `getComplianceAsset(id)`.
- `upsertComplianceAsset(input, justification)` — manager-only; writes ledger entry server-side via trigger.
- `archiveComplianceAsset(id, justification)`.
- `computeRyge(asset, today)` — pure helper returning `'green'|'yellow'|'red'` from `expiry_date` + `config.yellow_days/red_days`.

## 3. Dashboard dispatch

New hook `useComplianceExceptions()` in `src/hooks/use-exception-feed.ts`:
- Fetches `compliance_assets` where `status='active'`.
- Applies `computeRyge` to derive `severity` (`red→critical`, `yellow→warning`, `green→filtered`).
- Groups by `category` so existing tiles (Vehicle, Staff, Asset & Liability, plus new ones) stay shaped the same.
- Returns rows carrying `actionModule` + `config` + raw asset for the Resolve button.

`OperationsExceptionHub.tsx`:
- Replaces `useVehicleMaintenanceExceptions`, `useStaffCertificationExceptions`, and the `ASSET_LIABILITY_PLACEHOLDERS` feed with a single `useComplianceExceptions()` consumer that groups by `category`.
- Tile list is derived from distinct categories present in the registry — so adding a new category in the DB lights up a new tile with no code change. Icon/label resolved via a small `CATEGORY_PRESENTATION` map with a generic fallback.
- The Resolve button calls a new `dispatchResolveModal(asset)` that maps `action_module` → modal:
  - `vehicle_rego` / `vehicle_service` → existing `ResolveVehicleMaintenanceModal`
  - `staff_cert` → existing `ResolveCertificationModal`
  - `formal_audit` → existing `ResolveVehicleMaintenanceModal` pre-set to Formal Audit (reads `config.checklist_category`)
  - `insurance_renewal` / `generic_resolve` → new lightweight `ResolveComplianceAssetModal` (date picker + justification + dual/single PIN per `config.handshake`)
- Existing modals already write `operational_ledger`; the dispatcher passes `compliance_asset_id` through so each resolution is linked back.

## 4. Admin "Governance Hub" tab

New component `src/components/admin/governance-hub-workspace.tsx`, surfaced as a second tab next to `SystemParameterWorkspace` inside `src/routes/admin.tsx`.

Features:
- Table of all `compliance_assets` (filter by category/status, sort by `next_action_at`, RYGE pill).
- "New asset" + "Edit asset" dialog with fields:
  - Category (free-text combobox seeded from existing categories — typing a new value creates a new tile)
  - Type, Name, Description
  - Subject link (optional asset/staff picker)
  - Expiry date, Next action at
  - **Action Module** select (drives which Resolve modal the dashboard opens)
  - **RYGE thresholds** (`yellow_days`, `red_days` numeric inputs writing into `config`)
  - Optional `checklist_category` (for Formal Audit), handshake mode
  - Justification textarea (min 10 chars, recorded in ledger via trigger)
- Archive action with confirm + justification.

## 5. Audit guarantees

- DB trigger writes a `COMPLIANCE_ASSET_CHANGE` ledger row on every `INSERT/UPDATE/DELETE` with full before/after snapshots and actor `auth.uid()`.
- Every Resolve modal already appends its own `operational_ledger` entry; we extend the metadata to include `compliance_asset_id` so the asset's full lifecycle (created → warned → resolved → renewed) is queryable from one ledger view.

## 6. Files

New:
- `docs/sql/2026-07-06_compliance_governance.sql`
- `src/lib/api/compliance-assets.ts`
- `src/components/admin/governance-hub-workspace.tsx`
- `src/components/dashboard/resolve-compliance-asset-modal.tsx`
- `src/lib/dashboard/dispatch-resolve-modal.tsx` (or inline in the Hub)

Edited:
- `src/hooks/use-exception-feed.ts` — add `useComplianceExceptions`, deprecate the per-source hooks once parity is verified.
- `src/components/dashboard/OperationsExceptionHub.tsx` — derive buckets from registry, route Resolve via dispatcher.
- `src/routes/admin.tsx` — add "Governance Hub" tab.
- `PROJECT_CONTEXT.md` / `ARCHITECTURE.md` — document the registry-driven dashboard pattern.

## 7. Rollout

1. Ship migration + seed (read-only parity with current dashboard).
2. Ship Governance Hub CRUD (managers can curate without touching the dashboard yet).
3. Flip dashboard to `useComplianceExceptions()` once seed parity is confirmed; remove the legacy per-source hooks in a follow-up once no callers remain.
