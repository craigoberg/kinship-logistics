-- 2026-07-30 — TEST: event_venue_stops FKs for PostgREST embeds (Itinerary)
--
-- Symptom (Event Manage → Itinerary):
--   GET .../event_venue_stops?select=*,venues(name,venue_type,street_address)
--   → 400 Bad Request / no relationship in schema cache
--
-- Cause: TEST OpenAPI bootstrap created event_venue_stops without FOREIGN KEYs.
-- PostgREST needs venue_id → venues (and event_id → event_manifest) to embed.
--
-- Safe / idempotent on DEV and TEST. Run in Supabase SQL Editor → Run All.

-- ---------------------------------------------------------------------------
-- 0) Orphan check (should return 0 rows before venue FK)
-- ---------------------------------------------------------------------------
-- SELECT evs.id, evs.venue_id
-- FROM public.event_venue_stops evs
-- LEFT JOIN public.venues v ON v.id = evs.venue_id
-- WHERE evs.venue_id IS NOT NULL AND v.id IS NULL;

-- ---------------------------------------------------------------------------
-- 1) venue_id → venues (Itinerary embed)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.event_venue_stops'::regclass
      AND contype = 'f'
      AND conname = 'event_venue_stops_venue_id_fkey'
  ) THEN
    ALTER TABLE public.event_venue_stops
      ADD CONSTRAINT event_venue_stops_venue_id_fkey
      FOREIGN KEY (venue_id)
      REFERENCES public.venues(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) event_id → event_manifest
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.event_venue_stops'::regclass
      AND contype = 'f'
      AND conname = 'event_venue_stops_event_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_stops
        ADD CONSTRAINT event_venue_stops_event_id_fkey
        FOREIGN KEY (event_id)
        REFERENCES public.event_manifest(id)
        ON DELETE CASCADE;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'event_id FK skipped: %', SQLERRM;
    END;
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_venue_stops TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_venue_stops TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Validation (expect venue_id → venues at minimum)
-- ---------------------------------------------------------------------------
-- SELECT conname, confrelid::regclass AS references_table
-- FROM pg_constraint
-- WHERE conrelid = 'public.event_venue_stops'::regclass
--   AND contype = 'f'
-- ORDER BY conname;
