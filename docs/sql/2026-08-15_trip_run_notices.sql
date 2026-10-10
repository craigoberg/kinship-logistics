-- =============================================================================
-- 2026-08-15 — Office → driver run notices (today exemption)
-- =============================================================================
--
-- When office marks a participant Off today, Manifest shows a banner so the
-- driver sees the change. Idempotent.
-- "Success. No rows returned" is normal for DDL.
-- PIN terminals use anon — grants + permissive RLS required.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.trip_run_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.transport_trips(id) ON DELETE CASCADE,
  participant_id uuid NULL REFERENCES public.participants(id) ON DELETE SET NULL,
  notice_type text NOT NULL DEFAULT 'run_exemption',
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS trip_run_notices_trip_open_idx
  ON public.trip_run_notices (trip_id, created_at DESC)
  WHERE acknowledged_at IS NULL;

COMMENT ON TABLE public.trip_run_notices IS
  'Office messages for an active Manifest run (e.g. Off today). Driver dismisses.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_run_notices
  TO anon, authenticated, service_role;

ALTER TABLE public.trip_run_notices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kinship_anon_all_trip_run_notices ON public.trip_run_notices;
CREATE POLICY kinship_anon_all_trip_run_notices
  ON public.trip_run_notices
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Validation (DDL-only run returns no rows — that is expected):
--
--   SELECT to_regclass('public.trip_run_notices') AS table_regclass;
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'trip_run_notices'
--   ORDER BY ordinal_position;
--
--   SELECT polname FROM pg_policy
--   WHERE polrelid = 'public.trip_run_notices'::regclass;
-- =============================================================================
