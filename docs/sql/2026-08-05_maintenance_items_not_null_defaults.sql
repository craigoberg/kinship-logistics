-- =============================================================================
-- 2026-08-05 — maintenance_items NOT NULL defaults (TEST bootstrap)
-- =============================================================================
--
-- Symptom (Big Red / Incident Intake → Asset lane):
--   null value in column "status" of relation "maintenance_items"
--   violates not-null constraint
--
-- Cause: TEST bootstrap CREATE TABLE IF NOT EXISTS built status / severity /
--   source / defer_count as NOT NULL without DEFAULT. Proper migrations use:
--     status DEFAULT 'open'
--     severity DEFAULT 'yellow'
--     source DEFAULT 'manual'
--     defer_count DEFAULT 0
--
-- App fix: createMaintenanceItem always sends status='open', defer_count=0.
-- This SQL hardens the DB.
--
-- Idempotent. Run on TEST (and DEV for parity).
-- =============================================================================

ALTER TABLE public.maintenance_items
  ALTER COLUMN status SET DEFAULT 'open';

ALTER TABLE public.maintenance_items
  ALTER COLUMN severity SET DEFAULT 'yellow';

ALTER TABLE public.maintenance_items
  ALTER COLUMN source SET DEFAULT 'manual';

ALTER TABLE public.maintenance_items
  ALTER COLUMN defer_count SET DEFAULT 0;

UPDATE public.maintenance_items
   SET status = COALESCE(status, 'open')
 WHERE status IS NULL;

UPDATE public.maintenance_items
   SET severity = COALESCE(severity, 'yellow')
 WHERE severity IS NULL;

UPDATE public.maintenance_items
   SET source = COALESCE(source, 'manual')
 WHERE source IS NULL;

UPDATE public.maintenance_items
   SET defer_count = COALESCE(defer_count, 0)
 WHERE defer_count IS NULL;

-- Optional: human-time column used by intake (ignore if already present)
ALTER TABLE public.maintenance_items
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz NULL;

-- Validation:
-- SELECT column_name, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'maintenance_items'
--   AND column_name IN ('status', 'severity', 'source', 'defer_count', 'occurred_at');
