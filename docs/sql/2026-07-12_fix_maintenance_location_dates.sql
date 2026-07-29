-- Fix raw ISO dates embedded in maintenance_items.location_label.
--
-- Patterns stored by source code before this fix:
--   "Movies · 2026-07-07"           (event-day verbal anomaly)
--   "Bus Name (REGO) — Pre-trip 2026-07-07"  (vehicle pre-trip issue)
--
-- Both contain YYYY-MM-DD which we convert to DD-Mmm-YY (e.g. 07-Jul-26).
-- Idempotent: rows already in correct format contain no bare YYYY-MM-DD.

DO $$
DECLARE
  MONTHS TEXT[] := ARRAY[
    'Jan','Feb','Mar','Apr','May','Jun',
    'Jul','Aug','Sep','Oct','Nov','Dec'
  ];
  rec   RECORD;
  label TEXT;
  m     TEXT[];
  yr    TEXT;
  mo    INT;
  dy    TEXT;
  fixed TEXT;
BEGIN
  FOR rec IN
    SELECT id, location_label
    FROM   maintenance_items
    WHERE  location_label ~ '\d{4}-\d{2}-\d{2}'
  LOOP
    label := rec.location_label;
    -- Replace every YYYY-MM-DD occurrence in the string
    LOOP
      m := regexp_match(label, '(\d{4})-(\d{2})-(\d{2})');
      EXIT WHEN m IS NULL;
      yr    := substring(m[1], 3, 2);           -- last 2 digits of year
      mo    := m[2]::INT;
      dy    := lpad(m[3], 2, '0');
      fixed := dy || '-' || MONTHS[mo] || '-' || yr;
      label := regexp_replace(label, m[1] || '-' || m[2] || '-' || m[3], fixed);
    END LOOP;
    UPDATE maintenance_items SET location_label = label WHERE id = rec.id;
  END LOOP;
END $$;

-- Validation — expect no rows with bare YYYY-MM-DD in location_label:
SELECT id, title, location_label
FROM   maintenance_items
WHERE  location_label ~ '\d{4}-\d{2}-\d{2}'
ORDER  BY created_at DESC;
