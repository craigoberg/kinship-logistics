-- 2026-07-12 — system_parameters: PIN terminal save (anon key + Manager PIN sessions)
--
-- Run in Supabase Dashboard → SQL Editor → Run All
--
-- Fixes:
--   • POST /rpc/set_system_parameter 404 — function not deployed
--   • Direct UPDATE blocked for anon when 2026-07-04 policy requires auth.uid()
--
-- App auth is PIN session layer; permissive UPDATE matches other operational tables.

-- Optional auth link column (2026-07-04) — idempotent; PIN terminal uses staff_registry.id.
ALTER TABLE public.staff_registry
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS staff_registry_auth_user_id_key
  ON public.staff_registry(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- Drop policy first — it may reference is_manager(uuid) from the 2026-07-04 migration.
DROP POLICY IF EXISTS "system_parameters updatable" ON public.system_parameters;

DROP FUNCTION IF EXISTS public.set_system_parameter(text, jsonb, uuid, text);

-- Arg rename (_staff_id → _user_id) is not allowed via CREATE OR REPLACE — drop first.
DROP FUNCTION IF EXISTS public.is_manager(uuid);

-- ─── Manager check (staff_registry.id OR auth_user_id) ───────────────────────
CREATE OR REPLACE FUNCTION public.is_manager(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.staff_registry s
     WHERE s.active IS DISTINCT FROM false
       AND (s.id = _user_id OR s.auth_user_id = _user_id)
       AND lower(coalesce(s.role, '')) LIKE '%manager%'
  )
$$;

REVOKE ALL ON FUNCTION public.is_manager(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_manager(uuid) TO anon, authenticated, service_role;

-- ─── Audited parameter update (preferred path from the app) ───────────────────
CREATE OR REPLACE FUNCTION public.set_system_parameter(
  _key text,
  _value jsonb,
  _staff_id uuid,
  _justification text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _old_value jsonb;
BEGIN
  IF NOT public.is_manager(_staff_id) THEN
    RAISE EXCEPTION 'Only Managers can update system parameters.' USING ERRCODE = '42501';
  END IF;

  IF length(btrim(coalesce(_justification, ''))) < 10 THEN
    RAISE EXCEPTION 'Justification must be at least 10 characters.' USING ERRCODE = '22023';
  END IF;

  SELECT value INTO _old_value
    FROM public.system_parameters
   WHERE key = _key
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown system parameter: %', _key USING ERRCODE = '22023';
  END IF;

  UPDATE public.system_parameters
     SET value = _value,
         updated_by = _staff_id,
         updated_at = now()
   WHERE key = _key;

  INSERT INTO public.operational_ledger(
    staff_id,
    category,
    severity,
    action_type,
    gps_lat,
    gps_lng,
    metadata
  ) VALUES (
    _staff_id,
    'CENTRE',
    'INFO',
    'SYSTEM_PARAMETER_UPDATED',
    NULL,
    NULL,
    jsonb_build_object(
      'key', _key,
      'old_value', _old_value,
      'new_value', _value,
      'justification', btrim(_justification)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_system_parameter(text, jsonb, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_system_parameter(text, jsonb, uuid, text)
  TO anon, authenticated, service_role;

-- ─── RLS fallback — anon publishable key after PIN login ─────────────────────
GRANT SELECT, UPDATE ON public.system_parameters TO anon, authenticated;

CREATE POLICY "system_parameters updatable"
  ON public.system_parameters
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
