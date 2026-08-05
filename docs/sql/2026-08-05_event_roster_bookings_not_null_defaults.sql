-- =============================================================================
-- 2026-08-05 — event_roster_bookings NOT NULL defaults (TEST bootstrap)
-- =============================================================================
--
-- Symptom: Event Manage → Add participant fails with:
--   null value in column "transport_med_bag_required" violates not-null constraint
--   (next: pickup_order / is_guest_booking on the same bootstrap shape)
--
-- Cause: TEST bootstrap CREATE TABLE IF NOT EXISTS built these as NOT NULL
--   with no DEFAULT. Proper migrations use:
--     transport_med_bag_required DEFAULT 'not_set'
--     pickup_order DEFAULT 0
--     is_guest_booking DEFAULT false
--
-- App fix: insertEventBooking always sends these values.
-- This SQL hardens the DB for omitted columns / other writers.
--
-- Idempotent. Run on TEST (and DEV for parity).
-- =============================================================================

ALTER TABLE public.event_roster_bookings
  ALTER COLUMN transport_med_bag_required SET DEFAULT 'not_set';

ALTER TABLE public.event_roster_bookings
  ALTER COLUMN pickup_order SET DEFAULT 0;

ALTER TABLE public.event_roster_bookings
  ALTER COLUMN is_guest_booking SET DEFAULT false;

UPDATE public.event_roster_bookings
   SET transport_med_bag_required = COALESCE(transport_med_bag_required, 'not_set')
 WHERE transport_med_bag_required IS NULL;

UPDATE public.event_roster_bookings
   SET pickup_order = COALESCE(pickup_order, 0)
 WHERE pickup_order IS NULL;

UPDATE public.event_roster_bookings
   SET is_guest_booking = COALESCE(is_guest_booking, false)
 WHERE is_guest_booking IS NULL;

-- Validation (expect defaults):
-- SELECT column_name, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'event_roster_bookings'
--   AND column_name IN (
--     'transport_med_bag_required',
--     'pickup_order',
--     'is_guest_booking'
--   );
