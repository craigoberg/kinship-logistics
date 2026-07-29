-- ============================================================================
-- 2026-07-29 — TEST fix: client_attendance_log unique (session, participant)
--
-- OpenAPI bootstrap CREATE TABLE shells omitted UNIQUE constraints.
-- Day Centre seed uses upsert ON CONFLICT (session_id, participant_id) and
-- fails without this key ("Attendance roll could not initialise").
-- Safe on DEV if the constraint already exists.
-- ============================================================================

DO $$
BEGIN
  ALTER TABLE public.client_attendance_log
    ADD CONSTRAINT client_attendance_log_session_participant_key
    UNIQUE (session_id, participant_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN unique_violation THEN
    RAISE NOTICE 'Duplicate (session_id, participant_id) rows exist — clean duplicates then re-run.';
    RAISE;
END $$;
