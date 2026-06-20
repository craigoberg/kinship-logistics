# Dashboard → Compliance Registry Cutover

Replace the legacy expiry-driven dashboard hooks with a single registry-driven feed. Operational tiles (Medication, On-Road, Day Anomaly) are out of scope — they're live operational signals, not "things that expire." Only the three expiry tiles (Vehicle Compliance, Staff Certifications, Asset & Liability Insurance) are cut over.

## 1. Parity backfill — `docs/sql/2026-07-07_compliance_assets_backfill.sql`

One idempotent SQL migration mirrors existing live data into `compliance_assets` so nothing disappears on cutover:

- For each `transport_assets` row with `registration_expiry`: insert a `category='VEHICLE'`, `type='rego'`, `action_module='vehicle_rego'`, `subject_table='transport_assets'`, `subject_id=<asset.id>`, config `{yellow_days: rego_threshold_days, red_days: 7}`.
- For each `transport_assets` row with `last_service_date`/scheduled service: insert `type='service'`, `action_module='vehicle_service'` (expiry derived from `last_service_date + service interval` if available; otherwise null and we surface only when next_action_at is populated).
- For each `staff_registry.certifications` JSONB entry with `expiry`: insert `category='STAFF'`, `type='certification'`, `action_module='staff_cert'`, `subject_table='staff_registry'`, `subject_id=<staff.id>`, name `"<Staff Name> · <Cert Name>"`, config `{yellow_days: cert_threshold_days, red_days: 7, cert_name: <name>}`.
- Guards: `ON CONFLICT`-style via `WHERE NOT EXISTS (SELECT 1 FROM compliance_assets WHERE subject_table=... AND subject_id=... AND type=... AND (config->>'cert_name' IS NOT DISTINCT FROM ...))` so re-running is safe.

Ongoing sync is *not* automated in this pass — Managers curate via the Governance Hub from now on. Backfill keeps current items visible; new vehicles/certs entered via the existing UIs are surfaced via the Hub. (A follow-up migration can add DB triggers if the user wants auto-sync.)

## 2. New hook — `useComplianceExceptions()` in `src/hooks/use-exception-feed.ts`

```text
ComplianceExceptionRow {
  key, assetId, category, name, detail, severity,
  actionModule, asset (full ComplianceAsset)
}
```

- Fetch `listComplianceAssets({ status: 'active' })`.
- Compute `severity` via `computeRyge`: red→critical, yellow→warning, green→filtered out.
- `detail` = "Expires in N days (dd/mm/yyyy)" / "EXPIRED Nd ago" derived from `expiry_date` + thresholds, mirroring current cert/rego copy.
- Sort by days-to-expiry ascending (most urgent first).
- Group helper: `groupByCategory(rows) → Map<category, rows[]>`.

## 3. Dispatcher — `src/components/dashboard/dispatch-resolve-modal.tsx`

Single component that owns "open the right modal for `action_module`":

```text
<ResolveDispatcher
  asset={ComplianceAsset}
  open={boolean}
  onClose={()=>void}
  onResolved={()=>void}
/>
```

Internally maps:
- `vehicle_rego` / `vehicle_service` → existing `ResolveVehicleMaintenanceModal` with `ResolveVehicleSubject` built from `asset.subject_id` (looked up against `listFleet()` to fill assetName/regoPlate/latestOdo). flagKind = `'rego'` vs `'service'`.
- `staff_cert` → existing `ResolveCertificationModal` with `ResolveCertSubject` built from `asset.subject_id` + `config.cert_name` + `asset.expiry_date`.
- `formal_audit` → existing `ResolveVehicleMaintenanceModal` pre-set to formal-audit mode (passes `config.checklist_category`).
- `insurance_renewal` / `generic_resolve` → new `ResolveComplianceAssetModal` (date picker for new expiry + justification + single/dual PIN per `config.handshake`). Writes ledger entry `COMPLIANCE_ASSET_RESOLVED` with `compliance_asset_id` and updates `expiry_date` on the asset.

All resolution flows include `compliance_asset_id` in their ledger metadata so each asset's lifecycle is queryable.

## 4. New modal — `src/components/dashboard/resolve-compliance-asset-modal.tsx`

Lightweight generic resolver:
- Renewed-on date (defaults today, past or today)
- New expiry date (required, future)
- Evidence reference (min 6 chars)
- Justification (min 20 chars)
- Manager PIN (single) or Manager + Witness PINs (dual) — verified via `verifyStaffPin` RPC like the formal audit
- On submit: update `compliance_assets.expiry_date` + reset `next_action_at`, then append `COMPLIANCE_ASSET_RESOLVED` ledger row with full snapshot

## 5. Rewire `OperationsExceptionHub.tsx`

- Remove: `useVehicleMaintenanceExceptions`, `useStaffCertificationExceptions`, `ASSET_LIABILITY_PLACEHOLDERS` imports and the three hardcoded buckets (`vehicle`, `staff`, `asset`).
- Add: `useComplianceExceptions()`, group by `category`, render one bucket per category present in the registry.
- `CATEGORY_PRESENTATION` map for icon/label per known category, with a generic fallback (`ShieldCheck` icon + titlecased category) — so a brand-new `'COUNCIL'` category lights up automatically.
- Each row's Resolve button opens `<ResolveDispatcher asset={...} />`.
- Keep medication / on-road / day-anomaly buckets unchanged.
- Bucket order: keep Medication, On-Road, Day Anomaly first (operational), then registry-driven tiles ordered by worst severity → category name.

## 6. Decommission

In the same edit:
- Delete `useVehicleMaintenanceExceptions`, `useStaffCertificationExceptions`, and `ASSET_LIABILITY_PLACEHOLDERS` / `VEHICLE_COMPLIANCE_PLACEHOLDERS` / `STAFF_CERT_PLACEHOLDERS` from `use-exception-feed.ts`.
- Keep `VehicleMaintenanceExceptionRow` / `StaffCertExceptionRow` type exports removed only if no other consumers — `rg` confirms only OperationsExceptionHub uses them.
- Existing `ResolveVehicleMaintenanceModal` and `ResolveCertificationModal` files are kept (dispatcher reuses them).

## 7. Files

New:
- `docs/sql/2026-07-07_compliance_assets_backfill.sql`
- `src/components/dashboard/dispatch-resolve-modal.tsx`
- `src/components/dashboard/resolve-compliance-asset-modal.tsx`

Edited:
- `src/hooks/use-exception-feed.ts` — add `useComplianceExceptions`, remove legacy hooks/placeholders
- `src/components/dashboard/OperationsExceptionHub.tsx` — registry-driven buckets + dispatcher
- `src/lib/api/compliance-assets.ts` — add `resolveComplianceAsset()` helper for the generic modal
- `PROJECT_CONTEXT.md` — update §10 to mark legacy hooks decommissioned

## 8. Risk / Test notes

- Backfill must run **before** the cutover deploy or the dashboard will look empty for live items. Migration is idempotent so safe to re-run.
- `subject_id` lookups in the dispatcher require the fleet/staff data to be present client-side; we'll fetch via the existing `listFleet()` / `listStaffRegistry()` Query keys (already cached by neighbouring tiles).
- If an asset's `subject_id` no longer exists (e.g. a vehicle was deleted but its registry row wasn't archived), the dispatcher falls back to the generic resolve modal and surfaces a "Subject not found — resolve generically" notice.
