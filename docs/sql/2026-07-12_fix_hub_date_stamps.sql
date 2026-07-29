-- =============================================================================
-- Migration: 2026-07-12_fix_hub_date_stamps.sql
-- Purpose  : Rewrite any old-format embedded date stamps in free-text columns
--            from [DD-MM-YY/HH:mm] → [DD-Mmm-YY / HH:mm] to comply with
--            the GUARDRAILS §5.3 standard (dd-MMM-yy / HH:mm, Sydney local).
--
-- Target tables:
--   1. site_issues_register.update_log   — append-only audit timeline
--   2. hub_issue_notes.note              — defer rows only
--
-- Safe to re-run (idempotent): function is created/replaced, the UPDATE only
-- touches rows that still contain the old pattern.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper function: fix_hub_date_stamps(text) → text
-- Replaces every occurrence of the old bracket stamp pattern
--   [DD-MM-YY/HH:mm]
-- with the new format
--   [DD-Mmm-YY / HH:mm]
-- where MM (01–12) is mapped to the abbreviated English month name.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fix_hub_date_stamps(txt TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  months TEXT[] := ARRAY[
    'Jan','Feb','Mar','Apr','May','Jun',
    'Jul','Aug','Sep','Oct','Nov','Dec'
  ];
  result      TEXT := txt;
  m           TEXT[];
  dd          TEXT;
  mm_num      INT;
  mmm         TEXT;
  yy          TEXT;
  hh          TEXT;
  mi          TEXT;
  old_stamp   TEXT;
  new_stamp   TEXT;
BEGIN
  -- Loop as long as the old pattern is found.
  -- Old pattern: \[\d{2}-\d{2}-\d{2}/\d{2}:\d{2}\]
  LOOP
    m := regexp_match(
      result,
      '\[(\d{2})-(\d{2})-(\d{2})/(\d{2}):(\d{2})\]'
    );
    EXIT WHEN m IS NULL;

    dd     := m[1];
    mm_num := m[2]::INT;
    yy     := m[3];
    hh     := m[4];
    mi     := m[5];

    -- Map numeric month to abbreviated name (guard for bad data).
    IF mm_num BETWEEN 1 AND 12 THEN
      mmm := months[mm_num];
    ELSE
      mmm := m[2];  -- leave as-is if out of range
    END IF;

    old_stamp := '[' || dd || '-' || m[2] || '-' || yy || '/' || hh || ':' || mi || ']';
    new_stamp := '[' || dd || '-' || mmm || '-' || yy || ' / ' || hh || ':' || mi || ']';

    result := replace(result, old_stamp, new_stamp);
  END LOOP;

  RETURN result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Pre-migration: count how many rows need fixing (expect >= 0).
-- ---------------------------------------------------------------------------
SELECT
  'site_issues_register.update_log' AS target,
  COUNT(*) AS rows_with_old_stamps
FROM site_issues_register
WHERE update_log ~ '\[\d{2}-\d{2}-\d{2}/\d{2}:\d{2}\]'

UNION ALL

SELECT
  'hub_issue_notes.note' AS target,
  COUNT(*) AS rows_with_old_stamps
FROM hub_issue_notes
WHERE note ~ '\[\d{2}-\d{2}-\d{2}/\d{2}:\d{2}\]';

-- ---------------------------------------------------------------------------
-- Fix 1: site_issues_register.update_log
-- ---------------------------------------------------------------------------
UPDATE site_issues_register
SET    update_log = fix_hub_date_stamps(update_log)
WHERE  update_log ~ '\[\d{2}-\d{2}-\d{2}/\d{2}:\d{2}\]';

-- ---------------------------------------------------------------------------
-- Fix 2: hub_issue_notes.note (defer-note bodies only in practice)
-- ---------------------------------------------------------------------------
UPDATE hub_issue_notes
SET    note = fix_hub_date_stamps(note)
WHERE  note ~ '\[\d{2}-\d{2}-\d{2}/\d{2}:\d{2}\]';

-- ---------------------------------------------------------------------------
-- Post-migration validation: both queries should return 0.
-- ---------------------------------------------------------------------------
SELECT
  'site_issues_register.update_log' AS target,
  COUNT(*) AS remaining_old_stamps
FROM site_issues_register
WHERE update_log ~ '\[\d{2}-\d{2}-\d{2}/\d{2}:\d{2}\]'

UNION ALL

SELECT
  'hub_issue_notes.note' AS target,
  COUNT(*) AS remaining_old_stamps
FROM hub_issue_notes
WHERE note ~ '\[\d{2}-\d{2}-\d{2}/\d{2}:\d{2}\]';

-- ---------------------------------------------------------------------------
-- Clean up helper function (not needed after migration).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS fix_hub_date_stamps(TEXT);
