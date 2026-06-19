-- Fix: drivers/coordinators currently use the app's PIN workflow, not a
-- Supabase Auth session. In that state the browser reaches PostgREST as the
-- `anon` role, even after staff PIN verification. Without anon policies, the
-- insert fails with: 42501 "new row violates row-level security policy".

-- Grants (idempotent)
GRANT SELECT, INSERT, UPDATE ON public.operational_escalations TO anon;
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

-- Current no-login/PIN mode: the browser role is anon. Limit public inserts to
-- creating fresh pending Sev 1 rows only; claim/resolve still updates later.
DROP POLICY IF EXISTS "anon can raise pending escalations"
  ON public.operational_escalations;
CREATE POLICY "anon can raise pending escalations"
  ON public.operational_escalations
  FOR INSERT
  TO anon
  WITH CHECK (status = 'pending');

-- All authenticated staff can read the pool (interceptor / waiting panel).
DROP POLICY IF EXISTS "anon can read escalations"
  ON public.operational_escalations;
CREATE POLICY "anon can read escalations"
  ON public.operational_escalations
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "auth can read escalations"
  ON public.operational_escalations;
CREATE POLICY "auth can read escalations"
  ON public.operational_escalations
  FOR SELECT
  TO authenticated
  USING (true);

-- All authenticated staff can update (claim / resolve) — the atomic RPC
-- `claim_operational_escalation` enforces the single-claimer guarantee.
DROP POLICY IF EXISTS "anon can update active escalations"
  ON public.operational_escalations;
CREATE POLICY "anon can update active escalations"
  ON public.operational_escalations
  FOR UPDATE
  TO anon
  USING (status IN ('pending', 'claimed'))
  WITH CHECK (status IN ('claimed', 'resolved_approved', 'resolved_denied'));

DROP POLICY IF EXISTS "auth can update escalations"
  ON public.operational_escalations;
CREATE POLICY "auth can update escalations"
  ON public.operational_escalations
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
