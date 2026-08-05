-- =============================================================================
-- 2026-08-05 — trip_legs boolean NOT NULL defaults (TEST bootstrap)
-- =============================================================================
--
-- Symptom: Manifest Start Run creates transport_trips then fails on trip_legs;
--   next open shows "No legs on this run" / LEG 0 OF 0 (orphan trip reused).
--
-- Cause: TEST bootstrap has:
--   medication_expected, medication_handover_confirmed, unexpected_medication_logged
--   as NOT NULL with no DEFAULT. App inserts omitted the last two.
--
-- App fix: inserts now send false; empty active trips are cancelled + recreated.
-- This SQL hardens the DB.
--
-- Idempotent. Run on TEST (and DEV for parity).
-- =============================================================================

ALTER TABLE public.trip_legs
  ALTER COLUMN medication_expected SET DEFAULT false;

ALTER TABLE public.trip_legs
  ALTER COLUMN medication_handover_confirmed SET DEFAULT false;

ALTER TABLE public.trip_legs
  ALTER COLUMN unexpected_medication_logged SET DEFAULT false;

UPDATE public.trip_legs
   SET medication_expected = COALESCE(medication_expected, false),
       medication_handover_confirmed = COALESCE(medication_handover_confirmed, false),
       unexpected_medication_logged = COALESCE(unexpected_medication_logged, false)
 WHERE medication_expected IS NULL
    OR medication_handover_confirmed IS NULL
    OR unexpected_medication_logged IS NULL;

-- Cancel orphan active Day Centre trips with zero legs (training cleanup)
UPDATE public.transport_trips t
SET status = 'cancelled',
    updated_at = now()
WHERE t.status NOT IN ('completed', 'cancelled')
  AND NOT EXISTS (
    SELECT 1 FROM public.trip_legs l WHERE l.trip_id = t.id
  );

-- Validation:
-- SELECT column_name, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'trip_legs'
--   AND column_name IN (
--     'medication_expected',
--     'medication_handover_confirmed',
--     'unexpected_medication_logged'
--   );
