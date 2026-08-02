-- BL-106 — Human Incident: multiple assisting / involved staff.
--
-- Adds assisting_staff_ids uuid[] (canonical).
-- Backfills from legacy assisting_staff_id when that column exists.
--
-- Supabase SQL Editor may end with "Success. No rows returned" for DDL — expected.

ALTER TABLE public.operational_incidents
  ADD COLUMN IF NOT EXISTS assisting_staff_ids uuid[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'operational_incidents'
      AND column_name = 'assisting_staff_id'
  ) THEN
    UPDATE public.operational_incidents
    SET assisting_staff_ids = ARRAY[assisting_staff_id]
    WHERE assisting_staff_id IS NOT NULL
      AND cardinality(assisting_staff_ids) = 0;
  END IF;
END $$;

COMMENT ON COLUMN public.operational_incidents.assisting_staff_ids IS
  'Staff who assisted / were involved (Human lane). May differ from reporter.';

-- ── Validation (expect 1 row) ───────────────────────────────────────────────
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'operational_incidents'
--   AND column_name = 'assisting_staff_ids';
-- -- expect: assisting_staff_ids | ARRAY
