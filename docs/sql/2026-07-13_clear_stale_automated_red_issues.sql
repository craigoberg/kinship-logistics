-- ============================================================
-- 2026-07-13 — Clear stale [AUTOMATED_RED] test session issues
-- ============================================================
-- Resolves unresolved [AUTOMATED_RED] issues from prior testing sessions.
-- These are attendance-sweep overdue alerts that were created during testing
-- and never closed when the session ended. They block Day Centre opening.
--
-- Safety: only touches rows where:
--   • severity = 'red'
--   • status is still 'open' (not already resolved or workaround_accepted)
--   • description starts with [AUTOMATED_RED] (automated sweep, not human-filed)
--
-- Human-filed RED issues (verbal workaround, incident etc.) are NOT touched.
-- ============================================================

-- Preview what will be resolved (run SELECT first to verify):
SELECT
  id,
  LEFT(issue_description, 80)  AS description,
  status,
  session_id,
  created_at::date              AS issue_date
FROM site_issues_register
WHERE
  severity    = 'red'
  AND status  = 'open'
  AND issue_description ILIKE '[AUTOMATED_RED]%'
ORDER BY created_at DESC;

-- ── Apply resolution ─────────────────────────────────────────────────────────
UPDATE site_issues_register
SET
  status          = 'resolved',
  resolved_at     = NOW(),
  workaround_plan = '[ADMIN CLEARED] Automated overdue alert from prior testing session. Resolved '
                    || to_char(NOW(), 'DD-Mon-YY') || '.'
WHERE
  severity   = 'red'
  AND status = 'open'
  AND issue_description ILIKE '[AUTOMATED_RED]%';

-- ── Validation: expect 0 rows after ─────────────────────────────────────────
SELECT COUNT(*) AS remaining_blocking_automated_reds
FROM site_issues_register
WHERE
  severity   = 'red'
  AND status = 'open'
  AND issue_description ILIKE '[AUTOMATED_RED]%';
-- Expected: 0
