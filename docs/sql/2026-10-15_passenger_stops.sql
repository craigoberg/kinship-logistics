-- Passenger stops on an outing itinerary.
-- A person whose pickup is not the meeting point gets a pickup row.
-- A person who leaves before the departure point gets a drop-off row.
-- Existing bookings stay NULL: that still means a door on the way to the
-- meeting point, and a door on the way home. New rows default to the
-- meeting point and the departure point.

ALTER TABLE public.event_venue_stops
  ADD COLUMN IF NOT EXISTS street_address text;

ALTER TABLE public.event_venue_stops
  DROP CONSTRAINT IF EXISTS event_venue_stops_activity_kind_check;

ALTER TABLE public.event_venue_stops
  ADD CONSTRAINT event_venue_stops_activity_kind_check
  CHECK (activity_kind IN (
    'venue',
    'meal',
    'medication_round',
    'passenger_pickup',
    'passenger_dropoff'
  ));

ALTER TABLE public.event_roster_bookings
  ADD COLUMN IF NOT EXISTS pickup_join text,
  ADD COLUMN IF NOT EXISTS alight_mode text,
  ADD COLUMN IF NOT EXISTS carer_pickup_join text,
  ADD COLUMN IF NOT EXISTS carer_alight_mode text;

ALTER TABLE public.event_support_bookings
  ADD COLUMN IF NOT EXISTS pickup_join text,
  ADD COLUMN IF NOT EXISTS alight_mode text;

ALTER TABLE public.event_roster_bookings
  ALTER COLUMN pickup_join SET DEFAULT 'meeting_point',
  ALTER COLUMN alight_mode SET DEFAULT 'departure_point';

ALTER TABLE public.event_roster_bookings
  ALTER COLUMN carer_pickup_join SET DEFAULT 'meeting_point',
  ALTER COLUMN carer_alight_mode SET DEFAULT 'departure_point';

ALTER TABLE public.event_support_bookings
  ALTER COLUMN pickup_join SET DEFAULT 'meeting_point',
  ALTER COLUMN alight_mode SET DEFAULT 'departure_point';

ALTER TABLE public.event_roster_bookings
  DROP CONSTRAINT IF EXISTS event_roster_bookings_pickup_join_check;
ALTER TABLE public.event_roster_bookings
  ADD CONSTRAINT event_roster_bookings_pickup_join_check
  CHECK (pickup_join IS NULL OR pickup_join IN ('meeting_point', 'home', 'address'));

ALTER TABLE public.event_roster_bookings
  DROP CONSTRAINT IF EXISTS event_roster_bookings_alight_mode_check;
ALTER TABLE public.event_roster_bookings
  ADD CONSTRAINT event_roster_bookings_alight_mode_check
  CHECK (alight_mode IS NULL OR alight_mode IN ('departure_point', 'home', 'same', 'address'));

ALTER TABLE public.event_roster_bookings
  DROP CONSTRAINT IF EXISTS event_roster_bookings_carer_pickup_join_check;
ALTER TABLE public.event_roster_bookings
  ADD CONSTRAINT event_roster_bookings_carer_pickup_join_check
  CHECK (carer_pickup_join IS NULL OR carer_pickup_join IN ('meeting_point', 'home', 'address'));

ALTER TABLE public.event_roster_bookings
  DROP CONSTRAINT IF EXISTS event_roster_bookings_carer_alight_mode_check;
ALTER TABLE public.event_roster_bookings
  ADD CONSTRAINT event_roster_bookings_carer_alight_mode_check
  CHECK (carer_alight_mode IS NULL OR carer_alight_mode IN ('departure_point', 'home', 'same', 'address'));

ALTER TABLE public.event_support_bookings
  DROP CONSTRAINT IF EXISTS event_support_bookings_pickup_join_check;
ALTER TABLE public.event_support_bookings
  ADD CONSTRAINT event_support_bookings_pickup_join_check
  CHECK (pickup_join IS NULL OR pickup_join IN ('meeting_point', 'home', 'address'));

ALTER TABLE public.event_support_bookings
  DROP CONSTRAINT IF EXISTS event_support_bookings_alight_mode_check;
ALTER TABLE public.event_support_bookings
  ADD CONSTRAINT event_support_bookings_alight_mode_check
  CHECK (alight_mode IS NULL OR alight_mode IN ('departure_point', 'home', 'same', 'address'));

-- Validation (expect 2 rows, both YES):
-- SELECT column_name,
--        CASE WHEN column_default LIKE '%meeting_point%' OR column_default LIKE '%departure_point%'
--             THEN 'YES' ELSE 'NO' END AS has_default
-- FROM information_schema.columns
-- WHERE table_name = 'event_roster_bookings'
--   AND column_name IN ('pickup_join', 'alight_mode');
--
-- Validation (expect passenger_pickup and passenger_dropoff inside the check):
-- SELECT pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conname = 'event_venue_stops_activity_kind_check';
