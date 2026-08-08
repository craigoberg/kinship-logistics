-- Event Deliver — ask movement each hop; allow NULL until chosen; add `other`
-- 2026-08-07
--
-- Problem: event_venue_stops.movement_method DEFAULT 'bus' + Reset Start of Day
-- writing 'bus' made Programme skip "How are you getting to {next}?" and jump
-- straight to Release group to bus.
--
-- Also adds movement_method = 'other' (train / tram / public transport / etc.)
-- — leave-from-current treats it like walk (activity check-in, no Manifest hop).
--
-- "Success. No rows returned" is normal for this DDL script.

-- ── 1. Widen CHECK + allow unset ─────────────────────────────────────────────
ALTER TABLE public.event_venue_stops
  DROP CONSTRAINT IF EXISTS event_venue_stops_movement_method_check;

ALTER TABLE public.event_venue_stops
  ALTER COLUMN movement_method DROP DEFAULT;

ALTER TABLE public.event_venue_stops
  ALTER COLUMN movement_method DROP NOT NULL;

ALTER TABLE public.event_venue_stops
  ADD CONSTRAINT event_venue_stops_movement_method_check
  CHECK (
    movement_method IS NULL
    OR movement_method = ANY (ARRAY['bus'::text, 'walk'::text, 'on_site'::text, 'other'::text])
  );

-- Meals / meds stay on-site; venue hops unset until trip leader chooses on leave.
UPDATE public.event_venue_stops
   SET movement_method = 'on_site'
 WHERE activity_kind IN ('meal', 'medication_round')
   AND (movement_method IS DISTINCT FROM 'on_site');

UPDATE public.event_venue_stops
   SET movement_method = NULL
 WHERE COALESCE(activity_kind, 'venue') = 'venue'
   AND phase = 'pending'
   AND movement_method = 'bus';

COMMENT ON COLUMN public.event_venue_stops.movement_method IS
  'How the group moves TO this stop: bus | walk | on_site | other. NULL = not chosen yet (ask on leave-from-current).';

GRANT SELECT, UPDATE ON public.event_venue_stops TO anon, authenticated;

-- ── Validation (expect 1 row; udt/check includes other) ──────────────────────
-- SELECT column_name, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'event_venue_stops'
--   AND column_name = 'movement_method';
--
-- SELECT pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conname = 'event_venue_stops_movement_method_check';
