-- =============================================================================
-- 2026-08-21 — Client support plan, risk assessment & communication (BL-114)
-- =============================================================================
--
-- Thin organisational artefacts for registration groups 0136 / 0125 / 0108
-- (day centre, community access, transport). Not a SIL care-plan suite.
--
--   * participants columns = live Care Profile / onboarding mapping
--   * Hub assets created on Client pack Signed & filed (same +12 month
--     cadence as client_profile_review / client_consent_pack)
--   * Paper evidence = Client Intake print pack (wet-sign)
--
-- Run on DEV then TEST. SQL Editor "Success. No rows returned" is normal
-- for the ALTER / COMMENT / INSERT-if-none body.
--
-- Re-run is safe (IF NOT EXISTS / NOT EXISTS guards).
-- =============================================================================

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS support_goals text,
  ADD COLUMN IF NOT EXISTS support_strengths text,
  ADD COLUMN IF NOT EXISTS support_needs text,
  ADD COLUMN IF NOT EXISTS support_preferences text,
  ADD COLUMN IF NOT EXISTS communication_mode text,
  ADD COLUMN IF NOT EXISTS communication_strategies text,
  ADD COLUMN IF NOT EXISTS risk_hazards text,
  ADD COLUMN IF NOT EXISTS risk_controls text;

COMMENT ON COLUMN public.participants.support_goals IS
  'BL-114 organisational support plan — goals (0136/0125/0108).';
COMMENT ON COLUMN public.participants.support_strengths IS
  'BL-114 organisational support plan — strengths.';
COMMENT ON COLUMN public.participants.support_needs IS
  'BL-114 organisational support plan — support needs.';
COMMENT ON COLUMN public.participants.support_preferences IS
  'BL-114 organisational support plan — wishes / how they like supports delivered.';
COMMENT ON COLUMN public.participants.communication_mode IS
  'BL-114 how the person communicates (speech, Auslan, AAC, etc.).';
COMMENT ON COLUMN public.participants.communication_strategies IS
  'BL-114 what staff should do to communicate / be understood.';
COMMENT ON COLUMN public.participants.risk_hazards IS
  'BL-114 participant risk profile — hazards for centre / outings / transport.';
COMMENT ON COLUMN public.participants.risk_controls IS
  'BL-114 participant risk profile — staff controls / what we do.';

-- Hub review cards for already signed client packs (same due date as the pack).
INSERT INTO public.compliance_assets (
  category,
  type,
  name,
  description,
  subject_table,
  subject_id,
  expiry_date,
  next_action_at,
  action_module,
  config,
  status,
  created_by
)
SELECT
  'PARTICIPANT',
  'client_support_plan',
  'Client support plan — ' || COALESCE(oc.display_name, 'Client'),
  'Annual organisational support plan review (goals, strengths, needs, communication). Reset on Onboarding Review/Update re-file (BL-114).',
  'participants',
  oc.subject_id,
  COALESCE(oc.review_due_at, (oc.signed_at::date + interval '1 year')::date),
  NULL,
  'generic_resolve',
  jsonb_build_object(
    'yellow_days', 60,
    'red_days', 14,
    'handshake', 'single',
    'onboarding_alpha', true,
    'bl114', true
  ),
  'active',
  oc.confirmed_by_staff_id
FROM public.onboarding_cases oc
WHERE oc.pack_type = 'client'
  AND oc.status = 'signed_filed'
  AND oc.subject_table = 'participants'
  AND oc.subject_id IS NOT NULL
  AND COALESCE(oc.review_due_at, oc.signed_at::date) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
      FROM public.compliance_assets ca
     WHERE ca.subject_table = 'participants'
       AND ca.subject_id = oc.subject_id
       AND ca.type = 'client_support_plan'
       AND ca.status = 'active'
  );

INSERT INTO public.compliance_assets (
  category,
  type,
  name,
  description,
  subject_table,
  subject_id,
  expiry_date,
  next_action_at,
  action_module,
  config,
  status,
  created_by
)
SELECT
  'PARTICIPANT',
  'client_risk_assessment',
  'Client risk assessment — ' || COALESCE(oc.display_name, 'Client'),
  'Annual participant risk profile review (centre / community / transport). Reset on Onboarding Review/Update re-file (BL-114).',
  'participants',
  oc.subject_id,
  COALESCE(oc.review_due_at, (oc.signed_at::date + interval '1 year')::date),
  NULL,
  'generic_resolve',
  jsonb_build_object(
    'yellow_days', 60,
    'red_days', 14,
    'handshake', 'single',
    'onboarding_alpha', true,
    'bl114', true
  ),
  'active',
  oc.confirmed_by_staff_id
FROM public.onboarding_cases oc
WHERE oc.pack_type = 'client'
  AND oc.status = 'signed_filed'
  AND oc.subject_table = 'participants'
  AND oc.subject_id IS NOT NULL
  AND COALESCE(oc.review_due_at, oc.signed_at::date) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
      FROM public.compliance_assets ca
     WHERE ca.subject_table = 'participants'
       AND ca.subject_id = oc.subject_id
       AND ca.type = 'client_risk_assessment'
       AND ca.status = 'active'
  );

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Validation (run after load — these SHOULD return rows)
--
-- A) New columns exist — expect 8 rows:
--    SELECT column_name
--    FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name = 'participants'
--      AND column_name IN (
--        'support_goals', 'support_strengths', 'support_needs',
--        'support_preferences', 'communication_mode', 'communication_strategies',
--        'risk_hazards', 'risk_controls'
--      )
--    ORDER BY 1;
--
-- B) Authenticated can still SELECT participants (BL-117) — expect 1+ rows:
--    SELECT privilege_type
--    FROM information_schema.role_table_grants
--    WHERE table_schema = 'public'
--      AND table_name = 'participants'
--      AND grantee = 'authenticated'
--      AND privilege_type = 'SELECT';
--
-- C) Anon still has no SELECT on participants — expect 0 rows:
--    SELECT privilege_type
--    FROM information_schema.role_table_grants
--    WHERE table_schema = 'public'
--      AND table_name = 'participants'
--      AND grantee = 'anon';
--
-- D) Hub assets for signed client packs (0 rows is OK if none signed yet):
--    SELECT type, count(*)
--    FROM compliance_assets
--    WHERE type IN ('client_support_plan', 'client_risk_assessment')
--      AND status = 'active'
--    GROUP BY 1;
-- =============================================================================
