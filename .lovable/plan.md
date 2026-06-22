## Reopen Centre — Manager-authorised, audit-safe

### 1. New DB-layer function

`src/lib/api/site-day-sessions.ts` — add `reopenSession({ managerStaffId, pin, reason })`:

- Verifies the caller is **Manager-role** (`isActiveUserManager()` from `data-store`).
- Verifies the supplied PIN against `managerStaffId` via `verifyStaffPin`.
- Reads today's session; requires `phase === 'closed_orderly'` (NOT `closed_no_go` — a hard NO-GO can't be unwound by a reopen click; that path stays locked).
- Updates the same row (no new row created):
  - `phase = 'active_day'`
  - `closed_by_id = null`, `close_declared_at = null`, `close_leader_notes = null` (so re-close can rewrite cleanly and the DayClosedPanel disappears).
- Writes one ledger entry: `site_day.centre_reopened`, severity `YELLOW`, metadata `{ session_id, manager_staff_id, reason, prior_close_at, prior_closed_by }`.

### 2. UI: "Reopen Centre" button + dialog

`src/components/site-day/day-closed-panel.tsx`:

- Show a `Reopen Centre` button **only when** `phase === 'closed_orderly'` (hidden for `closed_no_go`).
- Opens a Dialog with the Guardrails styling:
  - Manager PIN input — 4–6 digits, thick rose border + helper text on validation fail.
  - Reason textarea — minimum 10 chars, live counter, thick rose border on validation fail.
  - Confirm Reopen button disabled until both fields valid.
- On success: toast "Centre reopened. Re-closing later will only flip newly finalised attendance rows."

### 3. Idempotency review — no doubling, no reset

| Area | Current behaviour | Verdict |
|---|---|---|
| `site_day_sessions` row | Single row per `session_date`; open/close/reopen update the same row | No duplication |
| `site_issues_register` | Keyed on `session_id`; never deleted on close | Preserved across reopen; not duplicated |
| `attendance_roster_logs` | Not created or wiped by open/close; rows live independently of phase | Preserved; not duplicated |
| `operational_ledger` | Each open/close/reopen writes exactly one event row | Correct — each event is a distinct audit fact |
| MYOB Export | `finalizeTodaysBilling` already filters `exported_at IS NULL` so previously exported rows are skipped | Already idempotent against export |
| `finalizeTodaysBilling` re-flip on re-close | Currently re-UPDATEs rows already at `audited_ready_for_billing` to the same value and returns them in the count | **Patch**: add `.eq('billing_state', 'pending_export')` (or the equivalent pre-finalised state) so re-close reports only the *newly* finalised rows. No behavioural change on first close. |

No new tables, no migrations.

### 4. Files touched

- `src/lib/api/site-day-sessions.ts` — add `reopenSession`.
- `src/lib/api/myob-export.ts` — tighten `finalizeTodaysBilling` filter so a re-close doesn't re-count already-flipped rows.
- `src/components/site-day/day-closed-panel.tsx` — Reopen button + Manager PIN/Reason dialog + mutation.

### 5. Verification

1. Open → close → DayClosedPanel shows. Click Reopen, enter manager PIN + reason ≥10 chars → phase flips to `active_day`, ActiveDayPanel returns, ledger gains one `site_day.centre_reopened` event.
2. Click Close Day again → toast reports the count of newly-finalised attendance rows only (not the previously flipped ones); MYOB export workspace shows each ready row once, not twice.
3. Existing issues from before the first close are still listed; no duplicates.
4. `closed_no_go` sessions do not show the Reopen button.
