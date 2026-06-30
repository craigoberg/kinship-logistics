-- 2026-06-30_day_centre_bus_runs.sql
-- Day Centre Bus Run support
--
-- 1. Adds bus_run_code to transport_trips so Day Centre runs are identified
--    without needing an event_manifest row.
-- 2. Seeds the bus_runs lookup category in system_lookup_parameters with
--    two default runs (Run 1, Run 2) — coordinators can add more in Admin.
-- 3. Grants anon/authenticated read on the new column (RLS already covers
--    the table; no new policies needed).
--
-- Run this in the Supabase SQL editor BEFORE deploying the frontend changes.

-- ── 1. transport_trips: add bus_run_code ─────────────────────────────────────

ALTER TABLE public.transport_trips
  ADD COLUMN IF NOT EXISTS bus_run_code text DEFAULT NULL;

COMMENT ON COLUMN public.transport_trips.bus_run_code IS
  'Day Centre bus run code (e.g. BUSRUN-1). NULL for event-driven trips.';

-- Index for dashboard queries that filter active runs by code.
CREATE INDEX IF NOT EXISTS idx_transport_trips_bus_run_code
  ON public.transport_trips (bus_run_code)
  WHERE bus_run_code IS NOT NULL;

-- ── 2. system_lookup_parameters: seed bus_runs category ──────────────────────

INSERT INTO public.system_lookup_parameters (category, code, display_name, sort_order)
VALUES
  ('bus_runs', 'BUSRUN-1', 'Run 1', 1),
  ('bus_runs', 'BUSRUN-2', 'Run 2', 2)
ON CONFLICT (category, code) DO NOTHING;

-- ── 3. participant_attendance_schedules: verify inbound_transport column ──────
-- The column already exists (added in 2026-07-15_attendance_schedule_split_transport.sql).
-- Bus run codes (BUSRUN-1, BUSRUN-2 …) are stored directly in this column
-- alongside existing values ('bus', 'self', 'family', etc.).
-- No schema change needed here — this comment documents the convention.

-- ── Done ─────────────────────────────────────────────────────────────────────
