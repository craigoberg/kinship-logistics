-- Venue hop manifest legs (§11 / §12.4.3) — 2026-06-30
-- leg_kind is text without DB enum; app writes venue_to_venue for in-day hops.

COMMENT ON COLUMN public.trip_legs.leg_kind IS
  'Includes venue_to_venue for event_venue_hop trips (single leg between itinerary stops).';
