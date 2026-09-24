-- =============================================================================
-- 2026-08-10 — Onboarding cases (BL-065 ALPHA)
-- =============================================================================
--
-- Office onboarding drafts + signed/filed evidence (Filing location text).
-- Form answers live in form_payload JSONB; operational tables are updated on
-- confirm / signed_filed from the app.
--
-- Idempotent. "Success. No rows returned" is normal for DDL.
-- PIN terminals use anon — grants + permissive RLS required.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.onboarding_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_type text NOT NULL
    CHECK (pack_type IN ('client', 'staff', 'volunteer', 'accompanying')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'office_confirmed', 'signed_filed', 'superseded')),
  subject_table text NULL,
  subject_id uuid NULL,
  form_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  filing_location text NULL,
  signed_at timestamptz NULL,
  signee_name text NULL,
  signee_relationship text NULL,
  confirmed_by_staff_id uuid NULL REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  review_due_at date NULL,
  display_name text NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS onboarding_cases_status_idx
  ON public.onboarding_cases (status);

CREATE INDEX IF NOT EXISTS onboarding_cases_pack_type_idx
  ON public.onboarding_cases (pack_type);

CREATE INDEX IF NOT EXISTS onboarding_cases_subject_idx
  ON public.onboarding_cases (subject_table, subject_id);

CREATE INDEX IF NOT EXISTS onboarding_cases_updated_at_idx
  ON public.onboarding_cases (updated_at DESC);

COMMENT ON TABLE public.onboarding_cases IS
  'BL-065 ALPHA: onboarding drafts and signed/filed packs (Filing location evidence until SharePoint/scan).';

-- updated_at trigger (reuse pattern if function exists; else inline)
CREATE OR REPLACE FUNCTION public.set_onboarding_cases_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_onboarding_cases_updated_at ON public.onboarding_cases;
CREATE TRIGGER trg_onboarding_cases_updated_at
  BEFORE UPDATE ON public.onboarding_cases
  FOR EACH ROW
  EXECUTE FUNCTION public.set_onboarding_cases_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_cases
  TO anon, authenticated, service_role;

ALTER TABLE public.onboarding_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kinship_anon_all_onboarding_cases ON public.onboarding_cases;
CREATE POLICY kinship_anon_all_onboarding_cases
  ON public.onboarding_cases
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Validation (expect rows after app creates cases; DDL-only run returns none):
--
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'onboarding_cases'
-- ORDER BY ordinal_position;
-- Expect: id, pack_type, status, subject_table, subject_id, form_payload,
--   filing_location, signed_at, signee_name, signee_relationship,
--   confirmed_by_staff_id, review_due_at, display_name, notes, created_at, updated_at
--
-- SELECT polname FROM pg_policy
-- WHERE polrelid = 'public.onboarding_cases'::regclass;
-- Expect: kinship_anon_all_onboarding_cases
--
-- SELECT has_table_privilege('anon', 'public.onboarding_cases', 'INSERT');
-- Expect: true
-- =============================================================================
