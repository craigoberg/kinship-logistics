-- ============================================================
-- site_issues_register: NUCLEAR RLS RESET
-- Created: 2026-07-11
-- Purpose: Drops EVERY existing policy on site_issues_register
--          (regardless of name) and recreates clean, fully
--          permissive policies for anon + authenticated.
--
-- Run this if event-day venue issues are not appearing in the
-- Governance Hub Human Incidents tab even after a hard refresh.
--
-- Root cause: original policies may have had conditions like
--   USING (session_id IS NOT NULL)
-- which exclude event-day rows (session_id = NULL, event_id set).
-- ============================================================

-- ── Step 1: Drop ALL existing policies (by exact names we know + any others)

DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'site_issues_register'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.site_issues_register',
      pol.policyname
    );
    RAISE NOTICE 'Dropped policy: %', pol.policyname;
  END LOOP;
END
$$;

-- ── Step 2: Ensure RLS is still enabled (must be on for policies to apply)

ALTER TABLE public.site_issues_register ENABLE ROW LEVEL SECURITY;

-- ── Step 3: Fresh permissive policies — no column conditions, ever

CREATE POLICY "sir_select_all"
  ON public.site_issues_register
  FOR SELECT
  TO anon, authenticated, service_role
  USING (true);

CREATE POLICY "sir_insert_all"
  ON public.site_issues_register
  FOR INSERT
  TO anon, authenticated, service_role
  WITH CHECK (true);

CREATE POLICY "sir_update_all"
  ON public.site_issues_register
  FOR UPDATE
  TO anon, authenticated, service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "sir_delete_all"
  ON public.site_issues_register
  FOR DELETE
  TO anon, authenticated, service_role
  USING (true);

-- ── Step 4: Ensure grants are in place (idempotent)

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.site_issues_register
  TO anon, authenticated;

GRANT ALL ON public.site_issues_register TO service_role;

-- ── Step 5: Force PostgREST schema cache reload

NOTIFY pgrst, 'reload schema';

-- ── Step 6: Verification — run this and confirm you see your test rows

SELECT
  id,
  severity,
  LEFT(issue_description, 60) AS description,
  session_id,
  event_id,
  event_day_session_id,
  status,
  created_at
FROM public.site_issues_register
ORDER BY created_at DESC
LIMIT 20;
