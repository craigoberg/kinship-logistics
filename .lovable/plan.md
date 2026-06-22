## Problem

Right now, when Buffy (opener) **Accepts** the Manager's GO proposal on a RED escalation, the site session jumps straight to `active_day` ("Day Centre — Active"). That bypasses:

- the **mandated compliance checks** (which were never ticked), and
- the explicit **Open Centre** button (which was never pressed).

Agreeing a workaround for one RED should only clear that RED off the "blockers" list. The Centre must remain in **Start of Day** until *every* RED is cleared (resolved or workaround-accepted), all mandated checks are ticked, and the opener explicitly presses Open Centre.

## Fix

### 1. Escalation Accept (GO) no longer opens the Centre

`src/components/site-day/escalation-resolution-panel.tsx` — `acceptMutation`:

- **Remove** the call to `submitLeaderHandshake(...)` for the GO path. (That call is what flips phase → `active_day`.)
- Instead, when manager's decision is **GO**:
  1. Mark the source site_issue (`escalation.sourceIssueId`) with `status = 'workaround_accepted'` and persist the manager's plan text into `workaround_plan`.
  2. Call `resolveOperationalEscalation({ approved: true, … })` to close the escalation row.
  3. Revert the session: clear `manager_decision` / `manager_plan_text` / `manager_auth_*` and set `phase = 'open_pending'` (same shape as `rejectEscalationProposal` already does, just without the `[REJECTED]` note).
  4. Write ledger receipt `site_day.red_workaround_accepted` (GREEN severity, includes opener + manager staff ids, source issue id, plan text).
  5. Toast: *"Workaround accepted — complete mandated checks, then Open Centre."*
- When manager's decision is **NO-GO**: keep existing behaviour (`submitLeaderHandshake` → `closed_no_go`).

### 2. Start-of-Day panel treats "workaround accepted" as cleared

`src/components/site-day/start-of-day-panel.tsx`:

- Change `openRedIssues` filter from `status !== 'resolved'` to `status !== 'resolved' && status !== 'workaround_accepted'`. (RED with an accepted workaround no longer blocks Open Centre, but it stays visible in the register.)
- Mandated checks + `Confirm & Open` AlertDialog remain unchanged → still mandatory.

### 3. Issues Register card shows the "Workaround accepted" badge

`src/components/site-day/issues-register-card.tsx` (and `active-day-panel.tsx` / `issues-register` reuse): add a small green-outlined "Workaround accepted" badge next to RED issues whose `status === 'workaround_accepted'`, mirroring the existing "Resolved" badge styling.

### 4. New data-store helper

`src/lib/data-store.ts` — add `acceptEscalationProposal(sessionId, escalationId, sourceIssueId, managerPlanText, openerStaffId)` that performs the four DB writes in step 1 above (issue update, escalation resolve, session revert, ledger). The escalation panel calls this single helper.

### Out of scope

- No DB migration. `site_issues_register.status` is already a free-text column; the new value `'workaround_accepted'` is additive. Hub/Governance code that filters on `status = 'open'` already treats anything non-open as not-open, which is the desired behaviour (it stops counting toward the "must clear" list).
- No change to the Reject flow or to the rejection-awareness modal.
- No change to NO-GO acceptance.
- No change to the Manager handshake screen.

### Verification

After build:
1. Open a session with a logged RED → centre is `open_pending`.
2. Manager proposes GO with a plan; Opener Accepts with PIN.
3. Phase stays `open_pending`; RED card shows "Workaround accepted"; mandated checks panel is still front-and-centre; green **Declare Site Safe & Compliant** button enables only after all checks are ticked.
4. Pressing it opens the AlertDialog; confirming flips phase → `active_day` (existing path).
5. NO-GO acceptance still closes the day immediately.
