## Goal
Split the Red anomaly raise from the workaround proposal so the Opener (Craig) only describes the issue, while the responding Manager (Buffy) is the one who writes the workaround/NO-GO reason. The remainder of the handshake (Manager popup → Manager PIN → Opener Accept/Reject + PIN → resolution / Hub lock) is already wired correctly and only needs a couple of cosmetic/blocker tweaks.

## Current behaviour (verified in code)
- `LogAnomalyModal` forces a Workaround Plan textarea whenever severity is Yellow OR Red, blocking submit until it's filled. This is the screen Craig is seeing in the screenshot.
- After a Red is logged, the flow already does what the user described:
  - `setPhase → escalated_lock` + insert into `operational_escalations` (single rail).
  - `GlobalEscalationInterceptor` pops the claim modal on every Manager screen.
  - `EscalationConsultationModal → SiteDayProposalModal` is where Buffy types the plan, picks GO / NO-GO and enters her Manager PIN.
  - `EscalationResolutionPanel` shows Craig the Manager's plan + Accept (with Opener PIN) / Reject buttons.
  - Reject calls `rejectEscalationProposal` (centre returns to Open Pending, RED issue stays open → Hub must resolve).
  - Re-opening while a RED is open is already blocked by `escalated_lock` phase + `EscalationLockBanner`.

## Changes to make

### 1. `src/components/site-day/log-anomaly-modal.tsx`
- Treat the Workaround Plan field as **Yellow-only**. For Red:
  - Hide the Workaround textarea and helper copy.
  - Drop the "Red severity requires a Workaround Plan" validator.
  - Replace it with an inline informational note:
    > "Red issues are escalated to a Manager. They will propose the workaround or NO-GO reason — you don't need to fill one in here."
  - Persist `workaround_plan = null` for Red on `createIssue` (already nullable in DB / type).
- Keep Yellow behaviour exactly as today (workaround still mandatory).
- Keep the existing `setPhase('escalated_lock')` + `raiseOperationalEscalation` calls untouched — the rest of the rail does not change.

### 2. `src/components/site-day/escalation-lock-banner.tsx` (small copy tweak only)
- When Craig (or anyone) re-enters Open Centre while a RED is still open in the Hub, the existing banner already blocks the workflow but the message is generic. Update its body to explicitly say:
  > "An unresolved Red issue is blocking the Day Centre. A Manager must clear it in the Governance Hub before the open-centre workflow can restart."
- No logic change, no logging, no extra escalation — purely a clearer message, matching the user's "conversation, not escalation" requirement.

### 3. No other files change
- `EscalationConsultationModal` / `SiteDayProposalModal` already owns the Workaround field + Manager PIN + GO/NO-GO.
- `EscalationResolutionPanel` already owns the Opener Accept/Reject + Opener PIN + Hub fallback on reject.
- `GlobalEscalationInterceptor` already drives the "popup on any screen" experience for Buffy.

## Out of scope (confirmed already working)
- Realtime popup to Manager — handled by `GlobalEscalationInterceptor`.
- Atomic claim RPC + single-rail escalation table — unchanged.
- Ledger receipts for Manager propose / Opener accept / NO-GO — unchanged.
- Hub-only resolution path for stuck RED issues — unchanged.

## Technical notes
- `site_issues.workaround_plan` is already `text NULL`, so writing `null` for Red is schema-safe.
- `usePersistedForm` draft for Red will still hold a stray `workaround` string from earlier sessions; we'll force-clear `workaround` to `""` whenever the user switches to Red (mirroring the existing Green branch), so the draft can't reintroduce stale content.
- Guardrails compliance: no duplicate PIN dialogue (we reuse the existing Manager / Opener PIN inputs already in `SiteDayProposalModal` and `EscalationResolutionPanel`); no new escalation rail; no new logging on the friendlier lock banner copy.