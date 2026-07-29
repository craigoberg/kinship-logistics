-- ============================================================
-- event_day_sessions: Expected arrival gate
-- Created: 2026-07-14
-- Purpose:
--   1. Add expected_arrival_by timestamptz to event_day_sessions
--   2. Grant anon SELECT/INSERT/UPDATE on event_day_sessions
--   3. Add permissive anon RLS UPDATE policy (idempotent)
--   4. Seed system_parameter event_arrival_window_minutes = 60
--
-- Behaviour:
--   When trip leader opens the first venue stop, the API sets
--   expected_arrival_by = opened_at + event_arrival_window_minutes.
--   Participants still in "expected" status after that time turn
--   amber (warning) and then red (overdue) in the Check-In tab.
--
-- Idempotent: safe to re-run.
-- ============================================================

-- ── Step 1: Add expected_arrival_by column

ALTER TABLE public.event_day_sessions
  ADD COLUMN IF NOT EXISTS expected_arrival_by timestamptz;

COMMENT ON COLUMN public.event_day_sessions.expected_arrival_by IS
  'Soft deadline: participants still expected after this time turn amber, then red. Set to opened_at + event_arrival_window_minutes when first venue stop opens.';

-- ── Step 2: Grant anon + authenticated on event_day_sessions

GRANT SELECT, INSERT, UPDATE ON public.event_day_sessions TO anon, authenticated;

-- ── Step 3: Ensure permissive RLS UPDATE policy exists for anon

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'event_day_sessions'
      AND cmd        = 'UPDATE'
      AND policyname = 'anon_update_event_day_sessions'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY anon_update_event_day_sessions
        ON public.event_day_sessions
        FOR UPDATE
        TO anon, authenticated
        USING (true)
        WITH CHECK (true)
    $pol$;
    RAISE NOTICE 'anon_update_event_day_sessions policy created.';
  ELSE
    RAISE NOTICE 'anon_update_event_day_sessions policy already exists, no change.';
  END IF;
END
$$;

-- Ensure RLS is enabled (safe if already enabled)
ALTER TABLE public.event_day_sessions ENABLE ROW LEVEL SECURITY;

-- ── Step 4: Seed system_parameter for arrival window (default 60 min)

INSERT INTO public.system_parameters (key, value, description)
VALUES (
  'event_arrival_window_minutes',
  '60'::jsonb,
  'Minutes after the first venue stop opens before expected participants turn amber/red in the Event Deliver Check-In tab.'
)
ON CONFLICT (key) DO NOTHING;

-- ── Reload PostgREST schema cache

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Validation queries (run after migration to confirm success)
-- ============================================================

-- 1. Column exists — expect 1 row:
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'event_day_sessions'
  AND column_name  = 'expected_arrival_by';

-- 2. System parameter seeded — expect 1 row with value 60:
SELECT key, value
FROM public.system_parameters
WHERE key = 'event_arrival_window_minutes';

-- 3. RLS policy exists — expect 1 row:
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'event_day_sessions'
  AND policyname = 'anon_update_event_day_sessions';

-- 4. Grant check — expect anon in acl:
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name   = 'event_day_sessions'
  AND grantee      = 'anon'
  AND privilege_type = 'UPDATE';
