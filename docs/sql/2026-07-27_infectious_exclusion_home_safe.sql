-- ============================================================
-- 2026-07-27 — BL-084 A.1: Home-safe handover + trip context
-- ============================================================
-- Extends participant_infectious_exclusions for:
--   • event / event_day_session when declared from Trip Deliver
--   • non-prescriptive home-safe disposition + PIN attestation fields
-- Idempotent. Anon already has ALL on this table (Phase A).
-- ============================================================

ALTER TABLE public.participant_infectious_exclusions
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.event_manifest(id) ON DELETE SET NULL;

ALTER TABLE public.participant_infectious_exclusions
  ADD COLUMN IF NOT EXISTS event_day_session_id uuid REFERENCES public.event_day_sessions(id) ON DELETE SET NULL;

ALTER TABLE public.participant_infectious_exclusions
  ADD COLUMN IF NOT EXISTS home_safe_disposition text;

ALTER TABLE public.participant_infectious_exclusions
  ADD COLUMN IF NOT EXISTS home_safe_handover_to text;

ALTER TABLE public.participant_infectious_exclusions
  ADD COLUMN IF NOT EXISTS home_safe_note text;

ALTER TABLE public.participant_infectious_exclusions
  ADD COLUMN IF NOT EXISTS home_safe_at timestamptz;

ALTER TABLE public.participant_infectious_exclusions
  ADD COLUMN IF NOT EXISTS home_safe_by_staff_id uuid REFERENCES public.staff_registry(id);

ALTER TABLE public.participant_infectious_exclusions
  DROP CONSTRAINT IF EXISTS participant_infectious_exclusions_home_safe_disposition_check;

ALTER TABLE public.participant_infectious_exclusions
  ADD CONSTRAINT participant_infectious_exclusions_home_safe_disposition_check
  CHECK (
    home_safe_disposition IS NULL
    OR home_safe_disposition IN (
      'family_carer',
      'staff_escorted',
      'transport_taxi',
      'other'
    )
  );

CREATE INDEX IF NOT EXISTS idx_infectious_exclusions_event_day
  ON public.participant_infectious_exclusions (event_day_session_id)
  WHERE event_day_session_id IS NOT NULL;

COMMENT ON COLUMN public.participant_infectious_exclusions.home_safe_disposition IS
  'BL-084 A.1 — outcome class when person was in care and left (not a logistics plan).';

-- ============================================================
-- Validation (expect rows):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'participant_infectious_exclusions'
--     AND column_name IN (
--       'event_id','event_day_session_id','home_safe_disposition',
--       'home_safe_handover_to','home_safe_note','home_safe_at','home_safe_by_staff_id'
--     )
--   ORDER BY column_name;
--   → 7 rows
-- ============================================================
