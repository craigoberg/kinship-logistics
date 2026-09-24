-- =============================================================================
-- 2026-08-23 — system_lookup_parameters DELETE policy
-- =============================================================================
--
-- Symptom: Admin → Lookups → Remove shows "Entry removed" but the row stays.
-- Cause:   2026-07-08_rls_baseline_legacy_tables.sql granted DELETE and created
--          SELECT/INSERT/UPDATE policies only. PostgREST DELETE with no matching
--          RLS policy returns 204 and 0 rows — the UI treated that as success.
--
-- Same class of bug as 2026-07-06_event_day_sessions_delete_policy.sql and
-- 2026-07-18_asset_clearance_anon_delete.sql.
--
-- Day-login JWT (authenticated) only — not anon (BL-117).
-- SQL Editor "Success. No rows returned" is expected for the DDL body.
-- =============================================================================

ALTER TABLE public.system_lookup_parameters ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_lookup_parameters
  TO authenticated;
GRANT ALL ON public.system_lookup_parameters TO service_role;

DROP POLICY IF EXISTS "system_lookup_parameters deletable" ON public.system_lookup_parameters;
CREATE POLICY "system_lookup_parameters deletable"
  ON public.system_lookup_parameters
  FOR DELETE
  TO authenticated
  USING (true);

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Validation (DDL-only run returns no rows — that is expected):
--
-- Expect 1 row with cmd = DELETE:
--   SELECT policyname, roles, cmd
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename = 'system_lookup_parameters'
--     AND cmd = 'DELETE';
--
-- Expect authenticated = true:
--   SELECT has_table_privilege('authenticated', 'public.system_lookup_parameters', 'DELETE')
--     AS authenticated_can_delete;
--
-- Operating days currently configured (sample):
--   SELECT code, display_name
--   FROM system_lookup_parameters
--   WHERE category = 'operating_days'
--   ORDER BY sort_order, code;
-- =============================================================================
