-- =============================================================================
-- 2026-08-05 — transport_trips.started_at DEFAULT now()
-- =============================================================================
--
-- Symptom (Manifest Start Run / Day Centre bus):
--   null value in column "started_at" of relation "transport_trips"
--   violates not-null constraint (23502)
--
-- Cause: TEST bootstrap has started_at NOT NULL with no DEFAULT; app inserts
--        omitted the column. App now sends started_at; this SQL hardens the DB.
--
-- Idempotent. Run on TEST (and DEV for parity).
-- =============================================================================

ALTER TABLE public.transport_trips
  ALTER COLUMN started_at SET DEFAULT now();

UPDATE public.transport_trips
   SET started_at = COALESCE(started_at, created_at, now())
 WHERE started_at IS NULL;

-- Validation:
-- SELECT column_name, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'transport_trips'
--   AND column_name = 'started_at';
