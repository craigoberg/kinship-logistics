-- 2026-06-19 — Active Driver Manifest Workflow
-- Two new tables for sequential trip/leg tracking with GPS + compliance.

CREATE TABLE IF NOT EXISTS public.transport_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_staff_id uuid,
  event_id uuid REFERENCES public.event_manifest(id) ON DELETE SET NULL,
  trip_date date NOT NULL DEFAULT current_date,
  start_odometer_km numeric NOT NULL,
  end_odometer_km numeric,
  status text NOT NULL DEFAULT 'active',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS transport_trips_one_active_per_driver
  ON public.transport_trips (driver_staff_id)
  WHERE status = 'active' AND driver_staff_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transport_trips TO authenticated;
GRANT ALL ON public.transport_trips TO service_role;
ALTER TABLE public.transport_trips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "transport_trips authenticated all" ON public.transport_trips;
CREATE POLICY "transport_trips authenticated all"
  ON public.transport_trips
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.trip_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.transport_trips(id) ON DELETE CASCADE,
  leg_index int NOT NULL,
  leg_kind text NOT NULL,
  from_label text NOT NULL,
  to_label text NOT NULL,
  from_participant_id uuid,
  to_participant_id uuid,
  status text NOT NULL DEFAULT 'pending',
  start_lat numeric,
  start_lng numeric,
  start_at timestamptz,
  end_lat numeric,
  end_lng numeric,
  end_at timestamptz,
  gps_distance_km numeric,
  logged_distance_km numeric,
  passenger_present boolean,
  no_show_triggered_at timestamptz,
  medication_expected boolean NOT NULL DEFAULT false,
  medication_handover_confirmed boolean NOT NULL DEFAULT false,
  unexpected_medication_logged boolean NOT NULL DEFAULT false,
  unexpected_medication_notes text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, leg_index)
);

CREATE INDEX IF NOT EXISTS trip_legs_trip_id_idx ON public.trip_legs (trip_id, leg_index);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_legs TO authenticated;
GRANT ALL ON public.trip_legs TO service_role;
ALTER TABLE public.trip_legs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trip_legs authenticated all" ON public.trip_legs;
CREATE POLICY "trip_legs authenticated all"
  ON public.trip_legs
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
