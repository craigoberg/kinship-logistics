-- =============================================================================
-- 2026-08-05 — event_venue_stops NOT NULL defaults (TEST bootstrap)
-- =============================================================================
--
-- Symptom: Event Manage itinerary / Add stop POST event_venue_stops → 400
--   null value in column "phase" / "movement_method" / "activity_kind"
--   violates not-null constraint
--
-- Cause: TEST bootstrap CREATE TABLE IF NOT EXISTS built these as NOT NULL
--   with no DEFAULT. Proper migrations use:
--     phase DEFAULT 'pending'
--     movement_method DEFAULT 'bus'
--     activity_kind DEFAULT 'venue'
--
-- App fix: upsertEventVenueStop + ensureEventItineraryStops always send them.
-- This SQL hardens the DB.
--
-- Idempotent. Run on TEST (and DEV for parity).
-- =============================================================================

ALTER TABLE public.event_venue_stops
  ALTER COLUMN phase SET DEFAULT 'pending';

ALTER TABLE public.event_venue_stops
  ALTER COLUMN movement_method SET DEFAULT 'bus';

ALTER TABLE public.event_venue_stops
  ALTER COLUMN activity_kind SET DEFAULT 'venue';

UPDATE public.event_venue_stops
   SET phase = COALESCE(phase, 'pending')
 WHERE phase IS NULL;

UPDATE public.event_venue_stops
   SET movement_method = COALESCE(movement_method, 'bus')
 WHERE movement_method IS NULL;

UPDATE public.event_venue_stops
   SET activity_kind = COALESCE(activity_kind, 'venue')
 WHERE activity_kind IS NULL;

-- Validation (expect defaults):
-- SELECT column_name, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'event_venue_stops'
--   AND column_name IN ('phase', 'movement_method', 'activity_kind');
