-- 2026-07-16 — Event absent/no-show flow validation queries
--
-- NO SCHEMA MIGRATION REQUIRED.
-- status = 'absent' is already in the CHECK constraint from the original
-- event_attendance_log migration (2026-07-04_event_attendance_log_phase8.sql):
--   CHECK (status IN ('expected','checked_in','checked_out','absent'))
--
-- Run these after testing the absent flow to verify writes landed correctly.

-- ─── 1. Confirm absent status is in the constraint ───────────────────────────
-- Expected: returns 1 row with conname and def containing 'absent'
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'event_attendance_log'::regclass
  AND contype = 'c'
  AND conname LIKE '%status%';

-- ─── 2. List any absent attendance rows ───────────────────────────────────────
-- Expected after smoke test: 1+ rows with status='absent' and notes populated
SELECT
  eal.id,
  eal.participant_id,
  eal.event_day_session_id,
  eal.status,
  eal.notes,
  eal.updated_at
FROM public.event_attendance_log eal
WHERE eal.status = 'absent'
ORDER BY eal.updated_at DESC
LIMIT 10;

-- ─── 3. Corresponding Hub issues created by absent flow ──────────────────────
-- Expected: 1 row per absent mark with issue_description starting '[TRIP ABSENT]'
SELECT
  sir.id,
  sir.event_id,
  sir.event_day_session_id,
  sir.severity,
  sir.issue_description,
  sir.status,
  sir.created_at
FROM public.site_issues_register sir
WHERE sir.issue_description LIKE '[TRIP ABSENT]%'
ORDER BY sir.created_at DESC
LIMIT 10;

-- ─── 4. Verify anon write grants on event_attendance_log ─────────────────────
-- Expected: grantee = 'anon', privilege_type = 'UPDATE'
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'event_attendance_log'
  AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, privilege_type;

-- ─── 5. Verify anon insert grants on site_issues_register ────────────────────
-- Expected: grantee = 'anon', privilege_type = 'INSERT'
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'site_issues_register'
  AND grantee IN ('anon', 'authenticated')
  AND privilege_type = 'INSERT';
