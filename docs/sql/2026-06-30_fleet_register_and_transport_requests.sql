-- 2026-06-30 — Fleet register hoist flag + ad-hoc transport requests
-- ------------------------------------------------------------------------

-- 1. Wheelchair hoist capability on fleet vehicles (manifest matching).
ALTER TABLE public.transport_assets
  ADD COLUMN IF NOT EXISTS has_wheelchair_hoist boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.transport_assets.has_wheelchair_hoist IS
  'True when this vehicle is equipped for hoist-dependent passengers.';

-- 2. Ad-hoc transport requests (doctor, shots, special drop) — coordinator intent.
CREATE TABLE IF NOT EXISTS public.transport_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  request_date date NOT NULL DEFAULT current_date,
  scheduled_time time,
  pickup_address text,
  destination_label text NOT NULL,
  reason text,
  hoist_required boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'assigned', 'in_progress', 'completed', 'cancelled')),
  assigned_driver_staff_id uuid REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  assigned_asset_id uuid REFERENCES public.transport_assets(id) ON DELETE SET NULL,
  notes text,
  completed_sync_log_id uuid,
  completed_at timestamptz,
  created_by_staff_id uuid REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transport_requests_date_status_idx
  ON public.transport_requests (request_date, status);

CREATE INDEX IF NOT EXISTS transport_requests_participant_idx
  ON public.transport_requests (participant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transport_requests TO authenticated;
GRANT ALL ON public.transport_requests TO service_role;
ALTER TABLE public.transport_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "transport_requests authenticated all" ON public.transport_requests;
CREATE POLICY "transport_requests authenticated all"
  ON public.transport_requests
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
