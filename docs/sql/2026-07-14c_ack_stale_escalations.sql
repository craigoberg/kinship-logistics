-- One-off cleanup: force-acknowledge escalations that were already
-- manager-approved (status = resolved_approved) but never received the
-- on-site operator's PIN acknowledgment. These are stale test rows from
-- the old manager-approval flow and persist in the Governance Hub
-- "Awaiting operator ack" list with no way to clear from the UI.
--
-- Safe because status is already resolved_approved — no live shield is
-- being dropped on an active incident.

UPDATE public.operational_escalations
SET    operator_acknowledged_at = COALESCE(operator_acknowledged_at, now()),
       operator_acknowledged_by = COALESCE(operator_acknowledged_by, resolved_by)
WHERE  status = 'resolved_approved'
  AND  operator_acknowledged_at IS NULL;
