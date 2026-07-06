-- 2026-07-04 Phase 8 — Event-floor attendance + location open (§12.4.2 amendment)
--
-- Mirrors client_attendance_log for outing temporary-centre accountability.
-- Adds `active` phase to event_day_sessions (hard open = event floor live).

-- ---------------------------------------------------------------------------
-- 1. event_attendance_log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_attendance_log (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_day_session_id    uuid NOT NULL REFERENCES public.event_day_sessions(id) ON DELETE CASCADE,
  participant_id          uuid NOT NULL,
  expected_arrival_at     timestamptz NOT NULL,
  arrival_method          text NOT NULL DEFAULT 'bus'
                          CHECK (arrival_method IN ('bus','private','walk_in','other')),
  checked_in_at           timestamptz,
  checked_in_by           uuid,
  checked_out_at          timestamptz,
  checked_out_by          uuid,
  status                  text NOT NULL DEFAULT 'expected'
                          CHECK (status IN ('expected','checked_in','checked_out','absent')),
  return_transport        text CHECK (return_transport IN ('bus','self')),
  escalation_issue_id     uuid REFERENCES public.site_issues_register(id) ON DELETE SET NULL,
  escalation_severity     text CHECK (escalation_severity IN ('yellow','red')),
  escalation_raised_at    timestamptz,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_day_session_id, participant_id)
);

CREATE INDEX IF NOT EXISTS event_attendance_log_session_idx
  ON public.event_attendance_log (event_day_session_id);
CREATE INDEX IF NOT EXISTS event_attendance_log_status_idx
  ON public.event_attendance_log (status);

COMMENT ON TABLE public.event_attendance_log IS
  'Event-floor arrival/departure roll — mirrors client_attendance_log (§12.4.2).';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_attendance_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_attendance_log TO anon;
GRANT ALL ON public.event_attendance_log TO service_role;

ALTER TABLE public.event_attendance_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_attendance_log readable" ON public.event_attendance_log;
CREATE POLICY "event_attendance_log readable"
  ON public.event_attendance_log FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "event_attendance_log writable" ON public.event_attendance_log;
CREATE POLICY "event_attendance_log writable"
  ON public.event_attendance_log FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "event_attendance_log updatable" ON public.event_attendance_log;
CREATE POLICY "event_attendance_log updatable"
  ON public.event_attendance_log FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.touch_event_attendance_log_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_event_attendance_log ON public.event_attendance_log;
CREATE TRIGGER trg_touch_event_attendance_log
  BEFORE UPDATE ON public.event_attendance_log
  FOR EACH ROW EXECUTE FUNCTION public.touch_event_attendance_log_updated_at();

-- ---------------------------------------------------------------------------
-- 2. event_day_sessions — add `active` phase (§12.4.1 hard open)
-- ---------------------------------------------------------------------------

ALTER TABLE public.event_day_sessions DROP CONSTRAINT IF EXISTS event_day_sessions_phase_check;

ALTER TABLE public.event_day_sessions
  ADD CONSTRAINT event_day_sessions_phase_check
  CHECK (phase IN (
    'planning',
    'pre_departure',
    'active',
    'in_transit',
    'at_base',
    'closed_orderly',
    'closed_incident'
  ));

COMMENT ON COLUMN public.event_day_sessions.phase IS
  'active = trip leader opened location (event floor live). pre_departure retained for legacy rows.';
