-- System Parameters — single source of truth for tunable operational thresholds.
-- Every change is audited via operational_ledger (action_type = 'SYSTEM_PARAMETER_UPDATED').
--
-- Manager-only UPDATE: public.is_manager(uuid) now accepts either an auth.users.id
-- linked through staff_registry.auth_user_id or a staff_registry.id from the
-- current PIN-session profile. This keeps existing PIN logins working while
-- allowing RLS policies to use auth.uid() once auth-backed staff links exist.

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

ALTER TABLE public.staff_registry
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS staff_registry_auth_user_id_key
  ON public.staff_registry(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- Backfill the auth link by email when a matching auth user exists. Safe/no-op
-- for PIN-only rows or duplicate staff emails.
UPDATE public.staff_registry s
   SET auth_user_id = u.id
  FROM auth.users u
 WHERE s.auth_user_id IS NULL
   AND s.email IS NOT NULL
   AND lower(s.email) = lower(u.email)
   AND NOT EXISTS (
     SELECT 1
       FROM public.staff_registry other
      WHERE other.id <> s.id
        AND other.email IS NOT NULL
        AND lower(other.email) = lower(s.email)
   );

-- Accepts either auth.users.id or staff_registry.id. Safe to call from policies
-- because SECURITY DEFINER bypasses RLS on staff_registry.
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
    WHERE active IS DISTINCT FROM false
      AND (id = _staff_id OR auth_user_id = _staff_id)
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
