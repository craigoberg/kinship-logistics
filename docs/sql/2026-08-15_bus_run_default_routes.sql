-- =============================================================================
-- 2026-08-15 — Day Centre default run routes (office drag order)
-- =============================================================================
--
-- Office sets a default pickup / return order per bus run in Participants
-- Directory. Manifest seeds legs in this order; the driver can still reorder
-- on the active run (GUARDRAILS §11).
--
-- One route per (bus_run_code, direction). People not scheduled that day are
-- skipped at trip start. Idempotent.
-- "Success. No rows returned" is normal for DDL.
-- PIN terminals use anon — grants + permissive RLS required.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.bus_run_default_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bus_run_code text NOT NULL,
  direction text NOT NULL
    CHECK (direction IN ('morning', 'afternoon')),
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  stop_order integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_staff_id uuid NULL REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  UNIQUE (bus_run_code, direction, participant_id)
);

CREATE INDEX IF NOT EXISTS bus_run_default_routes_run_dir_idx
  ON public.bus_run_default_routes (bus_run_code, direction, stop_order);

COMMENT ON TABLE public.bus_run_default_routes IS
  'Office default Manifest order per Day Centre bus run + direction. Driver may still reorder mid-run.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bus_run_default_routes
  TO anon, authenticated, service_role;

ALTER TABLE public.bus_run_default_routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kinship_anon_all_bus_run_default_routes ON public.bus_run_default_routes;
CREATE POLICY kinship_anon_all_bus_run_default_routes
  ON public.bus_run_default_routes
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Validation (DDL-only run returns no rows — that is expected):
--
-- Expect 1 row:
--   SELECT to_regclass('public.bus_run_default_routes') AS table_regclass;
--
-- Expect columns bus_run_code, direction, participant_id, stop_order:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'bus_run_default_routes'
--   ORDER BY ordinal_position;
--
-- Expect kinship_anon_all_bus_run_default_routes:
--   SELECT polname FROM pg_policy
--   WHERE polrelid = 'public.bus_run_default_routes'::regclass;
-- =============================================================================
