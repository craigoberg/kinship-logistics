## Problem

The Hub keeps showing rows tagged `Escalation · Workaround — awaiting operator ack` (status `resolved_approved`, `operator_acknowledged_at IS NULL`). These are test escalations from the old manager-approval flow. They can't be cleared from the UI because the only way to drop `operator_acknowledged_at` is the driver's PIN handshake on the original device, which is no longer available for these test rows. `resolveUnifiedIssue` deliberately leaves the ack NULL for non-Day-Centre escalations (see `src/lib/api/unified-issues.ts` lines 472–502), so re-resolving them does nothing.

## Plan

### 1. One-off SQL cleanup (clears the current backlog)

New migration `docs/sql/2026-07-14c_ack_stale_escalations.sql`:

```sql
-- Force-acknowledge any escalation that was already manager-approved
-- but never received the on-site operator PIN ack. This clears stale
-- test rows from the Governance Hub. Safe because status is already
-- resolved_approved — no live shield is being dropped on a real incident.
UPDATE public.operational_escalations
SET    operator_acknowledged_at = COALESCE(operator_acknowledged_at, now()),
       operator_acknowledged_by = COALESCE(operator_acknowledged_by, resolved_by)
WHERE  status = 'resolved_approved'
  AND  operator_acknowledged_at IS NULL;
```

User runs this once in the Supabase SQL editor. The three Toyota Coaster rows in the screenshot disappear from the Hub immediately.

### 2. Manager-only "Force dismiss" path (prevents recurrence)

In `resolve-issue-dialog.tsx`, when the issue is an `escalation` row already in `resolved_approved` + awaiting ack, show a single "Force-acknowledge (Manager)" button alongside Log Note. It writes `operator_acknowledged_at = now()` / `operator_acknowledged_by = staffId` to `operational_escalations` and appends a ledger note `[FORCE-ACK by <staff>]: <reason>`. Gate behind `has_role(..., 'admin')` check already used elsewhere; require a non-empty reason (≥10 chars) so the Compliance Shield ledger entry is valid.

No change to the normal pre-trip driver-ack flow — that still requires the driver PIN.

### Files touched

- new `docs/sql/2026-07-14c_ack_stale_escalations.sql` (one-time backlog clear)
- `src/lib/api/unified-issues.ts` — add `forceAckEscalation({ id, staffId, reason })`
- `src/components/admin/resolve-issue-dialog.tsx` — render Force-ack button when `source === 'escalation'` and status is `resolved_approved` awaiting ack, manager-only

After step 1 the screenshot list clears; step 2 is the future-proof control so this can't strand rows again.