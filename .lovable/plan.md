## Goal
When a Red anomaly is logged in the Day Centre, fire it through the exact same operational-escalation rail that the Bus Walkaround already uses: insert a pending `operational_escalations` row, let the existing `GlobalEscalationInterceptor` pop a non-dismissible Claim modal on every coordinator/manager session, claim it atomically via the existing RPC, and append a `governance.escalation_claimed` ledger receipt with checker name + issue id + manager id.

No new realtime channel and no parallel modal — we reuse the bus-walkaround pipeline (`raiseOperationalEscalation` → `subscribeToEscalationPool` → `claim_operational_escalation` RPC) so the two flows are literally the same code path.

## Schema — `operational_escalations` (additive)

New migration `docs/sql/2026-07-08_escalations_source_link.sql`:
- `ALTER TABLE public.operational_escalations ADD COLUMN source_kind text NULL;`
  Values: `'bus_walkaround'` (default for existing rows via backfill) or `'site_day_red'`.
- `ALTER TABLE public.operational_escalations ADD COLUMN source_issue_id uuid NULL;`
  FK soft-link to `site_issues_register.id`. Nullable so the existing bus rows stay valid.
- Backfill: `UPDATE public.operational_escalations SET source_kind='bus_walkaround' WHERE source_kind IS NULL;`
- Idempotent index: `CREATE INDEX IF NOT EXISTS idx_op_escalations_source ON public.operational_escalations (source_kind, source_issue_id);`

No RLS changes (existing policies already cover `authenticated`).

## Data layer

### `src/lib/data-store.ts`
- Extend `OperationalEscalationRow` and `OperationalEscalation` types with `sourceKind: 'bus_walkaround' | 'site_day_red' | null` and `sourceIssueId: string | null`.
- Update `rowToEscalation` mapper.
- Extend `raiseOperationalEscalation` to accept optional `sourceKind` and `sourceIssueId`, persist them on insert. Default `sourceKind='bus_walkaround'` so existing callers (the dynamic operational form) keep their semantics unchanged with zero edit.

### `src/lib/operational-forms.ts`
- Add `site_day_red → "Day Centre — Red Anomaly"` to `prettyGateLabel`.

## Trigger — `src/components/site-day/log-anomaly-modal.tsx`
In the existing mutation, after `createIssue(payload)` succeeds AND `values.severity === 'red'`:
1. Resolve checker name from `getActiveUserProfile()?.fullName ?? "Day Centre Checker"`.
2. Call `raiseOperationalEscalation({ clearanceId: null, driverName: <checkerName>, vehicleInfo: \`Day Centre · ${issue.issueDescription.slice(0,80)}\`, gateId: "site_day_red", sourceKind: "site_day_red", sourceIssueId: issue.id })`.
3. Wrap in try/catch — if escalation insert fails, surface a toast but DO NOT undo the issue insert. The lock-phase + window CustomEvent path stays unchanged so existing UX (escalation lock banner) still triggers.
4. Remove the now-redundant `window.dispatchEvent("yada:escalation", ...)` only if nothing else listens for it (verify with `rg yada:escalation`); otherwise leave as-is.

The postgres_changes INSERT into `operational_escalations` is what notifies every manager session — no extra broadcast plumbing required.

## Role-gated manager pop-up

Already exists as `GlobalEscalationInterceptor` mounted in `src/routes/__root.tsx` via `RoleAwareGuardians`. Two minimal changes:

### `src/routes/__root.tsx`
In `RoleAwareGuardians`, mount the interceptor only when `role === "coordinator"` (the role normaliser in `data-store.ts` already maps `"manager"` and `"coordinator"` to `"coordinator"`). Drivers no longer see the modal — they never could action it anyway.

### `src/components/dashboard/global-escalation-interceptor.tsx`
- ContextRow labels become source-aware:
  - `sourceKind === 'site_day_red'` → labels: **Reported by / Site / Trigger / Raised**.
  - default → existing **Driver / Vehicle / Failed Gate / Raised**.
- Button copy stays the same ("CLAIM INCIDENT & OPEN CONSULTATION") — the consultation modal already accepts any escalation row.

## Claim audit — `GlobalEscalationInterceptor.handleClaim`
Inside the `if (result.success)` branch, before opening the consultation modal, append a ledger receipt:

```ts
await writeToLedger({
  staff_id: staffId,                                  // manager who claimed
  category: target.sourceKind === 'site_day_red' ? 'CENTRE' : 'VEHICLE',
  severity: 'RED',
  action_type: 'governance.escalation_claimed',
  gps_lat: gps?.lat ?? null,
  gps_lng: gps?.lng ?? null,
  metadata: {
    escalation_id: target.id,
    source_kind: target.sourceKind ?? 'bus_walkaround',
    source_issue_id: target.sourceIssueId,
    checker_name: target.driverName,                  // reporter for site_day, driver for bus
    gate_id: target.gateId,
    manager_staff_id: staffId,
  },
});
```

`tryGetGps()` is already imported via the ledger module; pull it in here as well. Failure is swallowed by `writeToLedger`, so it cannot break the claim flow.

## State synchronisation across manager sessions

Already handled by the existing rail:
- INSERT visible to every subscriber via `subscribeToEscalationPool`.
- RPC `claim_operational_escalation` flips `status='claimed'` + `claimed_by`/`claimed_at` atomically.
- The UPDATE replays through the same channel; `GlobalEscalationInterceptor`'s `useEffect` removes the row from its local queue when `status !== 'pending'`. Other managers' modals disappear automatically.
- The `Exception Hub` and any dashboard listing pending escalations re-render off the same postgres_changes feed.

## Out of scope

- Replacing the existing `EscalationConsultationModal` UI — it already works for any escalation kind.
- Showing the originating Red issue details inside the consultation modal (future polish: deep-link to `site_issues_register` row via `sourceIssueId`).
- Mirroring this for Yellow severities — explicit requirement is Red only.

## Why this shape

- One escalation table = one realtime feed = one Claim modal = one ledger event family. No divergent rails to keep in sync.
- Reuses the proven atomic RPC, so two managers tapping Claim simultaneously cannot double-claim.
- The new `source_kind` / `source_issue_id` columns are additive and default-friendly, so existing bus-walkaround inserts and queries keep working with no edits to callers besides the new optional args.
- Role gate is a one-line conditional in the existing `RoleAwareGuardians`, not a new RBAC layer.