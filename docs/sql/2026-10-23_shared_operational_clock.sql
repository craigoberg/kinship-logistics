-- 2026-10-23 — Shared exercise clock (SIM time for every signed-in person)
--
-- Run in Supabase Dashboard → SQL Editor → Run All
--
-- "Success. No rows returned" is normal. This script is DDL + one seed row.
-- It does not prove the row exists. Run the validation SELECT at the bottom.

INSERT INTO public.system_parameters (key, value, description)
SELECT
  'operational_clock.shared',
  jsonb_build_object(
    'enabled', false,
    'date', null,
    'time', null,
    'setOnWallDate', null,
    'revision', 0
  ),
  'Exercise SIM clock. When enabled, every signed-in person follows this Sydney date and time. Craig sets it from the amber SIM bar. Expires the next Sydney wall midnight.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_parameters WHERE key = 'operational_clock.shared'
);

CREATE OR REPLACE FUNCTION public.set_shared_operational_clock(
  _staff_id uuid,
  _value jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _enabled boolean;
  _date text;
  _time text;
  _wall text;
BEGIN
  IF _staff_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Day login is required before setting the exercise clock.' USING ERRCODE = '42501';
  END IF;

  -- The signed-in account must be Craig's own staff row.
  IF NOT EXISTS (
    SELECT 1
      FROM public.staff_registry s
     WHERE s.id = _staff_id
       AND s.auth_user_id = auth.uid()
       AND s.active IS DISTINCT FROM false
       AND (
         s.id = '68a17753-d387-4b53-a466-40cf1d06a384'::uuid
         OR lower(btrim(s.full_name)) = 'craig oberg'
       )
  ) THEN
    RAISE EXCEPTION 'Only Craig can set the exercise clock.' USING ERRCODE = '42501';
  END IF;

  _enabled := coalesce((_value->>'enabled')::boolean, false);
  _date := _value->>'date';
  _time := _value->>'time';
  _wall := _value->>'setOnWallDate';

  IF _enabled THEN
    IF _date IS NULL OR _date !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'Exercise clock date must be YYYY-MM-DD.' USING ERRCODE = '22023';
    END IF;
    IF _time IS NULL OR _time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'Exercise clock time must be HH:mm.' USING ERRCODE = '22023';
    END IF;
    IF _wall IS NULL OR _wall !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'Exercise clock wall date must be YYYY-MM-DD.' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.system_parameters
     SET value = _value,
         updated_by = _staff_id,
         updated_at = now()
   WHERE key = 'operational_clock.shared';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exercise clock parameter is missing. Re-run this script.' USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_shared_operational_clock(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.set_shared_operational_clock(uuid, jsonb)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- Validation (expect 1 row, enabled = false until Craig turns it on):
-- SELECT key, value->>'enabled' AS enabled, value->>'date' AS date, value->>'time' AS time
-- FROM public.system_parameters
-- WHERE key = 'operational_clock.shared';
--
-- Validation (expect 1 row):
-- SELECT proname FROM pg_proc WHERE proname = 'set_shared_operational_clock';
