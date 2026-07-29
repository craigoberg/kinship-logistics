-- ============================================================
-- 2026-07-27 — BL-084 Phase A: Infectious exclusion + return-to-care
-- ============================================================
-- participant_infectious_exclusions + site_issues_register.issue_area
-- Idempotent. Anon grants for PIN terminals.
-- ============================================================

-- ── 1) Issue area on Hub Human issues ───────────────────────────────────────
ALTER TABLE public.site_issues_register
  ADD COLUMN IF NOT EXISTS issue_area text;

ALTER TABLE public.site_issues_register
  DROP CONSTRAINT IF EXISTS site_issues_register_issue_area_check;

ALTER TABLE public.site_issues_register
  ADD CONSTRAINT site_issues_register_issue_area_check
  CHECK (
    issue_area IS NULL
    OR issue_area IN ('general', 'health_safety')
  );

COMMENT ON COLUMN public.site_issues_register.issue_area IS
  'Hub area tag: general (default) | health_safety (BL-084 infection / site close / emergency).';

-- ── 2) Exclusion register ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.participant_infectious_exclusions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id          uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  category                text NOT NULL,
  notes                   text,
  exclude_centre          boolean NOT NULL DEFAULT true,
  exclude_trips           boolean NOT NULL DEFAULT true,
  excluded_from           date NOT NULL DEFAULT (timezone('Australia/Sydney', now()))::date,
  status                  text NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'cleared')),
  hub_issue_id            uuid REFERENCES public.site_issues_register(id) ON DELETE SET NULL,
  site_day_session_id     uuid REFERENCES public.site_day_sessions(id) ON DELETE SET NULL,
  declared_by_staff_id    uuid NOT NULL REFERENCES public.staff_registry(id),
  declared_at             timestamptz NOT NULL DEFAULT now(),
  clearance_method        text
                            CHECK (
                              clearance_method IS NULL
                              OR clearance_method IN ('carer_attestation', 'medical_cert')
                            ),
  clearance_note          text,
  evidence_ref            text,
  cleared_by_staff_id     uuid REFERENCES public.staff_registry(id),
  cleared_at              timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT participant_infectious_exclusions_category_check
    CHECK (category IN ('respiratory', 'gi', 'skin_parasite', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_infectious_exclusions_participant
  ON public.participant_infectious_exclusions (participant_id);

CREATE INDEX IF NOT EXISTS idx_infectious_exclusions_active
  ON public.participant_infectious_exclusions (status)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_infectious_exclusions_hub_issue
  ON public.participant_infectious_exclusions (hub_issue_id)
  WHERE hub_issue_id IS NOT NULL;

COMMENT ON TABLE public.participant_infectious_exclusions IS
  'BL-084 Phase A — manager-declared infectious exclusion until clearance (attestation or medical cert).';

-- At most one active exclusion per participant
CREATE UNIQUE INDEX IF NOT EXISTS uq_infectious_exclusions_one_active
  ON public.participant_infectious_exclusions (participant_id)
  WHERE status = 'active';

-- ── 3) RLS + anon (PIN terminals) ───────────────────────────────────────────
ALTER TABLE public.participant_infectious_exclusions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS infectious_exclusions_anon_all ON public.participant_infectious_exclusions;
CREATE POLICY infectious_exclusions_anon_all
  ON public.participant_infectious_exclusions
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.participant_infectious_exclusions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.participant_infectious_exclusions TO authenticated;
GRANT ALL ON public.participant_infectious_exclusions TO service_role;

-- issue_area already covered by existing site_issues_register grants

-- ============================================================
-- Validation (expect rows):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'site_issues_register' AND column_name = 'issue_area';
--   → 1 row
--
--   SELECT relname FROM pg_class WHERE relname = 'participant_infectious_exclusions';
--   → 1 row
--
-- DDL-only scripts often end "Success. No rows returned" — that is normal.
-- ============================================================
