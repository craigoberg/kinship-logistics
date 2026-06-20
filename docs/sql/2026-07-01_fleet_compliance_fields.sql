-- 2026-07-01 — Fleet compliance fields on transport_assets
-- ------------------------------------------------------------------------
-- Extends the existing fleet register with the compliance metadata that
-- drives the Vehicle Maintenance dashboard exceptions:
--   * VIN/chassis (unique when present, nullable for legacy rows)
--   * registration_expiry — drives RED/YELLOW rego flags
--   * service_interval_km + last_service_odo + last_service_date — drives
--     service-due flags computed against asset_daily_clearance odometer.
--   * deferred_until — mirrors the staff_certification "Defer" pattern so
--     Managers can snooze a YELLOW flag (max +30 days, enforced in UI).
--
-- Reuses public.transport_assets rather than creating a parallel
-- "fleet_registry" table — single source of truth for vehicle identity
-- preserves the asset_daily_clearance FK and avoids dual-write drift.

ALTER TABLE public.transport_assets
  ADD COLUMN IF NOT EXISTS vin text,
  ADD COLUMN IF NOT EXISTS registration_expiry date,
  ADD COLUMN IF NOT EXISTS service_interval_km integer
    CHECK (service_interval_km IS NULL OR service_interval_km > 0),
  ADD COLUMN IF NOT EXISTS last_service_odo integer
    CHECK (last_service_odo IS NULL OR last_service_odo >= 0),
  ADD COLUMN IF NOT EXISTS last_service_date date,
  ADD COLUMN IF NOT EXISTS deferred_until date;

CREATE UNIQUE INDEX IF NOT EXISTS transport_assets_vin_uniq
  ON public.transport_assets (vin) WHERE vin IS NOT NULL;

CREATE INDEX IF NOT EXISTS transport_assets_rego_expiry_idx
  ON public.transport_assets (registration_expiry)
  WHERE registration_expiry IS NOT NULL;

-- Grants / RLS unchanged — covered by the 2026-06-22 migration.
