-- ============================================================
-- site_issues_register: Event absent Hub issue fix
-- Created: 2026-07-14
-- Purpose:
--   1. Ensure session_id is nullable (event-day rows have session_id = NULL)
--   2. Ensure event_id FK column exists (references event_manifest)
--   3. Ensure event_day_session_id FK column exists (references event_day_sessions)
--   4. Reset RLS + grants so anon PIN terminal can INSERT absence issues
--   5. Reload PostgREST schema cache
--
-- Run when: 409 errors on "Not Attending Today" in the Event Deliver Check-In tab.
-- Idempotent: safe to re-run.
-- ============================================================

-- ── Step 1: Make session_id nullable (idempotent via DO block)

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'site_issues_register'
      AND column_name  = 'session_id'
      AND is_nullable  = 'NO'
  ) THEN
    ALTER TABLE public.site_issues_register ALTER COLUMN session_id DROP NOT NULL;
    RAISE NOTICE 'session_id: NOT NULL constraint dropped.';
  ELSE
    RAISE NOTICE 'session_id: already nullable, no change.';
  END IF;
END
$$;

-- ── Step 2: Add event_id column if missing (FK → event_manifest)

ALTER TABLE public.site_issues_register
  ADD COLUMN IF NOT EXISTS event_id uuid
    REFERENCES public.event_manifest(id) ON DELETE SET NULL;

-- ── Step 3: Add event_day_session_id column if missing (FK → event_day_sessions)

ALTER TABLE public.site_issues_register
  ADD COLUMN IF NOT EXISTS event_day_session_id uuid
    REFERENCES public.event_day_sessions(id) ON DELETE SET NULL;

-- ── Step 4: Drop ALL existing RLS policies (nuclear reset)

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

-- ── Step 5: Re-enable RLS (in case it was disabled)

ALTER TABLE public.site_issues_register ENABLE ROW LEVEL SECURITY;

-- ── Step 6: Fresh permissive policies — no column conditions

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

-- ── Step 7: Ensure grants are in place (idempotent)

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.site_issues_register
  TO anon, authenticated;

GRANT ALL ON public.site_issues_register TO service_role;

-- ── Step 8: Force PostgREST schema cache reload

NOTIFY pgrst, 'reload schema';

-- ── Step 9: Validation queries
-- Run each block below and confirm the expected results.

-- 9a. Confirm session_id is nullable — expect is_nullable = 'YES'
SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'site_issues_register'
  AND column_name  IN ('session_id', 'event_id', 'event_day_session_id')
ORDER BY column_name;
-- Expected: 3 rows, all with is_nullable = 'YES'

-- 9b. Confirm permissive policies exist — expect 4 rows
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'site_issues_register'
ORDER BY policyname;
-- Expected: sir_delete_all, sir_insert_all, sir_select_all, sir_update_all

-- 9c. Confirm anon has INSERT grant — expect 1 row
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name   = 'site_issues_register'
  AND grantee      = 'anon'
  AND privilege_type = 'INSERT';
-- Expected: 1 row — grantee=anon, privilege_type=INSERT

-- 9d. Most recent issues (smoke check) — expect rows if any have been inserted
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
LIMIT 10;
