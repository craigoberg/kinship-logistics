-- 2026-07-23 — Manifest odometer suggest + Fleet current KM (BL-096)
--
-- Run in Supabase Dashboard → SQL Editor → Run All
--
-- 1) transport_assets.current_odometer_km — canonical estimated reading
-- 2) transport_trips.asset_id — links run to vehicle for close → asset update
-- 3) Soft-warn thresholds on system_parameters
--
-- Empty DDL often ends with "Success. No rows returned" — that is normal.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.transport_assets
  ADD COLUMN IF NOT EXISTS current_odometer_km numeric NULL,
  ADD COLUMN IF NOT EXISTS current_odometer_updated_at timestamptz NULL;

ALTER TABLE public.transport_trips
  ADD COLUMN IF NOT EXISTS asset_id uuid NULL
    REFERENCES public.transport_assets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS transport_trips_asset_id_idx
  ON public.transport_trips (asset_id)
  WHERE asset_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Backfill current_odometer_km
-- Prefer latest completed trip end for that asset (via clearance same day + start
-- when asset_id missing), else max clearance start_odometer.
-- ---------------------------------------------------------------------------

-- From clearances (max start reading per asset)
UPDATE public.transport_assets a
SET
  current_odometer_km = src.odo,
  current_odometer_updated_at = COALESCE(a.current_odometer_updated_at, now())
FROM (
  SELECT asset_id, MAX(start_odometer::numeric) AS odo
  FROM public.asset_daily_clearance
  WHERE start_odometer IS NOT NULL
  GROUP BY asset_id
) src
WHERE a.id = src.asset_id
  AND a.current_odometer_km IS NULL;

-- Prefer latest trip end where asset_id is already set
UPDATE public.transport_assets a
SET
  current_odometer_km = t.end_km,
  current_odometer_updated_at = COALESCE(t.completed_at, t.updated_at, now())
FROM (
  SELECT DISTINCT ON (asset_id)
    asset_id,
    COALESCE(end_odometer_km, end_odometer)::numeric AS end_km,
    completed_at,
    updated_at
  FROM public.transport_trips
  WHERE asset_id IS NOT NULL
    AND status = 'completed'
    AND COALESCE(end_odometer_km, end_odometer) IS NOT NULL
  ORDER BY asset_id, COALESCE(completed_at, updated_at, created_at) DESC NULLS LAST
) t
WHERE a.id = t.asset_id
  AND (
    a.current_odometer_km IS NULL
    OR t.end_km >= a.current_odometer_km
  );

-- ---------------------------------------------------------------------------
-- Soft-warn thresholds (ON CONFLICT preserves Manager-edited values)
-- ---------------------------------------------------------------------------

INSERT INTO public.system_parameters (key, value, description)
VALUES
  (
    'manifest.odo_leg_gps_warn_km',
    '3'::jsonb,
    'Manifest: soft-warn when |logged leg km − GPS haversine| ≥ this many km. Driver may accept without Hub issue. BL-096.'
  ),
  (
    'manifest.odo_close_suggest_warn_km',
    '5'::jsonb,
    'Manifest Close Run: soft-warn when |ending odo − (start + Σ logged legs)| ≥ this many km. Driver may accept without Hub issue. BL-096.'
  ),
  (
    'manifest.odo_start_vs_last_warn_km',
    '20'::jsonb,
    'Manifest init: soft-warn when |start odo − vehicle current estimated| ≥ this many km (petrol / fat-finger headroom). BL-096.'
  )
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Validation (expect rows):
--
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'transport_assets'
--   AND column_name IN ('current_odometer_km', 'current_odometer_updated_at');
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'transport_trips'
--   AND column_name = 'asset_id';
--
-- SELECT key, value FROM public.system_parameters
-- WHERE key LIKE 'manifest.odo_%'
-- ORDER BY key;
-- ---------------------------------------------------------------------------
