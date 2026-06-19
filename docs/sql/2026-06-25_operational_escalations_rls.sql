-- Fix: drivers (authenticated users) must be able to INSERT a Sev 1 escalation
-- and SELECT/UPDATE the rows they're involved in. Without these, the client
-- insert fails with: 42501 "new row violates row-level security policy".

-- Grants (idempotent)
GRANT SELECT, INSERT, UPDATE ON public.operational_escalations TO authenticated;
GRANT ALL ON public.operational_escalations TO service_role;

ALTER TABLE public.operational_escalations ENABLE ROW LEVEL SECURITY;

-- Any authenticated user (driver or coordinator) can raise an escalation.
DROP POLICY IF EXISTS "auth can insert escalations"
  ON public.operational_escalations;
CREATE POLICY "auth can insert escalations"
  ON public.operational_escalations
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- All authenticated staff can read the pool (interceptor / waiting panel).
DROP POLICY IF EXISTS "auth can read escalations"
  ON public.operational_escalations;
CREATE POLICY "auth can read escalations"
  ON public.operational_escalations
  FOR SELECT
  TO authenticated
  USING (true);

-- All authenticated staff can update (claim / resolve) — the atomic RPC
-- `claim_operational_escalation` enforces the single-claimer guarantee.
DROP POLICY IF EXISTS "auth can update escalations"
  ON public.operational_escalations;
CREATE POLICY "auth can update escalations"
  ON public.operational_escalations
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
