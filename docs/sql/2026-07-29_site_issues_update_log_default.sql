-- 2026-07-29 — TEST schema drift: site_issues_register.update_log DEFAULT
--
-- Symptom (TEST Alpha): departure/attendance issue insert → 23502
--   null value in column "update_log" violates not-null constraint
--
-- Cause: bootstrap CREATE TABLE used `update_log text NOT NULL` with no DEFAULT.
-- DEV has DEFAULT '' from docs/sql/2026-07-13_hub_triage_states.sql.
-- Inserts that omit update_log succeed on DEV and fail on TEST.
--
-- Safe on DEV (idempotent). Run on TEST before/with code that also sends update_log.

ALTER TABLE public.site_issues_register
  ALTER COLUMN update_log SET DEFAULT '';

COMMENT ON COLUMN public.site_issues_register.update_log IS
  'Append-only timeline. Empty string at create. Format per entry: "\n\n[DD-MM-YYYY HH:MM] Staff Name: text".';

-- Validation (expect one row, column_default = ''::text):
-- SELECT column_name, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'site_issues_register'
--   AND column_name = 'update_log';
