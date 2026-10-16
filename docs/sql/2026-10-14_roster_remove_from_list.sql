-- Event Manage: take a settled cancellation off the roster without deleting
-- the booking or its payments. Adding the person again clears the stamp.
--
-- "Success. No rows returned" is expected (DDL only).

ALTER TABLE public.event_roster_bookings
  ADD COLUMN IF NOT EXISTS removed_from_roster_at timestamptz;

ALTER TABLE public.event_support_bookings
  ADD COLUMN IF NOT EXISTS removed_from_roster_at timestamptz;

COMMENT ON COLUMN public.event_roster_bookings.removed_from_roster_at IS
  'When set, a cancelled booking is hidden from Event Manage. Payments stay. Null = still listed.';

COMMENT ON COLUMN public.event_support_bookings.removed_from_roster_at IS
  'When set, a cancelled support booking is hidden from Event Manage. Payments stay. Null = still listed.';

-- Validation — expect 2 rows, data_type timestamp with time zone:
-- SELECT table_name, column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name IN ('event_roster_bookings', 'event_support_bookings')
--   AND column_name = 'removed_from_roster_at';
