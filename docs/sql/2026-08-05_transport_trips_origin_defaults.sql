-- =============================================================================
-- 2026-08-05 — transport_trips trip_origin / trip_return defaults (TEST)
-- =============================================================================
--
-- Symptom (Event Deliver prepare hop / board bus):
--   null value in column "trip_origin" of relation "transport_trips"
--   violates not-null constraint
--
-- Cause: TEST bootstrap has trip_origin / trip_return NOT NULL with no DEFAULT.
-- Proper migration (2026-06-30_trip_flexible_origin.sql) uses DEFAULT 'depot'.
--
-- App fix: getOrCreateEventHopTrip sends trip_origin='depot', trip_return='none'.
-- This SQL hardens the DB.
--
-- Idempotent. Run on TEST (and DEV for parity).
-- =============================================================================

ALTER TABLE public.transport_trips
  ALTER COLUMN trip_origin SET DEFAULT 'depot';

ALTER TABLE public.transport_trips
  ALTER COLUMN trip_return SET DEFAULT 'depot';

UPDATE public.transport_trips
   SET trip_origin = COALESCE(trip_origin, 'depot')
 WHERE trip_origin IS NULL;

UPDATE public.transport_trips
   SET trip_return = COALESCE(trip_return, 'depot')
 WHERE trip_return IS NULL;

-- Validation:
-- SELECT column_name, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'transport_trips'
--   AND column_name IN ('trip_origin', 'trip_return');
