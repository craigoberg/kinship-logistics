-- 2026-07-12 — transport_trips: anon access for driver manifest (PIN terminal)
--
-- Run in Supabase Dashboard → SQL Editor → Run All
--
-- Fixes:
--   • Start Outbound Run fails with 401 / RLS 42501 on transport_trips INSERT
--   • Original driver_manifest.sql (2026-06-19) granted only `authenticated`
--   • App uses anon publishable key after PIN login (same pattern as trip_legs)
--
-- trip_legs already has anon policies via 2026-07-08_rls_baseline_legacy_tables.sql;
-- transport_trips was omitted from that batch.

-- ─── Grants ─────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transport_trips TO anon, authenticated;
GRANT ALL                            ON public.transport_trips TO service_role;

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.transport_trips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "transport_trips authenticated all" ON public.transport_trips;
DROP POLICY IF EXISTS "transport_trips readable"          ON public.transport_trips;
DROP POLICY IF EXISTS "transport_trips writable"          ON public.transport_trips;
DROP POLICY IF EXISTS "transport_trips updatable"         ON public.transport_trips;
DROP POLICY IF EXISTS "transport_trips deletable"         ON public.transport_trips;

CREATE POLICY "transport_trips readable"
  ON public.transport_trips
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "transport_trips writable"
  ON public.transport_trips
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "transport_trips updatable"
  ON public.transport_trips
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "transport_trips deletable"
  ON public.transport_trips
  FOR DELETE TO anon, authenticated
  USING (true);

NOTIFY pgrst, 'reload schema';
