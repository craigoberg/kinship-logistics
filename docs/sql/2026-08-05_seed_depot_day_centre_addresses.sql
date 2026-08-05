-- =============================================================================
-- 2026-08-05 — Seed depot_address + day_centre_address system parameters
-- =============================================================================
--
-- Symptom: Admin → Lookups → Day Centre Bus Runs → Transport site addresses
--   Save fails: "Unknown system parameter: depot_address"
--
-- Cause: set_system_parameter / updateSystemParameter only UPDATE existing keys.
--   TEST (or wiped DBs) may never have run 2026-06-30_transport_site_addresses.sql.
--
-- Idempotent. Run on TEST (and DEV if missing).
-- "Success. No rows returned" is normal when both keys already exist.
-- =============================================================================

INSERT INTO public.system_parameters (key, value, description)
VALUES
  (
    'depot_address',
    '""'::jsonb,
    'Default street address of the bus depot. Used as the morning pickup starting point and afternoon home-run destination. Drivers may override the starting point per trip.'
  ),
  (
    'day_centre_address',
    '""'::jsonb,
    'Default street address of the Day Centre. Used as the morning run destination and afternoon home-run starting point.'
  )
ON CONFLICT (key) DO NOTHING;

-- Validation (expect 2 rows):
-- SELECT key, value
-- FROM public.system_parameters
-- WHERE key IN ('depot_address', 'day_centre_address')
-- ORDER BY key;
