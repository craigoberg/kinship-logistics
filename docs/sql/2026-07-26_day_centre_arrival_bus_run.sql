-- Day Centre arrival override (BL-013 parity) — actual bus run on check-in.
-- Schedule inbound_transport remains the Planned badge; floor records actual.
--
-- Supabase SQL Editor may end with "Success. No rows returned" for DDL — expected.

ALTER TABLE public.client_attendance_log
  ADD COLUMN IF NOT EXISTS arrival_bus_run_code text DEFAULT NULL;

COMMENT ON COLUMN public.client_attendance_log.arrival_bus_run_code IS
  'Floor Check-In override: bus_runs.code when arrival_method=bus; NULL when self/walk-in or legacy bus.';

-- ── Validation (expect 1 row) ───────────────────────────────────────────────
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'client_attendance_log'
--   AND column_name = 'arrival_bus_run_code';
