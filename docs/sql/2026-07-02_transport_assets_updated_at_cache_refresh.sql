-- 2026-07-02 — Fix PostgREST PGRST204 on transport_assets.updated_at
--
-- Symptom: resolveVehicleMaintenance() UPDATE fails with PGRST204 claiming
-- the `updated_at` column does not exist on public.transport_assets. The
-- column was defined in 2026-06-22_transport_assets_and_clearance.sql, so
-- the most likely cause is a stale PostgREST schema cache. This migration
-- is defensive: it (re)asserts the column, installs an auto-touch trigger,
-- and force-reloads the PostgREST schema cache.

-- 1. Ensure column exists (idempotent — no-op if already present).
ALTER TABLE public.transport_assets
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 2. Generic touch function (reused across tables; create-or-replace is safe).
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 3. Auto-touch trigger on UPDATE.
DROP TRIGGER IF EXISTS update_transport_assets_updated_at ON public.transport_assets;
CREATE TRIGGER update_transport_assets_updated_at
BEFORE UPDATE ON public.transport_assets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Force PostgREST to reload its schema cache so the Data API sees the
--    column immediately, regardless of whether step 1 actually changed
--    anything.
NOTIFY pgrst, 'reload schema';
