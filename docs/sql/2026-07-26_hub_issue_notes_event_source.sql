-- ============================================================
-- 2026-07-26 — hub_issue_notes: allow source = 'event'
-- ============================================================
-- Trip Day / Movies issues use UnifiedIssue.source = 'event'.
-- The original CHECK only allowed day_centre|incident|escalation|renewal,
-- so Hub Resolve / Defer / Review-started on Trip Day cards failed at
-- insertHubNote BEFORE status could flip to resolved.
--
-- Also: clear leftover Day Centre [AUTOMATED_RED] attendance sweeps that
-- still block Open Centre (stale test / prior-session rows).
-- ============================================================

-- ── 1) Expand source CHECK to include 'event' ───────────────────────────────
ALTER TABLE public.hub_issue_notes
  DROP CONSTRAINT IF EXISTS hub_issue_notes_source_check;

ALTER TABLE public.hub_issue_notes
  ADD CONSTRAINT hub_issue_notes_source_check
  CHECK (source IN (
    'day_centre',
    'event',
    'incident',
    'escalation',
    'renewal'
  ));

-- ── 2) Clear stale Day Centre automated attendance REDs (Open Centre gate) ─
-- Preview (optional):
-- SELECT id, LEFT(issue_description, 80), status, created_at
-- FROM site_issues_register
-- WHERE severity = 'red'
--   AND status <> 'resolved'
--   AND event_id IS NULL
--   AND event_day_session_id IS NULL
--   AND issue_description ILIKE '[AUTOMATED_RED]%'
--   AND issue_description NOT ILIKE '%MORNING ROLL%'
--   AND issue_description NOT ILIKE '%EVENING ROLL%'
--   AND issue_description NOT ILIKE '%CURFEW%'
-- ORDER BY created_at DESC;

UPDATE public.site_issues_register
SET
  status = 'resolved',
  resolved_at = NOW(),
  workaround_plan = COALESCE(
    NULLIF(TRIM(workaround_plan), ''),
    '[ADMIN CLEARED] Stale Day Centre automated overdue alert. Resolved '
      || to_char(NOW(), 'DD-Mon-YY') || '.'
  )
WHERE
  severity = 'red'
  AND status <> 'resolved'
  AND event_id IS NULL
  AND event_day_session_id IS NULL
  AND issue_description ILIKE '[AUTOMATED_RED]%'
  AND issue_description NOT ILIKE '%MORNING ROLL%'
  AND issue_description NOT ILIKE '%EVENING ROLL%'
  AND issue_description NOT ILIKE '%CURFEW%';

-- ── Validation (expect rows) ────────────────────────────────────────────────
-- A) Constraint allows event:
-- INSERT INTO hub_issue_notes (source, source_row_id, note, kind)
-- VALUES ('event', '00000000-0000-0000-0000-000000000000', '[VALIDATION] event source ok', 'append');
-- (delete that probe row in SQL Editor if you prefer — or leave; append-only)

-- B) No Day Centre automated blockers left:
-- SELECT COUNT(*) AS remaining_day_centre_automated_blockers
-- FROM site_issues_register
-- WHERE severity = 'red'
--   AND status <> 'resolved'
--   AND event_id IS NULL
--   AND event_day_session_id IS NULL
--   AND issue_description ILIKE '[AUTOMATED_RED]%'
--   AND issue_description NOT ILIKE '%MORNING ROLL%'
--   AND issue_description NOT ILIKE '%EVENING ROLL%'
--   AND issue_description NOT ILIKE '%CURFEW%';
-- Expected: 0

-- C) Movies / Trip Day open REDs still present until you Resolve in Hub:
-- SELECT id, LEFT(issue_description, 80), status, created_at
-- FROM site_issues_register
-- WHERE severity = 'red'
--   AND status <> 'resolved'
--   AND event_id = '8f8ef51f-b203-405f-b225-cb1ca9a995e8'
-- ORDER BY created_at;
-- Expected: 4 rows (verbal workaround leftovers) — clear via Hub after this migration.
