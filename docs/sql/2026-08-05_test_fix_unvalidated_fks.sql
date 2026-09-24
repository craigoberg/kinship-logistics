-- ============================================================================
-- 2026-08-05 — TEST: fix 2 unvalidated FKs from align_dev_constraints
--
-- Unvalidated after align:
--   event_meal_service_rolls_venue_stop_id_fkey
--   trip_legs_trip_id_fkey
--
-- Cause: child rows point at missing parents. Clean orphans, then VALIDATE.
-- Safe / idempotent. Run in TEST SQL Editor → Run All.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Inspect orphans (expect rows before cleanup; 0 after)
-- ---------------------------------------------------------------------------
-- SELECT emsr.id, emsr.venue_stop_id
-- FROM public.event_meal_service_rolls emsr
-- LEFT JOIN public.event_venue_stops evs ON evs.id = emsr.venue_stop_id
-- WHERE evs.id IS NULL;

-- SELECT tl.id, tl.trip_id
-- FROM public.trip_legs tl
-- LEFT JOIN public.transport_trips tt ON tt.id = tl.trip_id
-- WHERE tl.trip_id IS NOT NULL AND tt.id IS NULL;

-- ---------------------------------------------------------------------------
-- 1) event_meal_service_rolls: delete rows with missing venue_stop
--    (venue_stop_id is NOT NULL — cannot null out)
-- ---------------------------------------------------------------------------
DELETE FROM public.event_meal_service_rolls emsr
WHERE NOT EXISTS (
  SELECT 1
  FROM public.event_venue_stops evs
  WHERE evs.id = emsr.venue_stop_id
);

-- ---------------------------------------------------------------------------
-- 2) trip_legs: null out trip_id when parent trip missing
--    (trip_id is nullable on DEV)
-- ---------------------------------------------------------------------------
UPDATE public.trip_legs tl
SET trip_id = NULL
WHERE tl.trip_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.transport_trips tt
    WHERE tt.id = tl.trip_id
  );

-- ---------------------------------------------------------------------------
-- 3) VALIDATE the two FKs
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_meal_service_rolls
      VALIDATE CONSTRAINT event_meal_service_rolls_venue_stop_id_fkey;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Still unvalidated event_meal_service_rolls_venue_stop_id_fkey: %', SQLERRM;
  END;

  BEGIN
    ALTER TABLE public.trip_legs
      VALIDATE CONSTRAINT trip_legs_trip_id_fkey;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Still unvalidated trip_legs_trip_id_fkey: %', SQLERRM;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- VALIDATION — expect 0 rows:
-- ---------------------------------------------------------------------------
-- SELECT rel.relname AS table_name, c.conname
-- FROM pg_constraint c
-- JOIN pg_class rel ON rel.oid = c.conrelid
-- JOIN pg_namespace n ON n.oid = rel.relnamespace
-- WHERE n.nspname = 'public' AND c.contype = 'f' AND NOT c.convalidated
-- ORDER BY 1, 2;
