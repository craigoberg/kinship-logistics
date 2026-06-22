## Updated plan (adds Buffy awareness popup on top of approved plan)

Everything from the previous approved plan stays — fix greyed Accept/Reject buttons (`disabled={busy || !pinValid}`), reject-reason mini popup with Guardrails min-10-chars / red-border validation, and `rejectEscalationProposal({ reason })` appending `[REJECTED] {reason}` to `resolution_notes`.

### New addition — Manager awareness popup

When Craig rejects, the existing flow already sets the escalation to `resolved_denied` with the `[REJECTED] …` note. We just need Buffy (the manager who claimed it) to see that, acknowledge, and move on. No DB action beyond what already happens.

#### Where it lives

Inside the existing `GlobalEscalationInterceptor` — it already runs on every page, already knows `currentStaffId`, and already has realtime subscription wiring. Adding the rejection awareness here keeps everything on the single-rail escalation pipeline (matches the Guardrails "single-rail" rule).

#### How it triggers

1. New query `myRejectedAwaitingAck` — fetches `operational_escalations` where `claimed_by = currentStaffId`, `status = "resolved_denied"`, `resolution_notes` starts with `[REJECTED]`, filtered against a `localStorage` set of already-acknowledged IDs so a page refresh doesn't re-show it forever. Runs on mount and on realtime updates.
2. Realtime: piggyback on `subscribeToEscalationPool` — when an UPDATE row arrives with `status === "resolved_denied"`, `claimed_by === currentStaffId`, and `resolution_notes` starts with `[REJECTED]`, push it into a `rejectedQueue` state.
3. Render a new `<Dialog>` (sibling to the existing Claim modal) showing one rejection at a time. Non-dismissible until acknowledged.

#### Modal contents (read-only, awareness only)

- **Title:** "Opener Rejected Your Proposal" (rose-tinted header)
- **Body:**
  - "Reported by" / "Site" / "Trigger" — same `ContextRow` style as the Claim modal.
  - **Your proposal** block — shows whatever the manager originally sent (parsed from the second half of `resolution_notes`, i.e. the text after `— Manager proposal was:` when present).
  - **Opener's reason** block — the `[REJECTED] {text}` portion.
  - Amber callout: "This RED issue remains OPEN in the Governance Hub. Decide your next step there — no further action is taken automatically."
- **Single button:** "Acknowledged" (blue). On click: push the escalation id into the `acknowledged-rejections` localStorage set, drop it from `rejectedQueue`, close.

#### Files touched

- `src/components/site-day/escalation-resolution-panel.tsx` — disabled logic, reject-reason mini Dialog, mutation arg (from previous plan).
- `src/lib/data-store.ts` — `rejectEscalationProposal({ reason })` formatting (from previous plan).
- `src/components/dashboard/global-escalation-interceptor.tsx` — new rejection-awareness Dialog + query + realtime branch + localStorage ack set.

#### Verification

Buffy proposes GO → Craig types PIN → buttons un-grey → Craig clicks Reject → mini popup → types ≥10-char reason → confirms → Centre returns to Open Pending, RED issue stays open. Within ~1s on Buffy's screen, an "Opener Rejected Your Proposal" dialog appears with Craig's reason and the "RED issue remains OPEN in the Governance Hub" callout. Buffy clicks Acknowledged → dialog closes, never reappears for that row even after refresh.
