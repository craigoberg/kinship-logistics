-- 2026-07-18 — Trip Day Hub issues: text reporter + backfill roll Yellow/Red
--
-- Re-run safe (idempotent). Fixes orphan [CURFEW]/[MORNING ROLL] Hub rows that
-- lost escalation_issue_id links (still open, still show as Day Centre).
--
-- Run in Supabase SQL Editor → Run All.

-- ── 1. reported_by → text ───────────────────────────────────────────────────
DO $$
DECLARE
  fk_name text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'site_issues_register'
      AND column_name = 'reported_by'
      AND data_type = 'uuid'
  ) THEN
    FOR fk_name IN
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'site_issues_register'
        AND c.contype = 'f'
        AND pg_get_constraintdef(c.oid) ILIKE '%reported_by%'
    LOOP
      EXECUTE format('ALTER TABLE public.site_issues_register DROP CONSTRAINT %I', fk_name);
    END LOOP;

    ALTER TABLE public.site_issues_register
      ALTER COLUMN reported_by TYPE text
      USING reported_by::text;
  END IF;
END $$;

COMMENT ON COLUMN public.site_issues_register.reported_by IS
  'Reporter attribution: auth/staff UUID, display name, or System for automated sweeps.';

-- ── 2. Backfill via live escalation_issue_id links ───────────────────────────
UPDATE public.site_issues_register i
SET
  event_day_session_id = COALESCE(i.event_day_session_id, src.session_id),
  event_id = COALESCE(
    i.event_id,
    (SELECT s.event_id FROM public.event_day_sessions s WHERE s.id = src.session_id)
  ),
  reported_by = COALESCE(NULLIF(TRIM(i.reported_by), ''), 'System')
FROM (
  SELECT escalation_issue_id AS issue_id, event_day_session_id AS session_id
  FROM public.event_morning_log
  WHERE escalation_issue_id IS NOT NULL
  UNION
  SELECT escalation_issue_id, event_day_session_id
  FROM public.event_curfew_log
  WHERE escalation_issue_id IS NOT NULL
) src
WHERE i.id = src.issue_id
  AND i.status = 'open'
  AND (i.event_id IS NULL OR i.event_day_session_id IS NULL OR i.reported_by IS NULL);

-- ── 3. Orphan [CURFEW] / [MORNING ROLL] — match participant name → latest log ─
-- (escalation_issue_id was cleared on defer/account but Hub row stayed open)
WITH orphan AS (
  SELECT i.id AS issue_id,
         i.issue_description,
         CASE
           WHEN i.issue_description ILIKE '%[CURFEW]%'
             OR i.issue_description ILIKE '%[EVENING ROLL]%' THEN 'curfew'
           WHEN i.issue_description ILIKE '%[MORNING ROLL]%'
             OR i.issue_description ILIKE '%[MORNING]%' THEN 'morning'
           ELSE NULL
         END AS roll_kind
  FROM public.site_issues_register i
  WHERE i.status = 'open'
    AND i.event_id IS NULL
    AND (
      i.issue_description ILIKE '%[CURFEW]%'
      OR i.issue_description ILIKE '%[EVENING ROLL]%'
      OR i.issue_description ILIKE '%[MORNING ROLL]%'
      OR i.issue_description ILIKE '%[AUTOMATED_RED]%'
    )
),
named AS (
  SELECT
    o.issue_id,
    o.roll_kind,
    p.id AS participant_id
  FROM orphan o
  JOIN public.participants p
    ON o.issue_description ILIKE
      ('%' || TRIM(BOTH FROM COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) || '%')
  WHERE LENGTH(TRIM(BOTH FROM COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, ''))) >= 3
),
picked AS (
  SELECT * FROM (
    SELECT DISTINCT ON (n.issue_id)
      n.issue_id,
      cl.event_day_session_id AS session_id
    FROM named n
    JOIN public.event_curfew_log cl ON cl.participant_id = n.participant_id
    WHERE n.roll_kind = 'curfew'
    ORDER BY n.issue_id, cl.updated_at DESC NULLS LAST, cl.created_at DESC NULLS LAST
  ) curfew_pick
  UNION ALL
  SELECT * FROM (
    SELECT DISTINCT ON (n.issue_id)
      n.issue_id,
      ml.event_day_session_id AS session_id
    FROM named n
    JOIN public.event_morning_log ml ON ml.participant_id = n.participant_id
    WHERE n.roll_kind = 'morning'
    ORDER BY n.issue_id, ml.updated_at DESC NULLS LAST, ml.created_at DESC NULLS LAST
  ) morning_pick
)
UPDATE public.site_issues_register i
SET
  event_day_session_id = p.session_id,
  event_id = s.event_id,
  reported_by = COALESCE(NULLIF(TRIM(i.reported_by), ''), 'System')
FROM picked p
JOIN public.event_day_sessions s ON s.id = p.session_id
WHERE i.id = p.issue_id
  AND i.event_id IS NULL;

-- ── 4. Enrich description with trip title · day (when still sparse) ─────────
UPDATE public.site_issues_register i
SET issue_description = regexp_replace(
  i.issue_description,
  '^(\[(?:AUTOMATED_RED|CURFEW|EVENING ROLL|MORNING ROLL)\])\s+',
  '\1 ' || em.title || ' · ' || to_char(s.session_date, 'DD-Mon-YY') || ': ',
  'i'
)
FROM public.event_day_sessions s
JOIN public.event_manifest em ON em.id = s.event_id
WHERE i.event_day_session_id = s.id
  AND i.status = 'open'
  AND (
    i.issue_description ILIKE '%[CURFEW]%'
    OR i.issue_description ILIKE '%[EVENING ROLL]%'
    OR i.issue_description ILIKE '%[MORNING ROLL]%'
    OR i.issue_description ILIKE '%[AUTOMATED_RED]%'
  )
  AND i.issue_description NOT ILIKE '% · %';

NOTIFY pgrst, 'reload schema';

-- ── Validation ──────────────────────────────────────────────────────────────
-- Expect: text
-- SELECT data_type FROM information_schema.columns
-- WHERE table_name = 'site_issues_register' AND column_name = 'reported_by';
--
-- Expect: has_event true, reported_by System, description includes trip title
-- SELECT id, event_id IS NOT NULL AS has_event, reported_by, left(issue_description, 100)
-- FROM site_issues_register
-- WHERE status = 'open'
--   AND (issue_description ILIKE '%CURFEW%' OR issue_description ILIKE '%ROLL%')
-- ORDER BY created_at DESC LIMIT 15;
