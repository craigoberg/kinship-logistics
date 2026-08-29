-- =============================================================================
-- 2026-08-29 — Support people floor parity (no-show / defer / event stages)
-- BL-125 leftover: staff / volunteer / carer match client clocks, not meals/meds.
-- =============================================================================
--
-- Run on DEV then TEST. SQL Editor "Success. No rows returned" is expected
-- for the DDL / GRANT body.
-- =============================================================================

-- ---------- 1) Day Centre support — overdue / defer columns ----------
ALTER TABLE public.support_attendance_log
  ADD COLUMN IF NOT EXISTS escalation_issue_id uuid
    REFERENCES public.site_issues_register(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS escalation_severity text
    CHECK (escalation_severity IS NULL OR escalation_severity IN ('yellow', 'red')),
  ADD COLUMN IF NOT EXISTS escalation_raised_at timestamptz,
  ADD COLUMN IF NOT EXISTS red_sms_dispatched_at timestamptz;

COMMENT ON COLUMN public.support_attendance_log.escalation_issue_id IS
  'BL-125: same Y→R no-show rail as client_attendance_log.';

-- ---------- 2) Event support check-in — expected clock + overdue ----------
ALTER TABLE public.event_support_attendance_log
  ADD COLUMN IF NOT EXISTS expected_arrival_at timestamptz,
  ADD COLUMN IF NOT EXISTS expected_departure_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalation_issue_id uuid
    REFERENCES public.site_issues_register(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS escalation_severity text
    CHECK (escalation_severity IS NULL OR escalation_severity IN ('yellow', 'red')),
  ADD COLUMN IF NOT EXISTS escalation_raised_at timestamptz,
  ADD COLUMN IF NOT EXISTS red_sms_dispatched_at timestamptz;

COMMENT ON COLUMN public.event_support_attendance_log.expected_arrival_at IS
  'BL-125: trip check-in expected clock (defer / no-show).';

-- ---------- 3) Morning / evening roll can name support people ----------
ALTER TABLE public.event_morning_log
  ALTER COLUMN participant_id DROP NOT NULL;
ALTER TABLE public.event_morning_log
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staff_registry(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS carer_id uuid REFERENCES public.carers_registry(id) ON DELETE CASCADE;

ALTER TABLE public.event_curfew_log
  ALTER COLUMN participant_id DROP NOT NULL;
ALTER TABLE public.event_curfew_log
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staff_registry(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS carer_id uuid REFERENCES public.carers_registry(id) ON DELETE CASCADE;

ALTER TABLE public.event_morning_log
  DROP CONSTRAINT IF EXISTS event_morning_log_event_day_session_id_participant_id_key;
ALTER TABLE public.event_curfew_log
  DROP CONSTRAINT IF EXISTS event_curfew_log_event_day_session_id_participant_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS event_morning_log_session_participant_uidx
  ON public.event_morning_log (event_day_session_id, participant_id)
  WHERE participant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS event_morning_log_session_staff_uidx
  ON public.event_morning_log (event_day_session_id, staff_id)
  WHERE staff_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS event_morning_log_session_carer_uidx
  ON public.event_morning_log (event_day_session_id, carer_id)
  WHERE carer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS event_curfew_log_session_participant_uidx
  ON public.event_curfew_log (event_day_session_id, participant_id)
  WHERE participant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS event_curfew_log_session_staff_uidx
  ON public.event_curfew_log (event_day_session_id, staff_id)
  WHERE staff_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS event_curfew_log_session_carer_uidx
  ON public.event_curfew_log (event_day_session_id, carer_id)
  WHERE carer_id IS NOT NULL;

DO $$
BEGIN
  ALTER TABLE public.event_morning_log
    DROP CONSTRAINT IF EXISTS event_morning_log_one_person_check;
  ALTER TABLE public.event_morning_log
    ADD CONSTRAINT event_morning_log_one_person_check CHECK (
      (participant_id IS NOT NULL AND staff_id IS NULL AND carer_id IS NULL)
      OR (staff_id IS NOT NULL AND participant_id IS NULL AND carer_id IS NULL)
      OR (carer_id IS NOT NULL AND participant_id IS NULL AND staff_id IS NULL)
    );
  ALTER TABLE public.event_curfew_log
    DROP CONSTRAINT IF EXISTS event_curfew_log_one_person_check;
  ALTER TABLE public.event_curfew_log
    ADD CONSTRAINT event_curfew_log_one_person_check CHECK (
      (participant_id IS NOT NULL AND staff_id IS NULL AND carer_id IS NULL)
      OR (staff_id IS NOT NULL AND participant_id IS NULL AND carer_id IS NULL)
      OR (carer_id IS NOT NULL AND participant_id IS NULL AND staff_id IS NULL)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Validation (DDL-only run returns no rows — that is expected):
--
-- Expect 4 escalation columns on support day log:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'support_attendance_log'
--     AND column_name IN (
--       'escalation_issue_id','escalation_severity',
--       'escalation_raised_at','red_sms_dispatched_at')
--   ORDER BY column_name;
--
-- Expect expected_arrival_at on event support log:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'event_support_attendance_log'
--     AND column_name = 'expected_arrival_at';
--
-- Expect staff_id + carer_id on both roll tables:
--   SELECT table_name, column_name FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name IN ('event_morning_log','event_curfew_log')
--     AND column_name IN ('staff_id','carer_id')
--   ORDER BY table_name, column_name;
-- =============================================================================
