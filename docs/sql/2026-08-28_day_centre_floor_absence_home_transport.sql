-- ============================================================
-- Day Centre floor absence → Manifest skip + home transport
-- Created: 2026-08-28
-- BL-124: Mark Absent for Today uses the same date-scoped exemption as
-- Office Off today (morning + afternoon Manifest). Late arrival / walk-in
-- can assign how they go home (bus run vs family / independent).
--
-- "Success. No rows returned" is expected for this script (DDL only).
-- ============================================================

ALTER TABLE public.client_attendance_log
  ADD COLUMN IF NOT EXISTS departure_vector text DEFAULT NULL;

ALTER TABLE public.client_attendance_log
  ADD COLUMN IF NOT EXISTS departure_bus_run_code text DEFAULT NULL;

DO $$
BEGIN
  ALTER TABLE public.client_attendance_log
    DROP CONSTRAINT IF EXISTS client_attendance_log_departure_vector_check;
  ALTER TABLE public.client_attendance_log
    ADD CONSTRAINT client_attendance_log_departure_vector_check
    CHECK (
      departure_vector IS NULL
      OR departure_vector IN ('bus', 'family', 'independent')
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.client_attendance_log.departure_vector IS
  'Floor home method: bus / family / independent. NULL = use today''s outbound schedule.';

COMMENT ON COLUMN public.client_attendance_log.departure_bus_run_code IS
  'Floor home bus_runs.code when departure_vector=bus (walk-in or override).';

-- ── Validation (expect 2 rows) ──────────────────────────────────────────────
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'client_attendance_log'
--   AND column_name IN ('departure_vector', 'departure_bus_run_code')
-- ORDER BY column_name;
