-- Track which staff member raised the escalation so the Global
-- Escalation Interceptor can suppress the Claim Incident popup for
-- the very user who reported it (preventing self-claim).
--
-- Safe / idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.operational_escalations
  ADD COLUMN IF NOT EXISTS raised_by uuid
    REFERENCES public.staff_registry(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS operational_escalations_raised_by_idx
  ON public.operational_escalations (raised_by);

COMMENT ON COLUMN public.operational_escalations.raised_by IS
  'Staff member who created the escalation. Used by the Global Escalation Interceptor to prevent the raiser from claiming their own incident.';
