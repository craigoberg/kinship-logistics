-- =============================================================================
-- 2026-08-05 — venue_safety_baseline_signoffs.signed_off_at DEFAULT now()
-- =============================================================================
--
-- Symptom (TEST): Sign baseline → "null value in column signed_off_at …"
-- Cause: OpenAPI/bootstrap table had signed_off_at NOT NULL with no DEFAULT;
--        app insert omitted the column. Phase-0 DEV SQL already had DEFAULT now().
--
-- Idempotent. Safe on DEV + TEST.
-- "Success. No rows returned" is normal for ALTER.
-- =============================================================================

ALTER TABLE public.venue_safety_baseline_signoffs
  ALTER COLUMN signed_off_at SET DEFAULT now();

-- Backfill safety: if any legacy nulls somehow exist (should not)
UPDATE public.venue_safety_baseline_signoffs
   SET signed_off_at = COALESCE(signed_off_at, created_at, now())
 WHERE signed_off_at IS NULL;

-- Validation (expect one row with a non-null default expression):
-- SELECT column_name, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'venue_safety_baseline_signoffs'
--   AND column_name = 'signed_off_at';
-- Expect: column_default like 'now()' / 'CURRENT_TIMESTAMP', is_nullable = 'NO'
