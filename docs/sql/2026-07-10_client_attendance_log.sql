-- 2026-07-10 — Client Attendance Tracking & Day Centre Closure Module
--
-- Per-arrival roll for the Day Centre. One row per (session, participant),
-- auto-seeded from public.participant_attendance_schedules when the day is
-- declared. Drives the Section 4.4 tap-toggle roll, the single-row
-- YELLOW→RED overdue escalator, and the End-of-Day closure rail.
--
-- Single-rail rule: when a client is overdue past the configurable
-- thresholds we INSERT exactly ONE row into site_issues_register (severity
-- = 'yellow'), store its id on `escalation_issue_id`, and later UPDATE the
-- SAME row to severity = 'red' if the RED threshold expires. No duplicate
-- rows ever. Every state change writes an operational_ledger receipt via
-- the canonical writeToLedger() wrapper (guardrail §1.1).

CREATE TABLE IF NOT EXISTS public.client_attendance_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            uuid NOT NULL REFERENCES public.site_day_sessions(id) ON DELETE CASCADE,
  participant_id        uuid NOT NULL,
  expected_arrival_at   timestamptz NOT NULL,
  arrival_method        text NOT NULL DEFAULT 'bus'
                        CHECK (arrival_method IN ('bus','private','walk_in','other')),
  checked_in_at         timestamptz,
  checked_in_by         uuid,
  checked_out_at        timestamptz,
  checked_out_by        uuid,
  status                text NOT NULL DEFAULT 'expected'
                        CHECK (status IN ('expected','checked_in','checked_out','absent','accounted')),
  escalation_issue_id   uuid REFERENCES public.site_issues_register(id) ON DELETE SET NULL,
  escalation_severity   text CHECK (escalation_severity IN ('yellow','red')),
  escalation_raised_at  timestamptz,
  red_sms_dispatched_at timestamptz,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, participant_id)
);

CREATE INDEX IF NOT EXISTS client_attendance_log_session_idx
  ON public.client_attendance_log (session_id);
CREATE INDEX IF NOT EXISTS client_attendance_log_status_idx
  ON public.client_attendance_log (status);
CREATE INDEX IF NOT EXISTS client_attendance_log_expected_idx
  ON public.client_attendance_log (expected_arrival_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_attendance_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_attendance_log TO anon;
GRANT ALL ON public.client_attendance_log TO service_role;

ALTER TABLE public.client_attendance_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_attendance_log readable" ON public.client_attendance_log;
CREATE POLICY "client_attendance_log readable"
  ON public.client_attendance_log FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "client_attendance_log writable" ON public.client_attendance_log;
CREATE POLICY "client_attendance_log writable"
  ON public.client_attendance_log FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "client_attendance_log updatable" ON public.client_attendance_log;
CREATE POLICY "client_attendance_log updatable"
  ON public.client_attendance_log FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- Touch updated_at on any UPDATE.
CREATE OR REPLACE FUNCTION public.touch_client_attendance_log_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_client_attendance_log ON public.client_attendance_log;
CREATE TRIGGER trg_touch_client_attendance_log
  BEFORE UPDATE ON public.client_attendance_log
  FOR EACH ROW EXECUTE FUNCTION public.touch_client_attendance_log_updated_at();

-- ---------------------------------------------------------------------------
-- Tunable thresholds + SMS recipient list (system_parameters).
-- The recipient key is comma-separated E.164 strings; when NULL the server
-- route falls back to every staff_registry row with staff_role = 'Manager'.
-- ---------------------------------------------------------------------------

INSERT INTO public.system_parameters (key, value, description)
VALUES
  (
    'attendance_yellow_threshold_mins',
    '30'::jsonb,
    'Minutes overdue past expected_arrival_at before a YELLOW row is inserted into site_issues_register for a missing client.'
  ),
  (
    'attendance_red_threshold_mins',
    '60'::jsonb,
    'Minutes overdue past expected_arrival_at before the same site_issues_register row is mutated to RED and the Manager SMS pipeline fires.'
  ),
  (
    'attendance_red_sms_recipients',
    'null'::jsonb,
    'Comma-separated E.164 phone numbers to receive RED attendance escalations. When null, falls back to every staff_registry row with staff_role = ''Manager''.'
  )
ON CONFLICT (key) DO NOTHING;
