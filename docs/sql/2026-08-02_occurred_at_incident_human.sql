-- BL-106 — Occurred at vs Logged at + Human Incident who-fields.
--
--   operational_incidents: occurred_at, affected_participant_ids,
--                          assisting_staff_id (legacy single), assisting_staff_ids,
--                          no_participant_involved
--   site_issues_register:  occurred_at
--   maintenance_items:     occurred_at
--
-- Legacy rows: occurred_at backfilled from created_at.
-- Supabase SQL Editor may end with "Success. No rows returned" for DDL — expected.

-- ── operational_incidents ───────────────────────────────────────────────────
ALTER TABLE public.operational_incidents
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz;

ALTER TABLE public.operational_incidents
  ADD COLUMN IF NOT EXISTS affected_participant_ids uuid[] NOT NULL DEFAULT '{}';

ALTER TABLE public.operational_incidents
  ADD COLUMN IF NOT EXISTS assisting_staff_id uuid
    REFERENCES public.staff_registry(id) ON DELETE SET NULL;

ALTER TABLE public.operational_incidents
  ADD COLUMN IF NOT EXISTS assisting_staff_ids uuid[] NOT NULL DEFAULT '{}';

ALTER TABLE public.operational_incidents
  ADD COLUMN IF NOT EXISTS no_participant_involved boolean NOT NULL DEFAULT false;

UPDATE public.operational_incidents
SET occurred_at = created_at
WHERE occurred_at IS NULL;

COMMENT ON COLUMN public.operational_incidents.occurred_at IS
  'When the incident actually happened (operator-entered). created_at = when filed.';
COMMENT ON COLUMN public.operational_incidents.affected_participant_ids IS
  'Client(s) involved — Human lane. Empty when no_participant_involved.';
COMMENT ON COLUMN public.operational_incidents.assisting_staff_id IS
  'Legacy single assisting staff — prefer assisting_staff_ids.';
COMMENT ON COLUMN public.operational_incidents.assisting_staff_ids IS
  'Staff who assisted / were involved (Human lane). May differ from reporter.';
COMMENT ON COLUMN public.operational_incidents.no_participant_involved IS
  'True when Human incident has no registered client (staff-only / other).';

-- ── site_issues_register ────────────────────────────────────────────────────
ALTER TABLE public.site_issues_register
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz;

UPDATE public.site_issues_register
SET occurred_at = created_at
WHERE occurred_at IS NULL;

COMMENT ON COLUMN public.site_issues_register.occurred_at IS
  'When the issue actually happened (operator-entered). created_at = when logged.';

-- ── maintenance_items ───────────────────────────────────────────────────────
ALTER TABLE public.maintenance_items
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz;

UPDATE public.maintenance_items
SET occurred_at = created_at
WHERE occurred_at IS NULL;

COMMENT ON COLUMN public.maintenance_items.occurred_at IS
  'When the fault/issue actually happened. created_at = when logged.';

-- ── Validation (expect rows) ────────────────────────────────────────────────
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'operational_incidents'
--   AND column_name IN (
--     'occurred_at', 'affected_participant_ids',
--     'assisting_staff_id', 'assisting_staff_ids', 'no_participant_involved'
--   )
-- ORDER BY column_name;
-- -- expect 5 rows
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'site_issues_register'
--   AND column_name = 'occurred_at';
-- -- expect 1 row
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'maintenance_items'
--   AND column_name = 'occurred_at';
-- -- expect 1 row
