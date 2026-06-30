-- 2026-06-30_transport_site_addresses.sql
-- Default street addresses for the bus depot and Day Centre.
-- Coordinators maintain these in Admin → Lookups → Day Centre Bus Runs.
-- Drivers can override the starting point per trip on the manifest wizard.
--
-- Run in Supabase SQL editor (safe to re-run).

INSERT INTO public.system_parameters (key, value, description)
VALUES
  (
    'depot_address',
    '"Update with actual depot street address"'::jsonb,
    'Default street address of the bus depot. Used as the morning pickup starting point and afternoon home-run destination. Drivers may override the starting point per trip.'
  ),
  (
    'day_centre_address',
    '"Update with actual Day Centre street address"'::jsonb,
    'Default street address of the Day Centre. Used as the morning run destination and afternoon home-run starting point.'
  )
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
