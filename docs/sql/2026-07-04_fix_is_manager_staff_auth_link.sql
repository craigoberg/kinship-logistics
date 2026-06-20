-- 2026-07-04 — Fix Manager permission bridge for System Parameters.
--
-- public.is_manager(uuid) must work for both identity shapes used by the app:
--   1. auth.uid() from authenticated sessions, linked to staff_registry.auth_user_id
--   2. staff_registry.id from the existing PIN-based terminal profile
--
-- The auth_user_id column is nullable and backfilled by matching staff email to
-- auth.users.email, so existing PIN-only workflows remain backwards compatible.

ALTER TABLE public.staff_registry
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS staff_registry_auth_user_id_key
  ON public.staff_registry(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

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

CREATE OR REPLACE FUNCTION public.is_manager(_staff_id uuid)
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
       AND (s.id = _staff_id OR s.auth_user_id = _staff_id)
       AND lower(coalesce(s.role, '')) LIKE '%manager%'
  )
$$;

REVOKE ALL ON FUNCTION public.is_manager(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_manager(uuid) TO anon, authenticated, service_role;

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

DROP POLICY IF EXISTS "system_parameters updatable" ON public.system_parameters;
CREATE POLICY "system_parameters updatable"
  ON public.system_parameters
  FOR UPDATE
  TO authenticated
  USING (public.is_manager(auth.uid()))
  WITH CHECK (public.is_manager(auth.uid()));

NOTIFY pgrst, 'reload schema';