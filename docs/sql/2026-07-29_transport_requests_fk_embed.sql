-- 2026-07-29 — TEST: transport_requests FK for PostgREST embed
--
-- Symptom (Transport menu):
--   PGRST200 — Could not find a relationship between 'transport_requests'
--   and 'participants' in the schema cache
--
-- Cause: OpenAPI bootstrap created transport_requests without FOREIGN KEY
-- to participants. listTransportRequests embeds participants(first_name, last_name).
-- Idempotent. Safe on DEV and TEST.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.transport_requests'::regclass
      AND contype = 'f'
      AND conname = 'transport_requests_participant_id_fkey'
  ) THEN
    ALTER TABLE public.transport_requests
      ADD CONSTRAINT transport_requests_participant_id_fkey
      FOREIGN KEY (participant_id)
      REFERENCES public.participants(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Optional related FKs (skip on orphaned data)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.transport_requests'::regclass
      AND conname = 'transport_requests_assigned_driver_staff_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE public.transport_requests
        ADD CONSTRAINT transport_requests_assigned_driver_staff_id_fkey
        FOREIGN KEY (assigned_driver_staff_id)
        REFERENCES public.staff_registry(id)
        ON DELETE SET NULL;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'assigned_driver_staff_id FK skipped: %', SQLERRM;
    END;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.transport_requests'::regclass
      AND conname = 'transport_requests_assigned_asset_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE public.transport_requests
        ADD CONSTRAINT transport_requests_assigned_asset_id_fkey
        FOREIGN KEY (assigned_asset_id)
        REFERENCES public.transport_assets(id)
        ON DELETE SET NULL;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'assigned_asset_id FK skipped: %', SQLERRM;
    END;
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transport_requests TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transport_requests TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Validation (expect participant_id → participants):
-- SELECT conname, confrelid::regclass AS references_table
-- FROM pg_constraint
-- WHERE conrelid = 'public.transport_requests'::regclass
--   AND contype = 'f'
-- ORDER BY conname;
