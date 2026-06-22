## Goal

Mirror the Bus Walk Around handshake on the Day Centre escalation flow:

1. **Manager** (claimer, e.g. Buffy) types the proposed resolution and submits **with her PIN only**. This does **not** open the centre.
2. **Opener** (raiser, e.g. Craig) immediately sees a review popup with the Manager's proposal and the GO/NO-GO decision the Manager picked.
3. Opener can **Accept** (with own PIN) — centre opens (GO) or formally closes (NO-GO).
4. Opener can **Reject** — escalation is voided, session reverts to `open_pending`, the **RED `site_issue` row stays open and unresolved**. It appears in the Governance Hub open-issue list and in the Day Centre "open issues" view. The centre cannot fully open until that RED is resolved in the Hub; then the normal open-centre workflow proceeds.

## Current bug

`EscalationConsultationModal` (Manager side) flips `operational_escalations.status` straight to `resolved_approved`, which removes the Opener's `EscalationResolutionPanel` and lets `session.phase = 'active_day'` show through. The centre opens with an unresolved RED and the Opener never gets to review or veto the Manager's plan.

## Changes

### 1. `src/components/dashboard/escalation-consultation-modal.tsx`

Branch on `escalation.sourceKind === 'site_day_red'`:

- Replace single "Approve & Send Workaround / Deny" with **"Propose GO — Send to Opener"** and **"Propose NO-GO — Send to Opener"**.
- Add Manager-PIN input. On submit:
  - Call `submitManagerHandshake({ sessionId, plan: notes, decision, managerStaffId, pin })` (existing function — verifies PIN, persists `manager_plan_text` + `manager_decision` on the site session, does NOT change phase).
  - Write `resolution_notes = notes` onto `operational_escalations`. **Leave `status = 'claimed'`** so the Opener panel re-renders into the review state.
  - Ledger entry `escalation.manager_proposed` (YELLOW for GO, RED for NO-GO).
- Vehicle (`bus_walkaround`) path is unchanged.

Detection of "proposal exists" uses `session.managerDecision != null` (no new column needed).

### 2. `src/components/site-day/escalation-resolution-panel.tsx`

Replace the current dual-PIN form with three states keyed off the live escalation + session:

| State | Condition | UI |
|---|---|---|
| Awaiting pickup | `status = pending` | (unchanged) "Awaiting Manager pickup…" |
| Manager consulting | `status = claimed` AND `session.managerDecision == null` | (unchanged) "Escalation claimed by <name>" spinner |
| **Opener review** (new) | `status = claimed` AND `session.managerDecision != null` | Card titled "Manager <name> proposes **GO** / **NO-GO**" with quoted plan, single Opener-PIN input, **Accept Manager's Plan** + **Reject — Keep Closed** buttons |

Accept handler:
- Verify Opener PIN, call `submitLeaderHandshake({ decision: session.managerDecision, leaderStaffId: session.openedById, pin })` → session moves to `active_day` (GO) or `closed_no_go` (NO-GO).
- Call `resolveOperationalEscalation({ id, approved: session.managerDecision === 'go', managerStaffId: escalation.claimedBy, notes: session.managerPlanText })`.

Reject handler → new `rejectEscalationProposal(...)` (below). RED `site_issue` is left untouched, so it remains open in the Hub and the Day Centre open-issues list.

### 3. `src/lib/data-store.ts`

Add:

```ts
rejectEscalationProposal({ escalationId, sessionId, openerStaffId, pin }):
  - verifyStaffPin(openerStaffId, pin)
  - UPDATE site_day_sessions SET
      manager_plan_text = NULL,
      manager_decision = NULL,
      manager_auth_staff_id = NULL,
      manager_auth_at = NULL,
      phase = 'open_pending'
    WHERE id = sessionId
  - UPDATE operational_escalations SET
      status = 'resolved_denied',
      resolved_by = openerStaffId,
      resolved_at = now(),
      resolution_notes = 'Opener rejected manager proposal: ' || existing notes
    WHERE id = escalationId
  - ledger: 'escalation_rejected_by_opener' (RED)
```

The RED `site_issues` row is **not** touched — it stays `open`, surfaces in the Governance Hub, and blocks `open_pending → active_day` on the next attempt until resolved there.

### 4. Global interceptor

No change. After the Manager proposes, escalation remains `claimed`, so the "Claim Incident" popup does not re-pop for other managers.

### 5. Open-pending RED block (verify, not necessarily change)

I'll verify `StartOfDayPanel` / open-centre workflow refuses to flip phase to `active_day` while any unresolved RED `site_issue` exists. If it doesn't already, I'll add that guard so the user's invariant holds. (Will note in the build turn if a guard is added.)

## Database

No schema changes. No new column.

## Files touched

- `src/components/dashboard/escalation-consultation-modal.tsx`
- `src/components/site-day/escalation-resolution-panel.tsx`
- `src/lib/data-store.ts`
- (possibly) `src/components/site-day/start-of-day-panel.tsx` — only if the open-RED guard is missing
