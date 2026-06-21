## Goal

Today's session row exists (`phase = 'open_pending'`, id `92fea43e-…`) but `/day` stays on "Loading today's session…". Make the phase routing in `src/components/site-day/day-centre-page.tsx` deterministic so `open_pending` always mounts `<StartOfDayPanel>` once the session is in cache.

## Root cause

Two stacked loading gates can swallow a loaded session:

1. `if (sessionQ.isLoading || bootstrapMut.isPending)` — fine.
2. `if (!session || !user)` — this is the trap. If `useAuthReady` has not yet populated `user` (e.g. after the bootstrap mutation invalidates and the query refetches faster than `supabase.auth.getSession()` resolves on this render), the page falls back to the spinner even though `session` is loaded and `session.phase === 'open_pending'`.

The phase routing itself uses `{session.phase === 'open_pending' && …}` chained checks. Replacing it with an explicit `switch` removes any chance of fall-through and makes the `open_pending` branch the obvious default for a freshly-bootstrapped row.

## Changes (single file: `src/components/site-day/day-centre-page.tsx`)

1. Keep the initial spinner gate as `sessionQ.isLoading || bootstrapMut.isPending` (unchanged).
2. Keep the error card (unchanged).
3. Replace `if (!session || !user)` with `if (!session)` only — do not block rendering on `user`.
4. Replace the chain of `{session.phase === '…' && …}` blocks with an explicit `switch (session.phase)` returning JSX:
   - `open_pending` → render `<StartOfDayPanel sessionId={session.id} reportedBy={user?.id ?? ''} />` wrapped so the panel mounts as soon as `session` is present; if `user` is still resolving, the panel itself can no-op its submit handlers, but the layout is no longer hidden behind a spinner.
   - `escalated_lock` → existing lock + handshake panels (manager modal still gated on `isManager`).
   - `active_day` → `<ActiveDayPanel session={session} />`.
   - `closed_orderly` / `closed_no_go` → `<DayClosedPanel session={session} />`.
   - `default` → small inline notice "Unknown session phase: {phase}" instead of silently rendering nothing (prevents future fall-through bugs).
5. Wrap the switch's return in the existing `<div className="space-y-6">…</div>`.

No changes to:
- `useSiteSession`, `ensureTodaySession`, or any API/SQL.
- `StartOfDayPanel`, `ActiveDayPanel`, `LogAnomalyModal`, `IssuesRegisterCard`.
- RLS, tables, or migrations.

## Verification

- Hard refresh `/day` with the existing `open_pending` row → spinner clears, `<StartOfDayPanel>` mounts with `sessionId="92fea43e-…"`.
- No console errors; `MandatedChecksList`, `IssuesRegisterCard`, and the Declare Safe / Log Anomaly buttons render.
- Switching the row's `phase` to `active_day` (via Declare Safe) routes to `<ActiveDayPanel>` without a reload.
