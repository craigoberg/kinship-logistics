-- 2026-07-29 — TEST: infectious exclusions FK for PostgREST embed
--
-- Symptom: GET .../participant_infectious_exclusions?select=*,participants(...)
--   → 400 Bad Request
--
-- Cause: OpenAPI bootstrap created the table without FOREIGN KEY to participants.
-- PostgREST needs that FK to resolve the participants(...) embed.
-- Safe / idempotent on DEV and TEST.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.participant_infectious_exclusions'::regclass
      AND contype = 'f'
      AND conname = 'participant_infectious_exclusions_participant_id_fkey'
  ) THEN
    ALTER TABLE public.participant_infectious_exclusions
      ADD CONSTRAINT participant_infectious_exclusions_participant_id_fkey
      FOREIGN KEY (participant_id)
      REFERENCES public.participants(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Optional related FKs (skip if already present / orphaned data would block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.participant_infectious_exclusions'::regclass
      AND conname = 'participant_infectious_exclusions_hub_issue_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE public.participant_infectious_exclusions
        ADD CONSTRAINT participant_infectious_exclusions_hub_issue_id_fkey
        FOREIGN KEY (hub_issue_id)
        REFERENCES public.site_issues_register(id)
        ON DELETE SET NULL;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'hub_issue_id FK skipped: %', SQLERRM;
    END;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.participant_infectious_exclusions'::regclass
      AND conname = 'participant_infectious_exclusions_declared_by_staff_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE public.participant_infectious_exclusions
        ADD CONSTRAINT participant_infectious_exclusions_declared_by_staff_id_fkey
        FOREIGN KEY (declared_by_staff_id)
        REFERENCES public.staff_registry(id);
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'declared_by_staff_id FK skipped: %', SQLERRM;
    END;
  END IF;
END $$;

-- Ensure anon can read (PIN terminal)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.participant_infectious_exclusions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.participant_infectious_exclusions TO authenticated;

-- Validation (expect at least participant_id → participants):
-- SELECT conname, confrelid::regclass AS references_table
-- FROM pg_constraint
-- WHERE conrelid = 'public.participant_infectious_exclusions'::regclass
--   AND contype = 'f'
-- ORDER BY conname;
