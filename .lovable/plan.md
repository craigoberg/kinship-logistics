## Manifest/Pre-Trip → Unified Issue/Escalation Engine (Final Wiring)

Execute the five steps strictly in order. No file deletions this pass.

### 1. Database Schema Alignment
- Re-run idempotent migration `docs/sql/2026-06-28_asset_clearance_columns_retest.sql` (already authored in prior turn) to add to `public.asset_daily_clearance`:
  - `accumulated_issues text`
  - `driver_comfort_declared boolean`
  - `requires_manager_review boolean`
  - dual-PIN handshake columns (`driver_auth_staff_id`, `manager_auth_pin_verified_at`)
  - status check constraint + realtime publication
- Force PostgREST schema cache reload (`NOTIFY pgrst, 'reload schema'`) so the frontend stops getting PGRST204.

### 2. Swap Manifest Route Engine
- In `src/routes/manifest.tsx` → `IssueAccumulatorGate`:
  - Remove the `IssueAccumulatorPanel` invocation that still wraps the legacy `DynamicOperationalForm` path.
  - Mount `LogAnomalyModal` with `context={{ kind: "pre-trip", assetId, dateStr, driverStaffId }}` opened from a primary "Inspect vehicle" CTA.
  - GREEN/YELLOW: accumulate into local draft array (namespaced storage key `pre-trip-anomaly:${assetId}:${dateStr}`), flushed into `asset_daily_clearance.accumulated_issues` on submit via `insertAssetClearanceWithItems`.
  - RED: bypass clearance write; call `raiseOperationalEscalation({ gateId: "pre_trip_red", sourceKind: "bus_walkaround", raisedBy: driverStaffId, assetId })`. Screen swaps to `RedHandshakeWaitingPanel` via existing `getActiveEscalation` poll + `subscribeToEscalationPool` rehydration already wired in the route.

### 3. Active Issues Register at Top of Pre-Trip
- Reuse existing unified hook `useUnifiedIssues` / `src/lib/api/unified-issues.ts`.
- Mount a shared `<ActiveIssuesRegister vehicleAssetId={assetId} />` at the top of the manifest pre-trip screen, above the inspect CTA.
  - If component does not yet exist as a standalone, extract it from `src/components/admin/unified-issues-panel.tsx` into `src/components/issue-engine/active-issues-register.tsx` with a `vehicleAssetId` filter prop. Admin panel re-uses the new shared component (no behaviour change).
- Behaviour:
  - Carried-over RED with active YELLOW workaround → register shows "Workaround in force"; primary checkout stays unlocked.
  - Carried-over RED without workaround → checkout remains locked via existing escalation gate.
  - Duplicate-suppression: when opening `LogAnomalyModal`, pass the active register entries; if driver selects a checkpoint/fault matching an existing unresolved entry, modal shows "Already reported — see register above" and blocks submission.

### 4. Unified UI Tokens
- Audit textareas on `manifest.tsx`, `issue-accumulator-panel.tsx`, `log-anomaly-modal.tsx` (pre-trip branch), and `verbal-auth-override-dialog.tsx`. Replace any raw `<Textarea>` for description/workaround with `<CharacterCountedTextarea minLength={20} />` so we get:
  - X/Y countdown
  - Solid blue progress line
  - Thick red border for missing required fields
- Confirm `VerbalAuthOverrideDialog` is reachable from `RedHandshakeWaitingPanel` on the driver wait screen (trigger button "Manager unreachable — verbal override").

### 5. Preservation
- `src/components/manifest/dynamic-operational-form.tsx` stays on disk, unimported by `manifest.tsx`. No deletion.

### Verification
- Reproduce original failure: open `/manifest`, log a RED defect → expect 201 on `asset_daily_clearance`, new row in `operational_escalations`, screen swaps to `RedHandshakeWaitingPanel`.
- GREEN-only submit clears the bus.
- Active register populates from a seeded unresolved issue; duplicate report is blocked.
- Build clean, no console PGRST204.

### Files
- Migration: re-run `docs/sql/2026-06-28_asset_clearance_columns_retest.sql` (+ append `NOTIFY pgrst, 'reload schema'` if missing).
- Edit: `src/routes/manifest.tsx`, `src/components/manifest/issue-accumulator-panel.tsx`, `src/components/site-day/log-anomaly-modal.tsx` (duplicate-suppression prop), `src/components/manifest/red-handshake-waiting-panel.tsx` (verbal override CTA).
- Create: `src/components/issue-engine/active-issues-register.tsx` (extracted shared component).
- Refactor: `src/components/admin/unified-issues-panel.tsx` to consume the shared register.
- Preserved: `src/components/manifest/dynamic-operational-form.tsx`.
