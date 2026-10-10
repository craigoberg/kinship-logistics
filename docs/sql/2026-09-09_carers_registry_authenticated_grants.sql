-- =============================================================================
-- 2026-09-09 — carers_registry authenticated GRANT + RLS (BL-117)
-- =============================================================================
--
-- Staff / care-profile / run-planning read public.carers_registry.
-- After day-login RLS, anon must not SELECT this table (PII). A browser
-- request with only the publishable key returns 401:
--   permission denied for table carers_registry
--
-- This file does NOT grant anon. It makes sure a day-login JWT can CRUD,
-- and that RLS has an authenticated policy (not anon-only leftovers).
--
-- Run on DEV then TEST. SQL Editor "Success. No rows returned" is expected.
-- =============================================================================

REVOKE ALL ON TABLE public.carers_registry FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.carers_registry TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.carers_registry TO service_role;

ALTER TABLE public.carers_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS carers_registry_authenticated_all ON public.carers_registry;
CREATE POLICY carers_registry_authenticated_all
  ON public.carers_registry
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- What "Success. No rows returned" means
--   DDL / GRANT only. Empty result pane is normal.
--
-- Validation (these SHOULD return rows):
--
-- 1) Privileges — expect authenticated SELECT (and no anon SELECT):
--    SELECT grantee, privilege_type
--    FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND table_name = 'carers_registry'
--      AND grantee IN ('anon', 'authenticated', 'service_role')
--    ORDER BY 1, 2;
--
-- 2) Policy exists — expect 1 row:
--    SELECT polname, polcmd
--    FROM pg_policy
--    WHERE polrelid = 'public.carers_registry'::regclass
--      AND polname = 'carers_registry_authenticated_all';
--
-- 3) Anon must not read (publishable key, no JWT) — 401 / 42501.
-- ---------------------------------------------------------------------------
