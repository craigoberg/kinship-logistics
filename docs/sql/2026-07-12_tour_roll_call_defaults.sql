-- 2026-07-12 — Default evening + morning roll call times (multi-day tours, §12.5)
--
-- Run in Supabase Dashboard → SQL Editor → Run All
--
-- Used when seeding event_day_sessions for multi-day events.
-- Coordinators can override per trip day; Admin → System Parameters edits defaults.

INSERT INTO public.system_parameters (key, value, description)
VALUES
  (
    'default_evening_roll_call_time',
    '"21:00"'::jsonb,
    'Default evening roll call time (24h HH:mm) for multi-day tour trip days. Maps to event_day_sessions.curfew_time at seed.'
  ),
  (
    'default_morning_roll_call_time',
    '"07:00"'::jsonb,
    'Default morning roll call time (24h HH:mm) for multi-day tour trip days. Maps to event_day_sessions.morning_roll_time at seed.'
  )
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description;

NOTIFY pgrst, 'reload schema';
