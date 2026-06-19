-- 2026-06-22 — Transport Assets Register + Daily Operational Clearance Log
-- ------------------------------------------------------------------------

-- 1. transport_assets : the fleet vehicle register
CREATE TABLE IF NOT EXISTS public.transport_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  make_model text NOT NULL,
  rego_plate text NOT NULL UNIQUE,
  passenger_capacity integer NOT NULL CHECK (passenger_capacity >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transport_assets TO authenticated;
GRANT ALL ON public.transport_assets TO service_role;
ALTER TABLE public.transport_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "transport_assets authenticated all" ON public.transport_assets;
CREATE POLICY "transport_assets authenticated all"
  ON public.transport_assets
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Seed three test vehicles (idempotent by unique name).
INSERT INTO public.transport_assets (name, make_model, rego_plate, passenger_capacity)
VALUES
  ('HiAce Bus 1',    'Toyota HiAce Commuter', 'YDA-001', 12),
  ('HiAce Bus 2',    'Toyota HiAce Commuter', 'YDA-002', 12),
  ('Toyota Coaster', 'Toyota Coaster',        'YDA-101', 21)
ON CONFLICT (name) DO NOTHING;

-- 2. asset_daily_clearance : one operational clearance per asset per calendar day
CREATE TABLE IF NOT EXISTS public.asset_daily_clearance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.transport_assets(id) ON DELETE CASCADE,
  clearance_date date NOT NULL,
  driver_staff_id uuid NOT NULL,
  start_odometer integer NOT NULL CHECK (start_odometer >= 0),
  status text NOT NULL CHECK (status IN ('passed','failed')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, clearance_date)
);

CREATE INDEX IF NOT EXISTS asset_daily_clearance_date_idx
  ON public.asset_daily_clearance (clearance_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_daily_clearance TO authenticated;
GRANT ALL ON public.asset_daily_clearance TO service_role;
ALTER TABLE public.asset_daily_clearance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "asset_daily_clearance authenticated all" ON public.asset_daily_clearance;
CREATE POLICY "asset_daily_clearance authenticated all"
  ON public.asset_daily_clearance
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
