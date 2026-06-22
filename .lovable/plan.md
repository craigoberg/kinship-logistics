## Goal

Live `HH:MM:SS` timers on both the creator and acceptor screens, plus a static "total time" once an issue is fully closed. Add the one missing timestamp (`workaround_accepted_at`) so the timer math is honest for both RED and YELLOW flows.

## Timestamp model (after this change)

| Stage | Field | When written |
|---|---|---|
| Issue/escalation opened | `site_issues_register.created_at` (and `operational_escalations.created_at` for RED) | On insert |
| Manager opened the alert (RED only, intermediate) | `operational_escalations.claimed_at` | On claim — kept for ops visibility, NOT used as the "workaround start" |
| **Workaround accepted (NEW)** | `site_issues_register.workaround_accepted_at` | RED: when opener accepts the Manager GO proposal. YELLOW: at issue creation if a `workaround_plan` is supplied. |
| Final fix recorded | `site_issues_register.resolved_at` (already exists) | Governance Hub close |

Reports can then compute:
- Time to workaround = `workaround_accepted_at − created_at`
- Time on workaround = `resolved_at − workaround_accepted_at`
- Total = `resolved_at − created_at`

No new column is needed on `operational_escalations`; the issue row is the system of record for the workaround lifecycle.

## Technical Changes

### 1. Migration `docs/sql/2026-06-23_site_issues_workaround_accepted_at.sql`
```sql
ALTER TABLE public.site_issues_register
  ADD COLUMN IF NOT EXISTS workaround_accepted_at timestamptz;

-- Backfill: any existing rows already at 'workaround_accepted' get NOW().
UPDATE public.site_issues_register
   SET workaround_accepted_at = COALESCE(workaround_accepted_at, updated_at, created_at)
 WHERE status = 'workaround_accepted'
   AND workaround_accepted_at IS NULL;
```
No new RLS / GRANTs — column on existing table.

### 2. Write sites

- `src/lib/data-store.ts` `acceptManagerWorkaroundProposal` (~line 4711): include `workaround_accepted_at: new Date().toISOString()` in the update alongside `status: 'workaround_accepted'` and `workaround_plan`.
- `src/lib/api/site-issues.ts` insert (~line 131): when payload includes a non-empty `workaroundPlan` (YELLOW path), set `workaround_accepted_at: new Date().toISOString()`.

### 3. Read sites (type + mapper)

- `src/lib/api/site-issues.ts`: add `workaroundAcceptedAt: string | null` to `SiteIssue` and `workaround_accepted_at` to the row interface; map in `rowToIssue`.

### 4. New UI primitive `src/components/ui/elapsed-timer.tsx`
- Props: `since: string | null`, `until?: string | null` (freezes the value), `label?: string`, `className?: string`.
- `setInterval(1000)`; cleared when unmounted or `until` becomes set.
- Always renders `HH:MM:SS`; SSR-safe (`--:--:--` until mounted) mirroring `<ClientTime>`.
- Also exports `formatElapsed(ms: number): string` for static displays.
- Returns `null` if `since` is null.

### 5. Creator screen — `src/components/site-day/escalation-lock-banner.tsx`
- Waiting for manager: `<ElapsedTimer since={escalation.createdAt} label="Waiting for Manager" />`
- After workaround accepted (`issue.workaroundAcceptedAt`): show two stacked counters
  - `Workaround active — HH:MM:SS` (since `workaroundAcceptedAt`)
  - `Total open — HH:MM:SS` (since `createdAt`)

### 6. Acceptor screen — `src/components/dashboard/escalation-consultation-modal.tsx`
- Header chip row: `Open — HH:MM:SS` (since `escalation.createdAt`); when `claimedAt` is set, second chip `Claimed — HH:MM:SS` (since `claimedAt`). Purely additive, no logic changes.

### 7. Closed summary — `src/components/site-day/escalation-resolution-panel.tsx` (and any issues-register card showing a resolved issue)
- When `issue.resolvedAt` is set, render static `Total time: {formatElapsed(resolvedAt − createdAt)}`. If `workaroundAcceptedAt` exists, also show `On workaround: {formatElapsed(resolvedAt − workaroundAcceptedAt)}`.

## Out of scope
- No changes to RPCs, RLS, realtime wiring, or ledger entries.
- No timestamp added to `operational_escalations` — `claimed_at` keeps its current "manager opened the alert" meaning.

## Files touched
- `docs/sql/2026-06-23_site_issues_workaround_accepted_at.sql` (new migration)
- `src/lib/data-store.ts` (one update site)
- `src/lib/api/site-issues.ts` (type + insert + mapper)
- `src/components/ui/elapsed-timer.tsx` (new)
- `src/components/site-day/escalation-lock-banner.tsx`
- `src/components/dashboard/escalation-consultation-modal.tsx`
- `src/components/site-day/escalation-resolution-panel.tsx`
