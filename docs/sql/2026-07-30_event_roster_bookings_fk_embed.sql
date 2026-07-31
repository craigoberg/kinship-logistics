-- 2026-07-30 — TEST: event_roster_bookings FKs for PostgREST embeds
--
-- Symptom (Event Manage / roster):
--   GET .../event_roster_bookings?select=*,participants!event_roster_bookings_participant_id_fkey!inner(...)
--   → 400 "Could not find a relationship between 'event_roster_bookings' and 'participants'"
--
-- Cause: 2026-07-29 TEST OpenAPI bootstrap created columns without FOREIGN KEYs.
-- PostgREST needs the named FK for the disambiguated embed (host_participant_id
-- also points at participants — BL-098).
--
-- Safe / idempotent on DEV and TEST. Run in Supabase SQL Editor → Run All.
-- If ADD CONSTRAINT fails on orphans, fix those rows first (validation query below).

-- ---------------------------------------------------------------------------
-- 0) Orphan check (should return 0 rows before adding FK)
-- ---------------------------------------------------------------------------
-- SELECT erb.id, erb.participant_id
-- FROM public.event_roster_bookings erb
-- LEFT JOIN public.participants p ON p.id = erb.participant_id
-- WHERE erb.participant_id IS NOT NULL AND p.id IS NULL;

-- ---------------------------------------------------------------------------
-- 1) participant_id → participants (required for Event Manage roster embed)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.event_roster_bookings'::regclass
      AND contype = 'f'
      AND conname = 'event_roster_bookings_participant_id_fkey'
  ) THEN
    ALTER TABLE public.event_roster_bookings
      ADD CONSTRAINT event_roster_bookings_participant_id_fkey
      FOREIGN KEY (participant_id)
      REFERENCES public.participants(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) event_id → event_manifest (other Event Manage embeds)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.event_roster_bookings'::regclass
      AND contype = 'f'
      AND conname = 'event_roster_bookings_event_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE public.event_roster_bookings
        ADD CONSTRAINT event_roster_bookings_event_id_fkey
        FOREIGN KEY (event_id)
        REFERENCES public.event_manifest(id)
        ON DELETE CASCADE;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'event_id FK skipped: %', SQLERRM;
    END;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) host_participant_id → participants (guest bookings — BL-098)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.event_roster_bookings'::regclass
      AND contype = 'f'
      AND conname = 'event_roster_bookings_host_participant_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE public.event_roster_bookings
        ADD CONSTRAINT event_roster_bookings_host_participant_id_fkey
        FOREIGN KEY (host_participant_id)
        REFERENCES public.participants(id)
        ON DELETE SET NULL;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'host_participant_id FK skipped: %', SQLERRM;
    END;
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_roster_bookings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_roster_bookings TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Validation (expect participant_id → participants at minimum)
-- ---------------------------------------------------------------------------
-- SELECT conname, confrelid::regclass AS references_table
-- FROM pg_constraint
-- WHERE conrelid = 'public.event_roster_bookings'::regclass
--   AND contype = 'f'
-- ORDER BY conname;
