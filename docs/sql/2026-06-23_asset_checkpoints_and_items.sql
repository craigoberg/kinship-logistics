-- 2026-06-23 — Asset Clearance Checkpoints + Per-item Drill-Down Results
-- ---------------------------------------------------------------------
-- Extends transport_assets with a coarse vehicle_category for shared
-- checkpoint matching, introduces the dynamic checkpoint library, and adds
-- the per-question clearance result rows.

-- 1. Add vehicle_category to transport_assets
ALTER TABLE public.transport_assets
  ADD COLUMN IF NOT EXISTS vehicle_category text;

UPDATE public.transport_assets SET vehicle_category = 'hiace'
  WHERE vehicle_category IS NULL AND name IN ('HiAce Bus 1','HiAce Bus 2');
UPDATE public.transport_assets SET vehicle_category = 'coaster'
  WHERE vehicle_category IS NULL AND name = 'Toyota Coaster';

-- 2. asset_checkpoints : the daily walkaround question library
CREATE TABLE IF NOT EXISTS public.asset_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid REFERENCES public.transport_assets(id) ON DELETE CASCADE,
  vehicle_category text,
  label text NOT NULL,
  category text,
  is_mandatory boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (asset_id IS NOT NULL OR vehicle_category IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS asset_checkpoints_asset_idx
  ON public.asset_checkpoints (asset_id);
CREATE INDEX IF NOT EXISTS asset_checkpoints_category_idx
  ON public.asset_checkpoints (vehicle_category);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_checkpoints TO authenticated;
GRANT ALL ON public.asset_checkpoints TO service_role;
ALTER TABLE public.asset_checkpoints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "asset_checkpoints authenticated all" ON public.asset_checkpoints;
CREATE POLICY "asset_checkpoints authenticated all"
  ON public.asset_checkpoints
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Seed a baseline walkaround library covering all vehicles.
INSERT INTO public.asset_checkpoints (vehicle_category, label, category, is_mandatory, sort_order)
VALUES
  ('all', 'All exterior lights operational (headlights, brake, indicators)', 'safety', true, 10),
  ('all', 'Tyres free of visible damage and adequate tread',                'safety', true, 20),
  ('all', 'Windscreen clear, wipers functional, washer fluid topped up',    'safety', true, 30),
  ('all', 'Seatbelts present and operational in every passenger seat',      'safety', true, 40),
  ('all', 'First-aid kit + fire extinguisher present and in date',          'safety', true, 50),
  ('all', 'Interior clean and free of unsecured loose items',               'interior', false, 60),
  ('all', 'Fuel level above quarter tank',                                  'operational', true, 70),
  ('all', 'No new exterior damage since last shift',                        'exterior', true, 80)
ON CONFLICT DO NOTHING;

-- 3. asset_clearance_items : per-checkpoint result rows for a clearance
CREATE TABLE IF NOT EXISTS public.asset_clearance_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clearance_id uuid NOT NULL REFERENCES public.asset_daily_clearance(id) ON DELETE CASCADE,
  checkpoint_id uuid REFERENCES public.asset_checkpoints(id) ON DELETE SET NULL,
  checkpoint_label text NOT NULL,
  passed boolean NOT NULL,
  is_mandatory boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS asset_clearance_items_clearance_idx
  ON public.asset_clearance_items (clearance_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_clearance_items TO authenticated;
GRANT ALL ON public.asset_clearance_items TO service_role;
ALTER TABLE public.asset_clearance_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "asset_clearance_items authenticated all" ON public.asset_clearance_items;
CREATE POLICY "asset_clearance_items authenticated all"
  ON public.asset_clearance_items
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
