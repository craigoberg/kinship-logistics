-- =============================================================================
-- 2026-08-05 — event morning/curfew (and attendance) FKs for PostgREST embeds
-- =============================================================================
--
-- Symptom (Event Deliver evening/morning roll):
--   GET .../event_curfew_log?select=*,participants(first_name,last_name)&...
--   → 400 Bad Request (no relationship in schema cache)
--
-- Cause: TEST OpenAPI bootstrap created these tables without FOREIGN KEYs.
-- PostgREST needs participant_id → participants to embed names.
--
-- Also wires event_day_session_id → event_day_sessions and the same for
-- event_morning_log + event_attendance_log (same embed pattern).
--
-- Idempotent. Run on TEST (and DEV for parity). Reload schema at end.
-- =============================================================================

-- Orphans would block FK add
DELETE FROM public.event_curfew_log c
WHERE NOT EXISTS (
        SELECT 1 FROM public.participants p WHERE p.id = c.participant_id
      )
   OR NOT EXISTS (
        SELECT 1 FROM public.event_day_sessions s WHERE s.id = c.event_day_session_id
      );

DELETE FROM public.event_morning_log m
WHERE NOT EXISTS (
        SELECT 1 FROM public.participants p WHERE p.id = m.participant_id
      )
   OR NOT EXISTS (
        SELECT 1 FROM public.event_day_sessions s WHERE s.id = m.event_day_session_id
      );

DELETE FROM public.event_attendance_log a
WHERE NOT EXISTS (
        SELECT 1 FROM public.participants p WHERE p.id = a.participant_id
      )
   OR NOT EXISTS (
        SELECT 1 FROM public.event_day_sessions s WHERE s.id = a.event_day_session_id
      );

-- ── event_curfew_log ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.event_curfew_log'::regclass
      AND conname = 'event_curfew_log_participant_id_fkey'
  ) THEN
    ALTER TABLE public.event_curfew_log
      ADD CONSTRAINT event_curfew_log_participant_id_fkey
      FOREIGN KEY (participant_id)
      REFERENCES public.participants(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.event_curfew_log'::regclass
      AND conname = 'event_curfew_log_event_day_session_id_fkey'
  ) THEN
    ALTER TABLE public.event_curfew_log
      ADD CONSTRAINT event_curfew_log_event_day_session_id_fkey
      FOREIGN KEY (event_day_session_id)
      REFERENCES public.event_day_sessions(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- ── event_morning_log ───────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.event_morning_log'::regclass
      AND conname = 'event_morning_log_participant_id_fkey'
  ) THEN
    ALTER TABLE public.event_morning_log
      ADD CONSTRAINT event_morning_log_participant_id_fkey
      FOREIGN KEY (participant_id)
      REFERENCES public.participants(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.event_morning_log'::regclass
      AND conname = 'event_morning_log_event_day_session_id_fkey'
  ) THEN
    ALTER TABLE public.event_morning_log
      ADD CONSTRAINT event_morning_log_event_day_session_id_fkey
      FOREIGN KEY (event_day_session_id)
      REFERENCES public.event_day_sessions(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- ── event_attendance_log (arrival roll embeds / joins) ───────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.event_attendance_log'::regclass
      AND conname = 'event_attendance_log_participant_id_fkey'
  ) THEN
    ALTER TABLE public.event_attendance_log
      ADD CONSTRAINT event_attendance_log_participant_id_fkey
      FOREIGN KEY (participant_id)
      REFERENCES public.participants(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.event_attendance_log'::regclass
      AND conname = 'event_attendance_log_event_day_session_id_fkey'
  ) THEN
    ALTER TABLE public.event_attendance_log
      ADD CONSTRAINT event_attendance_log_event_day_session_id_fkey
      FOREIGN KEY (event_day_session_id)
      REFERENCES public.event_day_sessions(id)
      ON DELETE CASCADE;
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_curfew_log TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_morning_log TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_attendance_log TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- Validation (expect participant + session FKs on curfew):
-- SELECT conname, confrelid::regclass AS references_table
-- FROM pg_constraint
-- WHERE conrelid = 'public.event_curfew_log'::regclass
--   AND contype = 'f'
-- ORDER BY conname;
