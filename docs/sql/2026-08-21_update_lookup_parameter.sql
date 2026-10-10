-- =============================================================================
-- 2026-08-21 — Edit lookup codes/names (Day Centre Bus Runs cascade)
-- =============================================================================
--
-- Admin Lookups currently add/remove only. Editing a bus run *code* must also
-- rewrite stored assignments (schedules, Manifest trips, default routes, event
-- bookings) so clients stay on the same run — delete+recreate would orphan them.
--
-- Display-name-only edits can use a direct UPDATE; this RPC is required when
-- the stored code changes (atomic cascade).
--
-- PIN terminals use the publishable key + day-login JWT. GRANT to authenticated
-- + service_role only (not anon).
-- SQL Editor "Success. No rows returned" is expected for the DDL body.
-- =============================================================================

DROP FUNCTION IF EXISTS public.update_lookup_parameter(uuid, text, text);

CREATE OR REPLACE FUNCTION public.update_lookup_parameter(
  p_id uuid,
  p_code text,
  p_display_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.system_lookup_parameters%ROWTYPE;
  v_old_code text;
  v_new_code text;
  v_new_name text;
  v_code_changed boolean;
  v_tbl text;
  v_col text;
  v_n integer;
  v_cascade jsonb := '{}'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Day login required to update lookup entries.'
      USING ERRCODE = '42501';
  END IF;

  v_new_code := btrim(coalesce(p_code, ''));
  v_new_name := btrim(coalesce(p_display_name, ''));
  IF length(v_new_code) = 0 THEN
    RAISE EXCEPTION 'Code is required.' USING ERRCODE = '22023';
  END IF;
  IF length(v_new_name) = 0 THEN
    v_new_name := v_new_code;
  END IF;

  SELECT * INTO v_row
    FROM public.system_lookup_parameters
   WHERE id = p_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lookup entry not found.' USING ERRCODE = '22023';
  END IF;

  v_old_code := v_row.code;
  v_code_changed := v_old_code IS DISTINCT FROM v_new_code;

  IF v_code_changed AND EXISTS (
    SELECT 1
      FROM public.system_lookup_parameters
     WHERE id <> p_id
       AND lower(code) = lower(v_new_code)
  ) THEN
    RAISE EXCEPTION 'Code "%" is already used by another lookup entry.', v_new_code
      USING ERRCODE = '23505';
  END IF;

  -- Bus run codes are stored as plain text on operational rows (not an FK).
  -- Rewrite them in the same transaction so Manifest / Clients keep the assignment.
  IF v_code_changed AND v_row.category = 'bus_runs' THEN
    FOR v_tbl, v_col IN
      SELECT * FROM (VALUES
        ('participant_attendance_schedules', 'inbound_transport'),
        ('participant_attendance_schedules', 'outbound_transport'),
        ('participant_attendance_schedules', 'transport_required'),
        ('transport_trips', 'bus_run_code'),
        ('bus_run_default_routes', 'bus_run_code'),
        ('event_roster_bookings', 'outbound_bus_run_code'),
        ('event_roster_bookings', 'return_bus_run_code'),
        ('client_attendance_log', 'arrival_bus_run_code'),
        ('event_attendance_log', 'arrival_bus_run_code'),
        ('event_attendance_log', 'return_bus_run_code')
      ) AS t(tbl, col)
    LOOP
      IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = v_tbl
           AND column_name = v_col
      ) THEN
        EXECUTE format(
          'UPDATE public.%I SET %I = $1 WHERE %I = $2',
          v_tbl, v_col, v_col
        )
        USING v_new_code, v_old_code;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_cascade := v_cascade || jsonb_build_object(v_tbl || '.' || v_col, v_n);
      END IF;
    END LOOP;
  END IF;

  UPDATE public.system_lookup_parameters
     SET code = v_new_code,
         display_name = v_new_name
   WHERE id = p_id;

  SELECT * INTO v_row
    FROM public.system_lookup_parameters
   WHERE id = p_id;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'category', v_row.category,
    'code', v_row.code,
    'display_name', v_row.display_name,
    'code_changed', v_code_changed,
    'cascade', v_cascade
  );
END;
$$;

COMMENT ON FUNCTION public.update_lookup_parameter(uuid, text, text) IS
  'Update a lookup code/display name. Bus run code changes cascade to schedules, trips, routes, and event bookings.';

REVOKE ALL ON FUNCTION public.update_lookup_parameter(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_lookup_parameter(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_lookup_parameter(uuid, text, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Validation (DDL-only run returns no rows — that is expected):
--
-- Expect 1 row:
--   SELECT proname FROM pg_proc WHERE proname = 'update_lookup_parameter';
--
-- Expect authenticated = true, anon = false:
--   SELECT
--     has_function_privilege('authenticated',
--       'public.update_lookup_parameter(uuid, text, text)', 'EXECUTE') AS authenticated_can,
--     has_function_privilege('anon',
--       'public.update_lookup_parameter(uuid, text, text)', 'EXECUTE') AS anon_can;
--
-- Expect existing bus runs (sample):
--   SELECT code, display_name FROM system_lookup_parameters
--    WHERE category = 'bus_runs' ORDER BY display_name;
-- =============================================================================
