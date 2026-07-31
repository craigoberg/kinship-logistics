-- 2026-07-30 — TEST: event_manifest primary_venue FK for PostgREST embeds
--
-- Symptom (Trip Report / Event Manage):
--   GET .../event_manifest?select=*,venues!event_manifest_primary_venue_id_fkey(name)
--   → 400 Bad Request / no relationship in schema cache
--
-- Cause: TEST bootstrap has primary_venue_id column without FOREIGN KEY.
-- App uses the named hint event_manifest_primary_venue_id_fkey (also
-- base_hotel_venue_id FKs venues — need disambiguation).
--
-- Safe / idempotent on DEV and TEST. Run in Supabase SQL Editor → Run All.

-- ---------------------------------------------------------------------------
-- 0) Orphan check (should return 0 rows)
-- ---------------------------------------------------------------------------
-- SELECT id, primary_venue_id
-- FROM public.event_manifest
-- WHERE primary_venue_id IS NOT NULL
--   AND NOT EXISTS (SELECT 1 FROM public.venues v WHERE v.id = primary_venue_id);

-- ---------------------------------------------------------------------------
-- 1) primary_venue_id → venues (required name for app embed hint)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.event_manifest'::regclass
      AND contype = 'f'
      AND conname = 'event_manifest_primary_venue_id_fkey'
  ) THEN
    ALTER TABLE public.event_manifest
      ADD CONSTRAINT event_manifest_primary_venue_id_fkey
      FOREIGN KEY (primary_venue_id)
      REFERENCES public.venues(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) base_hotel_venue_id → venues (multi-day; also FKs venues)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'event_manifest'
      AND column_name = 'base_hotel_venue_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.event_manifest'::regclass
      AND contype = 'f'
      AND conname = 'event_manifest_base_hotel_venue_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE public.event_manifest
        ADD CONSTRAINT event_manifest_base_hotel_venue_id_fkey
        FOREIGN KEY (base_hotel_venue_id)
        REFERENCES public.venues(id)
        ON DELETE SET NULL;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'base_hotel_venue_id FK skipped: %', SQLERRM;
    END;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Validation (expect primary_venue_id → venues)
-- ---------------------------------------------------------------------------
-- SELECT conname, confrelid::regclass AS references_table
-- FROM pg_constraint
-- WHERE conrelid = 'public.event_manifest'::regclass
--   AND contype = 'f'
--   AND conname LIKE '%venue%'
-- ORDER BY conname;
