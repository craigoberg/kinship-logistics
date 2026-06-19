-- ============================================================================
-- 2026-06-24 — Dual-PIN Handshake & Multi-Issue Accumulator
--
-- 1. Extend asset_daily_clearance with comfort declaration + dual-auth fields.
-- 2. Extend asset_clearance_items with the green/yellow/red severity and the
--    free-text workaround per logged issue.
-- 3. Seed the demo onboarding PIN ('1234') into every staff_registry row with
--    a NULL pin_hash, hashed via pgcrypto/bcrypt.
-- 4. Provide a security-definer RPC `verify_staff_pin(staff_id, pin)` so the
--    raw PIN never leaves a single round-trip.
-- 5. Add asset_daily_clearance to the supabase_realtime publication so the
--    driver tablet and operations dashboard can subscribe to live updates.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- asset_daily_clearance ----------

ALTER TABLE public.asset_daily_clearance
  ADD COLUMN IF NOT EXISTS accumulated_issues text,
  ADD COLUMN IF NOT EXISTS driver_comfort_declared boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_manager_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS driver_auth_staff_id uuid REFERENCES public.staff_registry(id),
  ADD COLUMN IF NOT EXISTS driver_auth_pin_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS manager_auth_staff_id uuid REFERENCES public.staff_registry(id),
  ADD COLUMN IF NOT EXISTS manager_auth_pin_verified_at timestamptz;

-- Allow the two new lifecycle states alongside the historical passed/failed.
ALTER TABLE public.asset_daily_clearance
  DROP CONSTRAINT IF EXISTS asset_daily_clearance_status_check;
ALTER TABLE public.asset_daily_clearance
  ADD CONSTRAINT asset_daily_clearance_status_check
  CHECK (status IN ('passed','failed','awaiting_manager_review','authorized_override'));

-- ---------- asset_clearance_items ----------

ALTER TABLE public.asset_clearance_items
  ADD COLUMN IF NOT EXISTS severity text
    CHECK (severity IN ('green','yellow','red')),
  ADD COLUMN IF NOT EXISTS workaround_text text;

-- ---------- staff_registry PIN seeding ----------

UPDATE public.staff_registry
   SET pin_hash = crypt('1234', gen_salt('bf'))
 WHERE pin_hash IS NULL;

-- ---------- verify_staff_pin RPC ----------

CREATE OR REPLACE FUNCTION public.verify_staff_pin(_staff_id uuid, _pin text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.staff_registry s
     WHERE s.id = _staff_id
       AND s.pin_hash IS NOT NULL
       AND s.pin_hash = crypt(_pin, s.pin_hash)
  );
$$;

REVOKE ALL ON FUNCTION public.verify_staff_pin(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.verify_staff_pin(uuid, text)
  TO anon, authenticated, service_role;

-- ---------- Realtime publication ----------
-- Idempotent: adding a table that's already published is a no-op error we swallow.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.asset_daily_clearance;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
