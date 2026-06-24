-- 2026-07-11 — Per-client expected arrival/departure clocks on the
-- recurring schedule. Feeds the morning seeder (seedRollFromSchedules)
-- so each participant card opens with their own custom expected time
-- instead of the facility-wide 09:00 fallback.
--
-- Apply via Supabase SQL editor.

ALTER TABLE public.participant_attendance_schedules
  ADD COLUMN IF NOT EXISTS expected_arrival_time   time NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS expected_departure_time time NOT NULL DEFAULT '15:00';

COMMENT ON COLUMN public.participant_attendance_schedules.expected_arrival_time
  IS 'HH:MM Sydney local — read by client-attendance seeder for daily roll generation.';
COMMENT ON COLUMN public.participant_attendance_schedules.expected_departure_time
  IS 'HH:MM Sydney local — afternoon departure expectation for roster + transit planning.';
