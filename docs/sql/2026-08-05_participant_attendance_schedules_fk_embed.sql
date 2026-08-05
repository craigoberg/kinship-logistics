-- =============================================================================
-- 2026-08-05 — TEST: participant_attendance_schedules → participants FK embed
-- =============================================================================
--
-- Symptom (Manifest / attendance / participants directory):
--   GET .../participant_attendance_schedules?select=...,participants!inner(...)
--   → 400 PGRST200 "Could not find a relationship between
--      'participant_attendance_schedules' and 'participants'"
--
-- Cause: TEST OpenAPI bootstrap created participant_id without FOREIGN KEY.
-- PostgREST needs the FK for embed.
--
-- Idempotent. Run on TEST (safe on DEV if FK already exists).
-- "Success. No rows returned" is normal for the DO block.
-- =============================================================================

-- 0) Orphans — fix these before ADD CONSTRAINT if any rows return
-- SELECT s.id, s.participant_id
-- FROM public.participant_attendance_schedules s
-- LEFT JOIN public.participants p ON p.id = s.participant_id
-- WHERE s.participant_id IS NOT NULL AND p.id IS NULL;

-- Null out orphans so FK can apply (keeps schedule rows; re-link in UI if needed)
UPDATE public.participant_attendance_schedules s
SET participant_id = NULL
WHERE participant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.participants p WHERE p.id = s.participant_id
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.participant_attendance_schedules'::regclass
      AND contype = 'f'
      AND conname = 'participant_attendance_schedules_participant_id_fkey'
  ) THEN
    ALTER TABLE public.participant_attendance_schedules
      ADD CONSTRAINT participant_attendance_schedules_participant_id_fkey
      FOREIGN KEY (participant_id)
      REFERENCES public.participants(id)
      ON DELETE CASCADE;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- Validation (expect 1 row: participant_id → participants)
-- SELECT
--   conname,
--   confrelid::regclass AS references_table
-- FROM pg_constraint
-- WHERE conrelid = 'public.participant_attendance_schedules'::regclass
--   AND contype = 'f'
--   AND conname = 'participant_attendance_schedules_participant_id_fkey';
