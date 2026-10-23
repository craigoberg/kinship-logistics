-- BL-122 — Unplanned walk-on (guest / client / carer) on a live event.
-- Flags late roster adds so Open location does not hard-block incomplete guest
-- intake, and so floor/office can see Walk-on · Intake incomplete.
--
-- Supabase SQL Editor may end with "Success. No rows returned" for DDL — expected.

ALTER TABLE public.event_roster_bookings
  ADD COLUMN IF NOT EXISTS is_walk_on boolean NOT NULL DEFAULT false;

ALTER TABLE public.event_roster_bookings
  ADD COLUMN IF NOT EXISTS walk_on_source text;

ALTER TABLE public.event_roster_bookings
  ADD COLUMN IF NOT EXISTS walk_on_boarded_leg_id uuid;

ALTER TABLE public.event_roster_bookings
  ADD COLUMN IF NOT EXISTS walk_on_issue_id uuid;

ALTER TABLE public.event_roster_bookings
  ADD COLUMN IF NOT EXISTS carer_is_walk_on boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_roster_bookings_walk_on_source_check'
  ) THEN
    ALTER TABLE public.event_roster_bookings
      ADD CONSTRAINT event_roster_bookings_walk_on_source_check
      CHECK (walk_on_source IS NULL OR walk_on_source IN ('manifest', 'venue'));
  END IF;
END $$;

COMMENT ON COLUMN public.event_roster_bookings.is_walk_on IS
  'BL-122: true when this booking was accepted on the night (not a planned office add).';
COMMENT ON COLUMN public.event_roster_bookings.walk_on_source IS
  'BL-122: manifest = boarded at a pickup stop; venue = self-transport at Event Deliver.';
COMMENT ON COLUMN public.event_roster_bookings.walk_on_boarded_leg_id IS
  'BL-122: trip_legs.id they boarded at (no new geographic stop).';
COMMENT ON COLUMN public.event_roster_bookings.walk_on_issue_id IS
  'BL-122: YELLOW Hub issue for office billing / intake follow-up.';
COMMENT ON COLUMN public.event_roster_bookings.carer_is_walk_on IS
  'BL-122: carer was attached on the night (host booking was already planned).';

CREATE INDEX IF NOT EXISTS event_roster_bookings_walk_on_idx
  ON public.event_roster_bookings (event_id)
  WHERE is_walk_on = true OR carer_is_walk_on = true;

-- ── Validation (expect 5 rows) ──────────────────────────────────────────────
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'event_roster_bookings'
--   AND column_name IN (
--     'is_walk_on', 'walk_on_source', 'walk_on_boarded_leg_id',
--     'walk_on_issue_id', 'carer_is_walk_on'
--   )
-- ORDER BY column_name;
