Plan to fix the current failure:

1. Fix the driver page crash first
   - Move all Manifest page hooks so they always run in the same order on every render.
   - Replace the current early return that switches to `EscalationRehydrationGate` before later hooks with a stable render branch after hooks have been declared.
   - This directly targets the symptom: driver sees the RED office-review panel, then the root error screen a few seconds later.

2. Stop showing the unwanted generic “Awaiting office authorization” popup as the rehydrated target
   - Make rehydration land in the full escalation workflow state, not a dead route-guard message.
   - For pending/claimed RED: show the full issue context plus live status.
   - For manager-approved RED: show the manager workaround, driver PIN confirmation, and do not release the lock until `operator_acknowledged_at` is written.

3. Harden driver escalation lookup
   - Broaden `getActiveEscalation` so it can rehydrate by driver name and active statuses reliably:
     - `pending`
     - `claimed`
     - `resolved_approved` where `operator_acknowledged_at` is still null
   - Preserve the generic `operator_acknowledged_*` naming for Day Centre compatibility.

4. Fix Manager rehydration
   - Update the Manager-side claimed-escalation rehydration so a refresh reopens the consultation modal for the manager who already claimed the RED.
   - Keep claimed rows visible in the Governance Hub with who has it: unclaimed, claimed by manager, approved awaiting operator ack.
   - Do not depend on fast polling; use baseline queries plus realtime invalidation.

5. Add explicit testing visibility for “what escalation exists and who has it”
   - Add a small diagnostic/status strip to the RED driver panel showing:
     - escalation id short code
     - status
     - vehicle/site
     - raised by / driver or opener
     - claimed by manager id/name when available
     - created/claimed/resolved/awaiting-ack timers
   - Add the same ownership/status data to Governance Hub rows so during testing we can confirm whether the outstanding escalation is pending, claimed, who claimed it, and whether it is waiting for operator acknowledgement.

6. Add a safe read-only debug helper for testing
   - Add a single read-only helper/query that lists outstanding operational escalations with status and owner.
   - Use it only in the UI diagnostics; no schema changes or migrations.

7. Validate the fix
   - Reproduce hard refresh on `/manifest` with an outstanding RED and confirm it stays on the full escalation form, not the root error page.
   - Reproduce hard refresh on the Manager/Governance Hub screen and confirm the claimed escalation and consultation form rehydrate.
   - Confirm approved workaround remains visible until driver/operator PIN acknowledgement, then clears only after acknowledgement.