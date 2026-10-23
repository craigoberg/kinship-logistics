-- Travel: the bus stop for the meeting point and the bus stop home from the
-- departure point are stored separately. A carer on a participant booking
-- has their own Bus / Self and their own two addresses.
-- Idempotent. "Success. No rows returned" is expected.

ALTER TABLE public.event_roster_bookings
  ADD COLUMN IF NOT EXISTS trip_return_address_override text,
  ADD COLUMN IF NOT EXISTS carer_outbound_transport_mode text,
  ADD COLUMN IF NOT EXISTS carer_return_transport_mode text,
  ADD COLUMN IF NOT EXISTS carer_trip_pickup_address_override text,
  ADD COLUMN IF NOT EXISTS carer_trip_return_address_override text,
  ADD COLUMN IF NOT EXISTS carer_pickup_order integer;

ALTER TABLE public.event_support_bookings
  ADD COLUMN IF NOT EXISTS trip_return_address_override text;

-- Expect 7 rows (6 on event_roster_bookings, 1 on event_support_bookings):
-- SELECT table_name, column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND (
--     (table_name = 'event_roster_bookings' AND column_name IN (
--       'trip_return_address_override',
--       'carer_outbound_transport_mode',
--       'carer_return_transport_mode',
--       'carer_trip_pickup_address_override',
--       'carer_trip_return_address_override',
--       'carer_pickup_order'
--     ))
--     OR (table_name = 'event_support_bookings' AND column_name = 'trip_return_address_override')
--   )
-- ORDER BY table_name, column_name;
