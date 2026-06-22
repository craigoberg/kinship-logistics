-- ============================================================================
-- 2026-06-28 — Re-apply asset_daily_clearance columns from 2026-06-24 handshake
--
-- The 2026-06-24_dual_pin_handshake.sql migration was not applied to the
-- live database, leaving PostgREST with no `accumulated_issues` column in
-- the schema cache. Driver pre-trip RED submissions return PGRST204.
--
-- This migration is fully idempotent: ADD COLUMN IF NOT EXISTS + status
-- check rewrite + realtime publication add (swallowed if already present).
-- Safe to re-run any time.
-- ============================================================================

ALTER TABLE public.asset_daily_clearance
  ADD COLUMN IF NOT EXISTS accumulated_issues text,
  ADD COLUMN IF NOT EXISTS driver_comfort_declared boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_manager_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS driver_auth_staff_id uuid REFERENCES public.staff_registry(id),
  ADD COLUMN IF NOT EXISTS driver_auth_pin_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS manager_auth_staff_id uuid REFERENCES public.staff_registry(id),
  ADD COLUMN IF NOT EXISTS manager_auth_pin_verified_at timestamptz;

ALTER TABLE public.asset_daily_clearance
  DROP CONSTRAINT IF EXISTS asset_daily_clearance_status_check;
ALTER TABLE public.asset_daily_clearance
  ADD CONSTRAINT asset_daily_clearance_status_check
  CHECK (status IN ('passed','failed','awaiting_manager_review','authorized_override'));

ALTER TABLE public.asset_clearance_items
  ADD COLUMN IF NOT EXISTS severity text
    CHECK (severity IN ('green','yellow','red')),
  ADD COLUMN IF NOT EXISTS workaround_text text;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.asset_daily_clearance;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- Refresh PostgREST schema cache so the new columns become visible immediately.
NOTIFY pgrst, 'reload schema';
