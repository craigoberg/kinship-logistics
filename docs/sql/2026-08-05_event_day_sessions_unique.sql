-- =============================================================================
-- 2026-08-05 — event_day_sessions UNIQUE(event_id, session_date) (TEST bootstrap)
-- =============================================================================
--
-- Symptom: Event Manage save / seed trip days fails with:
--   there is no unique or exclusion constraint matching the ON CONFLICT
--   specification (42P10) on event_day_sessions upsert
--   onConflict=event_id,session_date
--
-- Cause: TEST bootstrap CREATE TABLE IF NOT EXISTS built event_day_sessions
--   without UNIQUE(event_id, session_date) and without phase DEFAULT 'planning'.
--
-- App fix: seed falls back to insert-missing when UNIQUE is absent.
-- This SQL hardens the DB.
--
-- Idempotent. Run on TEST (and DEV for parity).
-- =============================================================================

-- Orphans would block FK add
DELETE FROM public.event_day_sessions s
WHERE NOT EXISTS (
  SELECT 1 FROM public.event_manifest m WHERE m.id = s.event_id
);

-- Keep one row per (event, date) before UNIQUE
DELETE FROM public.event_day_sessions a
USING public.event_day_sessions b
WHERE a.event_id = b.event_id
  AND a.session_date = b.session_date
  AND a.ctid < b.ctid;

ALTER TABLE public.event_day_sessions
  ALTER COLUMN phase SET DEFAULT 'planning';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_day_sessions_event_id_session_date_key'
  ) THEN
    ALTER TABLE public.event_day_sessions
      ADD CONSTRAINT event_day_sessions_event_id_session_date_key
      UNIQUE (event_id, session_date);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_day_sessions_event_id_fkey'
  ) THEN
    ALTER TABLE public.event_day_sessions
      ADD CONSTRAINT event_day_sessions_event_id_fkey
      FOREIGN KEY (event_id)
      REFERENCES public.event_manifest(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS event_day_sessions_event_date_idx
  ON public.event_day_sessions (event_id, session_date);

-- Validation (expect UNIQUE row):
-- SELECT conname, contype
-- FROM pg_constraint
-- WHERE conrelid = 'public.event_day_sessions'::regclass
--   AND conname IN (
--     'event_day_sessions_event_id_session_date_key',
--     'event_day_sessions_event_id_fkey'
--   );
