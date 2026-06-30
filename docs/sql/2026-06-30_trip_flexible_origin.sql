-- 2026-06-30_trip_flexible_origin.sql
-- Flexible bus-origin/return anchors for transport_trips.
--
-- Problem: the bus parks at the Depot overnight (away from Day Centre).
--   * Morning run starts at Depot, ends at Day Centre (bus stays there).
--   * Afternoon run starts at Day Centre, ends at Depot.
--   * Events / day-trips / multi-day trips can start from EITHER location.
--   * Depot address is not always fixed — driver may park elsewhere.
--
-- Solution:
--   1. Add trip_origin  — where the bus departs from.
--   2. Add trip_return  — where it returns after its mission ('none' = stays put).
--   3. Add origin_address — resolved depot street address at trip-start time
--      (null for day_centre origin since that location is fixed).
--   4. Seed 'depot_address' in system_parameters so coordinators can keep the
--      default up-to-date without a code deployment.
--
-- Run this in the Supabase SQL editor BEFORE deploying the frontend changes.

-- ── 1. transport_trips: new anchor columns ────────────────────────────────────

ALTER TABLE public.transport_trips
  ADD COLUMN IF NOT EXISTS trip_origin  text NOT NULL DEFAULT 'depot'
    CONSTRAINT transport_trips_trip_origin_check
      CHECK (trip_origin IN ('depot', 'day_centre')),

  ADD COLUMN IF NOT EXISTS trip_return  text NOT NULL DEFAULT 'depot'
    CONSTRAINT transport_trips_trip_return_check
      CHECK (trip_return IN ('depot', 'day_centre', 'none')),

  ADD COLUMN IF NOT EXISTS origin_address text DEFAULT NULL;

COMMENT ON COLUMN public.transport_trips.trip_origin IS
  'Where the bus departs from: depot or day_centre.';
COMMENT ON COLUMN public.transport_trips.trip_return IS
  'Where the bus returns after completing its mission: depot, day_centre, or none (bus stays where it ends).';
COMMENT ON COLUMN public.transport_trips.origin_address IS
  'Street address of the origin at trip-start time (Depot only — resolved from system_parameters and overrideable per trip). NULL for day_centre origin.';

-- Back-fill historical rows so the new columns are consistent with leg labels.
-- Rows with bus_run_code are Day Centre runs; event rows use Depot origin.
-- Historical morning/afternoon discrimination is not possible after the fact
-- so we default both to the safest value (depot → depot) for old rows.
UPDATE public.transport_trips
   SET trip_origin  = 'depot',
       trip_return  = 'depot'
 WHERE trip_origin  = 'depot';   -- back-fill only (no-op after first run)

-- ── 2. system_parameters: depot_address ──────────────────────────────────────

INSERT INTO public.system_parameters (key, value, description)
VALUES (
  'depot_address',
  '"Update with actual depot street address"'::jsonb,
  'Default street address of the bus depot. Drivers can override per trip when the bus is parked at a different location (e.g. staff home overnight).'
)
ON CONFLICT (key) DO NOTHING;

-- ── Done ─────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
