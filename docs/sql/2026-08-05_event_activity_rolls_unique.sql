-- =============================================================================
-- 2026-08-05 — event_activity_rolls UNIQUE + defaults (TEST bootstrap)
-- =============================================================================
--
-- Symptom: Event Deliver open activity / seed roll POST event_activity_rolls
--   onConflict=venue_stop_id,participant_id → 400 / 42P10
--   there is no unique or exclusion constraint matching the ON CONFLICT
--
-- Cause: TEST bootstrap CREATE TABLE IF NOT EXISTS built event_activity_rolls
--   without UNIQUE(venue_stop_id, participant_id) and without status DEFAULT.
--
-- App fix: upsert falls back to insert-missing when UNIQUE is absent.
-- This SQL hardens the DB (+ FKs for embeds).
--
-- Idempotent. Run on TEST (and DEV for parity).
-- =============================================================================

DELETE FROM public.event_activity_rolls r
WHERE NOT EXISTS (
        SELECT 1 FROM public.event_venue_stops s WHERE s.id = r.venue_stop_id
      )
   OR NOT EXISTS (
        SELECT 1 FROM public.event_day_sessions d WHERE d.id = r.event_day_session_id
      )
   OR NOT EXISTS (
        SELECT 1 FROM public.participants p WHERE p.id = r.participant_id
      );

DELETE FROM public.event_activity_rolls a
USING public.event_activity_rolls b
WHERE a.venue_stop_id = b.venue_stop_id
  AND a.participant_id = b.participant_id
  AND a.ctid < b.ctid;

ALTER TABLE public.event_activity_rolls
  ALTER COLUMN status SET DEFAULT 'expected';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_activity_rolls_unique_person_per_stop'
  ) THEN
    ALTER TABLE public.event_activity_rolls
      ADD CONSTRAINT event_activity_rolls_unique_person_per_stop
      UNIQUE (venue_stop_id, participant_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_activity_rolls_venue_stop_id_fkey'
  ) THEN
    ALTER TABLE public.event_activity_rolls
      ADD CONSTRAINT event_activity_rolls_venue_stop_id_fkey
      FOREIGN KEY (venue_stop_id)
      REFERENCES public.event_venue_stops(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_activity_rolls_event_day_session_id_fkey'
  ) THEN
    ALTER TABLE public.event_activity_rolls
      ADD CONSTRAINT event_activity_rolls_event_day_session_id_fkey
      FOREIGN KEY (event_day_session_id)
      REFERENCES public.event_day_sessions(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_activity_rolls_participant_id_fkey'
  ) THEN
    ALTER TABLE public.event_activity_rolls
      ADD CONSTRAINT event_activity_rolls_participant_id_fkey
      FOREIGN KEY (participant_id)
      REFERENCES public.participants(id)
      ON DELETE CASCADE;
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_activity_rolls TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- Validation:
-- SELECT conname, contype
-- FROM pg_constraint
-- WHERE conrelid = 'public.event_activity_rolls'::regclass
--   AND conname = 'event_activity_rolls_unique_person_per_stop';
