## Goal

Stop the Manager Propose modal from wiping the typed plan/PIN when the underlying escalation row rehydrates via realtime, and add lightweight tracing so the previous "nothing happened" no-op is diagnosable if it recurs.

## Scope

Two files only. No schema, no RPC, no behaviour change to the happy path.

1. `src/components/dashboard/escalation-consultation-modal.tsx` (Manager Propose modal)
2. `src/lib/api/site-day-sessions.ts` (`submitManagerHandshake`)

## Changes

### 1. Preserve typed input across rehydrates

- Treat `notes` and `pin` as user-owned local state that only resets when the modal **closes** (or the escalation `id` actually changes), not whenever the escalation row object reference changes from realtime.
- Replace any effect that resets state on `[escalation]` with one keyed on `[escalation?.id, open]` and only clear when `open` flips to `false` or the id changes.
- If a "draft restore" hook (e.g. seeding `notes` from `escalation.managerPlanText`) exists, only seed once per `(open=true, id)` transition — never overwrite a non-empty `notes` the user has already typed.

### 2. Tracing on the submit path

In the modal's `propose` handler, add `console.debug('[propose]', step, payload)` lines for each early return:
- notes invalid / too short
- pin missing / invalid format
- session missing
- `claimedBy` missing on escalation
- pre-call snapshot of `{ escalationId, sessionId, staffId, notesLen, pinLen }`

In `submitManagerHandshake`:
- log PIN verify result
- log update payload
- log returned row from `.select()`
- on Postgres error, `console.error('[submitManagerHandshake]', { code, message, details, hint })`

In the modal's `catch` block, mirror the toast message via `console.error('[propose:caught]', err)` so it shows up in the log feed even when the toast is missed.

### 3. Inline error strip (small)

Render a single red text line at the bottom of the modal showing the last failure reason; clears on next submit attempt. Guarantees the user sees *why* nothing happened without hunting in the toast stack.

## Out of scope

- No change to RLS, RPC, or the writeback shape.
- No removal of the day-blocking diagnostic yet — keep until the next clean Manager Propose round-trip is observed.
- The probable RLS / `verifyStaffPin` follow-ups from the prior plan are deferred until the new tracing actually fingers one of them.

## Verification

- Open the modal, type, wait for a realtime tick (or trigger one by another tab) → typed text remains.
- Submit with bad PIN → red inline strip + `[submitManagerHandshake]` error in console.
- Submit happy path → session row updates `manager_plan_text` / `manager_decision`, opener panel renders.
