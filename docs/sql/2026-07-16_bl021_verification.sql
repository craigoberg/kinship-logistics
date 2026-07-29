-- 2026-07-16 — BL-021 verification (read-only + optional backfill)
--
-- Run in Supabase SQL Editor after applying (or to confirm already applied):
--   1. docs/sql/2026-07-16_venue_registry_outing_trips_phase0.sql
--   2. docs/sql/2026-07-04_event_attendance_log_phase8.sql
--   3. docs/sql/2026-07-16_venue_registry_phase5_issues_context.sql
--      (superseded by docs/sql/2026-07-11_site_issues_register_anon_access.sql if that ran)
--
-- "Success. No rows returned" applies only to DDL scripts — these SELECTs should return rows.

-- ─── 1. Core venue registry tables exist ────────────────────────────────────
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'venues',
    'venue_template_fields',
    'venue_safety_baseline_signoffs',
    'venue_safety_answers',
    'event_venue_reconfirmations',
    'event_venue_stops',
    'event_day_sessions',
    'event_bus_manifest',
    'event_curfew_log',
    'event_morning_log',
    'event_attendance_log'
  )
ORDER BY table_name;
-- Expect 11 rows.

-- ─── 2. event_manifest outing columns ───────────────────────────────────────
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'event_manifest'
  AND column_name IN ('event_kind', 'primary_venue_id', 'base_hotel_venue_id', 'curfew_time', 'morning_roll_time')
ORDER BY column_name;
-- Expect 5 rows.

-- ─── 3. event_day_sessions phase includes `active` (phase8) ─────────────────
SELECT pg_get_constraintdef(oid) AS phase_check
FROM pg_constraint
WHERE conrelid = 'public.event_day_sessions'::regclass
  AND conname = 'event_day_sessions_phase_check';
-- Expect definition containing 'active'.

-- ─── 4. site_issues_register event context (phase5) ─────────────────────────
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'site_issues_register'
  AND column_name IN ('event_id', 'event_day_session_id', 'session_id')
ORDER BY column_name;
-- Expect 3 rows; session_id is_nullable = YES.

-- ─── 5. transport_trips hop linkage columns ─────────────────────────────────
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'transport_trips'
  AND column_name IN ('trip_kind', 'event_day_session_id', 'venue_stop_from_id', 'venue_stop_to_id', 'hop_index')
ORDER BY column_name;
-- Expect 5 rows.

-- ─── 6. event_roster_bookings transport modes ───────────────────────────────
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'event_roster_bookings'
  AND column_name IN ('outbound_transport_mode', 'return_transport_mode')
ORDER BY column_name;
-- Expect 2 rows.

-- ─── 7. System parameter seeds (phase0 §12.5 + roll-call defaults) ──────────
SELECT key, value
FROM public.system_parameters
WHERE key IN (
  'event_curfew_yellow_mins_before',
  'event_curfew_red_mins_after',
  'event_morning_yellow_mins_before',
  'event_morning_red_mins_after',
  'venue_baseline_reconfirm_days',
  'default_evening_roll_call_time',
  'default_morning_roll_call_time'
)
ORDER BY key;
-- Expect 7 rows.

-- ─── 8. seed_venue_mandatory_safety_fields RPC ──────────────────────────────
SELECT proname, prosecdef
FROM pg_proc
WHERE proname = 'seed_venue_mandatory_safety_fields';
-- Expect 1 row; prosecdef = true.

-- ─── 9. Live data sanity (optional — row counts) ────────────────────────────
SELECT 'venues' AS tbl, count(*) FROM public.venues
UNION ALL SELECT 'event_attendance_log', count(*) FROM public.event_attendance_log
UNION ALL SELECT 'single_day_outing', count(*) FROM public.event_manifest WHERE event_kind = 'single_day_outing'
UNION ALL SELECT 'event_day_sessions', count(*) FROM public.event_day_sessions;

-- ─── 9b. RLS enabled on §12 tables (expect rls_enabled = true for every row) ─
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'venues',
    'venue_template_fields',
    'venue_safety_baseline_signoffs',
    'venue_safety_answers',
    'event_venue_reconfirmations',
    'event_venue_stops',
    'event_day_sessions',
    'event_bus_manifest',
    'event_curfew_log',
    'event_morning_log',
    'event_attendance_log',
    'event_manifest',
    'event_roster_bookings',
    'transport_trips',
    'site_issues_register'
  )
ORDER BY c.relname;
-- Expect every row: rls_enabled = true. Zero rows for a table name = table missing.

-- ─── 9c. RLS policies present (expect at least one policy per §12 table) ─────
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'venues',
    'venue_template_fields',
    'venue_safety_baseline_signoffs',
    'venue_safety_answers',
    'event_venue_reconfirmations',
    'event_venue_stops',
    'event_day_sessions',
    'event_bus_manifest',
    'event_curfew_log',
    'event_morning_log',
    'event_attendance_log'
  )
ORDER BY tablename, policyname;
-- Expect readable + writable + updatable per table (deletable if 2026-07-06 delete policy ran).

-- ─── 10. OPTIONAL backfill — trip_kind on legacy transport_trips ─────────────
-- Safe to re-run. Skip if you prefer; new hops set trip_kind in app code.
/*
UPDATE public.transport_trips
   SET trip_kind = 'day_centre'
 WHERE trip_kind IS NULL
   AND bus_run_code IS NOT NULL;

UPDATE public.transport_trips
   SET trip_kind = 'event'
 WHERE trip_kind IS NULL
   AND event_id IS NOT NULL;
*/
