-- BL-069 — Multi-bus event runs (Transport IN + HOME)
-- Office plans outbound/return bus_run_code on roster; floor may override on attendance.
-- Legacy: mode=bus + NULL run code = single shared bus (today's behaviour).
--
-- Supabase SQL Editor may end with "Success. No rows returned" for DDL — expected.

ALTER TABLE public.event_roster_bookings
  ADD COLUMN IF NOT EXISTS outbound_bus_run_code text DEFAULT NULL;

ALTER TABLE public.event_roster_bookings
  ADD COLUMN IF NOT EXISTS return_bus_run_code text DEFAULT NULL;

COMMENT ON COLUMN public.event_roster_bookings.outbound_bus_run_code IS
  'Admin bus_runs.code when outbound_transport_mode=bus; NULL = legacy single shared bus.';

COMMENT ON COLUMN public.event_roster_bookings.return_bus_run_code IS
  'Admin bus_runs.code when return_transport_mode=bus; NULL = legacy single shared bus.';

ALTER TABLE public.event_attendance_log
  ADD COLUMN IF NOT EXISTS arrival_bus_run_code text DEFAULT NULL;

ALTER TABLE public.event_attendance_log
  ADD COLUMN IF NOT EXISTS return_bus_run_code text DEFAULT NULL;

COMMENT ON COLUMN public.event_attendance_log.arrival_bus_run_code IS
  'Floor override: which bus_runs.code the person arrived on (when arrival_method=bus).';

COMMENT ON COLUMN public.event_attendance_log.return_bus_run_code IS
  'Floor Check-Out: which bus_runs.code for return home (when return_transport=bus).';

-- ── Validation (expect 4 rows) ───────────────────────────────────────────────
-- SELECT table_name, column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND (
--     (table_name = 'event_roster_bookings' AND column_name IN ('outbound_bus_run_code', 'return_bus_run_code'))
--     OR (table_name = 'event_attendance_log' AND column_name IN ('arrival_bus_run_code', 'return_bus_run_code'))
--   )
-- ORDER BY table_name, column_name;
