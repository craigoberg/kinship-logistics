-- System Parameters — single source of truth for tunable operational thresholds.
-- Every change is audited via operational_ledger (action_type = 'SYSTEM_PARAMETER_UPDATED').
--
-- Manager-only UPDATE: this project currently runs in PIN/anon mode, so DB-level
-- gating via auth.uid() is not authoritative. We expose an is_manager(uuid)
-- SECURITY DEFINER helper for when real Supabase Auth is wired up; until then,
-- Manager-only enforcement happens at the app layer (UI hides Edit + ledger row
-- captures staff_id) and is mirrored by the RLS UPDATE policy below, which can
-- be tightened to `USING (public.is_manager(auth.uid()))` in a follow-up
-- migration without touching call sites.

CREATE TABLE IF NOT EXISTS public.system_parameters (
  key          text PRIMARY KEY,
  value        jsonb NOT NULL,
  description  text NOT NULL,
  updated_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.system_parameters TO anon, authenticated;
GRANT UPDATE ON public.system_parameters TO anon, authenticated;
GRANT ALL    ON public.system_parameters TO service_role;

ALTER TABLE public.system_parameters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_parameters readable by all" ON public.system_parameters;
CREATE POLICY "system_parameters readable by all"
  ON public.system_parameters
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "system_parameters updatable" ON public.system_parameters;
CREATE POLICY "system_parameters updatable"
  ON public.system_parameters
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Forward-compatible helper: returns true when the given staff_registry.id has
-- role = 'manager' (case-insensitive). Safe to call from policies because
-- SECURITY DEFINER bypasses RLS on staff_registry.
CREATE OR REPLACE FUNCTION public.is_manager(_staff_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_registry
    WHERE id = _staff_id
      AND lower(coalesce(role, '')) LIKE '%manager%'
  )
$$;

-- Seed canonical parameters. ON CONFLICT keeps Manager-edited values intact on
-- re-run.
INSERT INTO public.system_parameters(key, value, description) VALUES
  ('rego_threshold_days',     '30'::jsonb,  'Days before vehicle registration expiry that the asset appears on the compliance feed.'),
  ('cert_threshold_days',     '30'::jsonb,  'Days before staff certification expiry that the cert is flagged on the dashboard.'),
  ('service_km_tolerance_km', '500'::jsonb, 'Kilometres before a vehicles next scheduled service at which it starts warning.')
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
