## Problem

When Craig (Opener) clicks **Confirm Reject** in the rejection-reason dialog, nothing happens. The red validation border disappears (so the 10-char check passed) but the mutation silently fails.

### Root cause

Looking at the live `site_day_sessions` row in the console logs:

```
opened_by_id: null
phase: "escalated_lock"
```

The escalation was raised before the Start-of-Day handshake completed, so `session.openedById` is `null`. In `escalation-resolution-panel.tsx` both mutations do:

```ts
const leaderStaffId = session.openedById;
if (!leaderStaffId) throw new Error("Session has no recorded opener.");
```

So `rejectMutation.mutateAsync()` throws immediately → `onError` → `toast.error`. The toast is the only visible signal and Craig didn't notice it. The same trap exists on the Accept path.

The opener identity should come from **the currently signed-in staff actually using the panel** (Craig), not from a session field that may be null when the RED hit before opening.

## Fix

### `src/components/site-day/escalation-resolution-panel.tsx`

1. Import `getActiveUserProfile` from `@/lib/data-store`.
2. Compute `const actorStaffId = session.openedById ?? getActiveUserProfile()?.staffId ?? null;` once near the other derived state.
3. In **both** `acceptMutation` and `rejectMutation`, replace `const leaderStaffId = session.openedById;` with `const leaderStaffId = actorStaffId;` and keep the existing `if (!leaderStaffId) throw ...` guard (message updated to "No signed-in staff to authorise rejection — please sign in again.").
4. Disable Accept & Reject buttons (and add a small muted hint under the PIN field) when `!actorStaffId`, so the failure mode is visible up-front instead of only via a toast after click.

No business-logic change: PIN is still verified against that staff id, the RED issue still stays open, phase still reverts to `open_pending`, and notes are still appended with `[REJECTED] …`.

### Files touched

- `src/components/site-day/escalation-resolution-panel.tsx` (≈10 line edit)

No DB / RPC / data-store changes required.
