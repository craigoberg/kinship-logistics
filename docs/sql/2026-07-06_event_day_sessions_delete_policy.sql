-- 2026-07-06 — Add DELETE RLS policies for outing event tables
--
-- The Phase 0 migration (2026-07-16_venue_registry_outing_trips_phase0.sql)
-- granted DELETE at the table level but only created SELECT/INSERT/UPDATE
-- policies. With RLS enabled this blocked all deletes silently.
--
-- Apply this in Supabase SQL editor to allow trip-day and itinerary-stop
-- management (reset, re-date, remove stale rows).

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'venues',
    'venue_template_fields',
    'venue_safety_baseline_signoffs',
    'venue_safety_answers',
    'event_venue_reconfirmations',
    'event_venue_stops',
    'event_day_sessions',
    'event_bus_manifest',
    'event_curfew_log',
    'event_morning_log'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%I deletable" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "%I deletable" ON public.%I FOR DELETE TO anon, authenticated USING (true)',
      t, t
    );
  END LOOP;
END;
$$;

-- Same for event_attendance_log (Phase 8 migration also missed DELETE policy)
DROP POLICY IF EXISTS "event_attendance_log deletable" ON public.event_attendance_log;
CREATE POLICY "event_attendance_log deletable"
  ON public.event_attendance_log FOR DELETE TO anon, authenticated USING (true);

NOTIFY pgrst, 'reload schema';
