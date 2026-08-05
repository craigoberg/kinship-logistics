-- =============================================================================
-- 2026-08-05 — event floor log UNIQUE keys (TEST bootstrap)
-- =============================================================================
--
-- Symptom: Event Deliver arrival roll seed fails with:
--   there is no unique or exclusion constraint matching the ON CONFLICT
--   specification (42P10) on event_attendance_log
--   onConflict=event_day_session_id,participant_id
--
-- Cause: TEST bootstrap CREATE TABLE IF NOT EXISTS omitted UNIQUE pairs that
--   proper migrations define. Same shape on morning/curfew/med-alternate/meal rolls.
--
-- App fix: seedEventAttendanceRoll falls back to insert-missing + sends status.
-- This SQL hardens the DB.
--
-- Idempotent. Run on TEST (and DEV for parity).
-- =============================================================================

-- ── helpers: dedupe then add UNIQUE if missing ───────────────────────────────
DO $$
BEGIN
  -- event_attendance_log
  DELETE FROM public.event_attendance_log a
  USING public.event_attendance_log b
  WHERE a.event_day_session_id = b.event_day_session_id
    AND a.participant_id = b.participant_id
    AND a.ctid < b.ctid;

  ALTER TABLE public.event_attendance_log
    ALTER COLUMN status SET DEFAULT 'expected';
  ALTER TABLE public.event_attendance_log
    ALTER COLUMN arrival_method SET DEFAULT 'bus';

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_attendance_log_event_day_session_id_participant_id_key'
  ) THEN
    ALTER TABLE public.event_attendance_log
      ADD CONSTRAINT event_attendance_log_event_day_session_id_participant_id_key
      UNIQUE (event_day_session_id, participant_id);
  END IF;

  -- event_morning_log
  IF to_regclass('public.event_morning_log') IS NOT NULL THEN
    DELETE FROM public.event_morning_log a
    USING public.event_morning_log b
    WHERE a.event_day_session_id = b.event_day_session_id
      AND a.participant_id = b.participant_id
      AND a.ctid < b.ctid;

    ALTER TABLE public.event_morning_log
      ALTER COLUMN status SET DEFAULT 'expected';

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'event_morning_log_event_day_session_id_participant_id_key'
    ) THEN
      ALTER TABLE public.event_morning_log
        ADD CONSTRAINT event_morning_log_event_day_session_id_participant_id_key
        UNIQUE (event_day_session_id, participant_id);
    END IF;
  END IF;

  -- event_curfew_log
  IF to_regclass('public.event_curfew_log') IS NOT NULL THEN
    DELETE FROM public.event_curfew_log a
    USING public.event_curfew_log b
    WHERE a.event_day_session_id = b.event_day_session_id
      AND a.participant_id = b.participant_id
      AND a.ctid < b.ctid;

    ALTER TABLE public.event_curfew_log
      ALTER COLUMN status SET DEFAULT 'expected';

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'event_curfew_log_event_day_session_id_participant_id_key'
    ) THEN
      ALTER TABLE public.event_curfew_log
        ADD CONSTRAINT event_curfew_log_event_day_session_id_participant_id_key
        UNIQUE (event_day_session_id, participant_id);
    END IF;
  END IF;

  -- event_day_med_alternate_plans
  IF to_regclass('public.event_day_med_alternate_plans') IS NOT NULL THEN
    DELETE FROM public.event_day_med_alternate_plans a
    USING public.event_day_med_alternate_plans b
    WHERE a.event_day_session_id = b.event_day_session_id
      AND a.participant_id = b.participant_id
      AND a.ctid < b.ctid;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'event_day_med_alternate_plans_event_day_session_id_participant_id_key'
    ) THEN
      ALTER TABLE public.event_day_med_alternate_plans
        ADD CONSTRAINT event_day_med_alternate_plans_event_day_session_id_participant_id_key
        UNIQUE (event_day_session_id, participant_id);
    END IF;
  END IF;

  -- event_meal_service_rolls
  IF to_regclass('public.event_meal_service_rolls') IS NOT NULL THEN
    DELETE FROM public.event_meal_service_rolls a
    USING public.event_meal_service_rolls b
    WHERE a.venue_stop_id = b.venue_stop_id
      AND a.participant_id = b.participant_id
      AND a.ctid < b.ctid;

    ALTER TABLE public.event_meal_service_rolls
      ALTER COLUMN status SET DEFAULT 'expected';

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'event_meal_service_rolls_venue_stop_id_participant_id_key'
    ) THEN
      ALTER TABLE public.event_meal_service_rolls
        ADD CONSTRAINT event_meal_service_rolls_venue_stop_id_participant_id_key
        UNIQUE (venue_stop_id, participant_id);
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS event_attendance_log_session_idx
  ON public.event_attendance_log (event_day_session_id);

-- Validation (expect UNIQUE on attendance at minimum):
-- SELECT conname
-- FROM pg_constraint
-- WHERE conrelid = 'public.event_attendance_log'::regclass
--   AND contype = 'u';
