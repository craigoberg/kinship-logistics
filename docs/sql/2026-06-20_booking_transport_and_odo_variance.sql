-- 2026-06-20  Roster: participant transport flag + Manifest: odometer variance reason
-- ------------------------------------------------------------------------------------

-- 1. event_roster_bookings.participant_transport_required
ALTER TABLE public.event_roster_bookings
  ADD COLUMN IF NOT EXISTS participant_transport_required boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.event_roster_bookings.participant_transport_required IS
  'Whether the participant requires a bus seat for this booking.';

-- 2. transport_trips.start_odometer_variance_reason
ALTER TABLE public.transport_trips
  ADD COLUMN IF NOT EXISTS start_odometer_variance_reason text;

COMMENT ON COLUMN public.transport_trips.start_odometer_variance_reason IS
  'Driver-supplied justification when the opening odometer deviates from the prior closing reading by more than the variance threshold.';
