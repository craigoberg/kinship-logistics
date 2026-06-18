-- 2026-06-18 — Dual-witnessed medication discontinuation audit trail
-- Adds compliance fields to participant_medication_schedules so that
-- archiving a routine captures who authorised it, who witnessed it, the
-- physical paper trail, and the clinical reason. Idempotent.

ALTER TABLE public.participant_medication_schedules
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Active';

ALTER TABLE public.participant_medication_schedules
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE public.participant_medication_schedules
  ADD COLUMN IF NOT EXISTS archived_by_id uuid
    REFERENCES public.staff_registry(id) ON DELETE SET NULL;

ALTER TABLE public.participant_medication_schedules
  ADD COLUMN IF NOT EXISTS archive_witnessed_by_id uuid
    REFERENCES public.staff_registry(id) ON DELETE SET NULL;

ALTER TABLE public.participant_medication_schedules
  ADD COLUMN IF NOT EXISTS archive_reference_type text;

ALTER TABLE public.participant_medication_schedules
  ADD COLUMN IF NOT EXISTS archive_reason text;

-- Backfill status for existing rows to match the legacy `active` flag.
UPDATE public.participant_medication_schedules
   SET status = CASE WHEN active THEN 'Active' ELSE 'Archived' END
 WHERE status IS NULL OR status = 'Active';

-- Constrain allowed reference sources at the DB level.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'participant_medication_schedules_archive_reference_type_check'
  ) THEN
    ALTER TABLE public.participant_medication_schedules
      ADD CONSTRAINT participant_medication_schedules_archive_reference_type_check
      CHECK (
        archive_reference_type IS NULL
        OR archive_reference_type IN (
          'Doctor Certificate / Medical Order',
          'Carer Written Request',
          'Management Operational Directive'
        )
      );
  END IF;
END $$;
