-- 2026-07-12 — Centre Operating Hours master defaults + symmetrical
-- departure escalation columns.
--
-- Apply via Supabase SQL editor.
--
-- Adds:
--  • public.centre_operating_hours — 7-row Mon→Sun matrix of facility
--    open/close defaults. Tier 2 of the seeder priority ladder.
--  • client_attendance_log.expected_departure_at  (timestamptz)
--  • client_attendance_log.departure_issue_id     (single-rail pointer)
--  • client_attendance_log.departure_severity     (yellow|red)
--  • client_attendance_log.departure_raised_at    (timestamptz)
--  • client_attendance_log.departure_red_sms_dispatched_at (timestamptz)
--  • Two new system_parameters rows for the symmetrical thresholds.

-- ---------------------------------------------------------------------------
-- 1. centre_operating_hours
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.centre_operating_hours (
  day_of_week           text PRIMARY KEY
                        CHECK (day_of_week IN
                          ('DAY-MON','DAY-TUE','DAY-WED','DAY-THU',
                           'DAY-FRI','DAY-SAT','DAY-SUN')),
  open_time             time NOT NULL DEFAULT '09:00',
  close_time            time NOT NULL DEFAULT '15:00',
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by_staff_id   uuid
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.centre_operating_hours TO authenticated;
GRANT SELECT ON public.centre_operating_hours TO anon;
GRANT ALL ON public.centre_operating_hours TO service_role;

ALTER TABLE public.centre_operating_hours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "centre_operating_hours readable" ON public.centre_operating_hours;
CREATE POLICY "centre_operating_hours readable"
  ON public.centre_operating_hours FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "centre_operating_hours writable" ON public.centre_operating_hours;
CREATE POLICY "centre_operating_hours writable"
  ON public.centre_operating_hours FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "centre_operating_hours updatable" ON public.centre_operating_hours;
CREATE POLICY "centre_operating_hours updatable"
  ON public.centre_operating_hours FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Seed the 7 weekday rows if missing.
INSERT INTO public.centre_operating_hours (day_of_week, open_time, close_time)
VALUES
  ('DAY-MON','09:00','15:00'),
  ('DAY-TUE','09:00','15:00'),
  ('DAY-WED','09:00','15:00'),
  ('DAY-THU','09:00','15:00'),
  ('DAY-FRI','09:00','15:00'),
  ('DAY-SAT','09:00','15:00'),
  ('DAY-SUN','09:00','15:00')
ON CONFLICT (day_of_week) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. client_attendance_log — departure rail columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.client_attendance_log
  ADD COLUMN IF NOT EXISTS expected_departure_at         timestamptz,
  ADD COLUMN IF NOT EXISTS departure_issue_id            uuid REFERENCES public.site_issues_register(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS departure_severity            text CHECK (departure_severity IN ('yellow','red')),
  ADD COLUMN IF NOT EXISTS departure_raised_at           timestamptz,
  ADD COLUMN IF NOT EXISTS departure_red_sms_dispatched_at timestamptz;

CREATE INDEX IF NOT EXISTS client_attendance_log_expected_dep_idx
  ON public.client_attendance_log (expected_departure_at);

-- ---------------------------------------------------------------------------
-- 3. system_parameters seed rows for departure thresholds
-- ---------------------------------------------------------------------------
INSERT INTO public.system_parameters (key, value, description)
VALUES
  ('attendance_departure_yellow_threshold_mins',
   to_jsonb(30),
   'Minutes past expected departure time before a YELLOW [DEPARTURE] anomaly is raised on the attendance card.'),
  ('attendance_departure_red_threshold_mins',
   to_jsonb(60),
   'Minutes past expected departure time before the same row is escalated to RED and the GatewayAPI Manager SMS broadcast is triggered.'),
  ('attendance_departure_red_sms_recipients',
   to_jsonb(''::text),
   'Comma-separated E.164 recipient list for the RED [DEPARTURE] SMS broadcast. When blank, falls back to every staff_registry row with staff_role ILIKE %Manager%.')
ON CONFLICT (key) DO NOTHING;
