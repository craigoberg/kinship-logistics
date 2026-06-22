## Plan: Day Centre RED escalation proposal fix

1. **Make Buffy’s claimed consultation rehydrate after refresh**
   - Extend `GlobalEscalationInterceptor` so its baseline query also finds escalations already claimed by the current Manager, not only pending claimable rows.
   - If the current staff member has a claimed, unresolved `site_day_red` escalation with no manager proposal yet, reopen `EscalationConsultationModal` automatically.
   - Keep Craig suppressed from seeing his own claim popup via the existing `raisedBy` check.

2. **Fix “Propose GO” not advancing Craig from pending**
   - Update the manager proposal success path so the returned `site_day_sessions` row is pushed into the query cache and the linked site session / escalation queries are invalidated immediately.
   - Add a realtime subscription to the linked `site_day_sessions` row while Craig is waiting, so when Buffy submits GO/NO-GO Craig’s opener panel moves from “Manager is reviewing” to Accept/Reject without relying on polling or a manual refresh.

3. **Required-field red borders and blank PIN state**
   - In `EscalationConsultationModal`, track attempted submit.
   - Show thick red borders on:
     - action plan / NO-GO reason when under the required minimum,
     - Manager PIN when blank/invalid,
     - session lookup problem if the linked session cannot be found.
   - Remove the PIN placeholder bullets so an empty PIN field is visually blank, not ghost-filled.

4. **Button text formatting**
   - Rework the GO / NO-GO action buttons to prevent overflow on the modal width shown in the screenshot.
   - Use wrapped/stack-safe text, smaller responsive labels, and icons that do not force the text outside the button.

5. **Opener-side consistency**
   - Apply the same red-border / blank-placeholder rule to Craig’s opener PIN in `EscalationResolutionPanel` when he attempts Accept/Reject without a valid PIN.
   - Keep the dual-signoff rules unchanged: Buffy proposes; Craig accepts/declines with PIN; unresolved RED remains locked.

6. **Verification**
   - Check the changed source paths and use the existing preview/network signals to confirm the intended database updates are triggered and the UI no longer relies on transient modal state only.