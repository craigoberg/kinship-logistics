-- Service exit for clients and staff/volunteers.
-- Records stay. service_status / active stops future runs, medication, and trips.
-- Guest archive (participants.archived_at) is unchanged.
-- Carers are not off-boarded here.
--
-- Success. No rows returned = expected for ALTER TABLE / ADD CONSTRAINT.
-- That message is not proof the columns exist — run the validation queries below.
--
-- Validation (expect 5 rows):
--   SELECT column_name
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name = 'participants'
--     AND column_name IN ('service_status','exited_at','exited_by_id','exit_reason','exit_notes')
--   ORDER BY column_name;
--
-- Validation (expect 4 rows):
--   SELECT column_name
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name = 'staff_registry'
--     AND column_name IN ('exited_at','exited_by_id','exit_reason','exit_notes')
--   ORDER BY column_name;
--
-- Validation (expect 3 rows):
--   SELECT conname FROM pg_constraint
--   WHERE conname IN (
--     'participants_service_status_check',
--     'participants_exited_by_id_fkey',
--     'staff_registry_exited_by_id_fkey'
--   );
--
-- Existing table GRANTs are unchanged. No anon GRANT.

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS service_status text NOT NULL DEFAULT 'active';

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS exited_at timestamptz;

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS exited_by_id uuid;

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS exit_reason text;

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS exit_notes text;

UPDATE public.participants
SET service_status = 'active'
WHERE service_status IS NULL;

ALTER TABLE public.participants
  ALTER COLUMN service_status SET DEFAULT 'active';

ALTER TABLE public.participants
  ALTER COLUMN service_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'participants_service_status_check'
  ) THEN
    ALTER TABLE public.participants
      ADD CONSTRAINT participants_service_status_check
      CHECK (service_status IN ('active', 'exited'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'participants_exited_by_id_fkey'
  ) THEN
    ALTER TABLE public.participants
      ADD CONSTRAINT participants_exited_by_id_fkey
      FOREIGN KEY (exited_by_id) REFERENCES public.staff_registry(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.participants.service_status IS
  'Client service exit. active | exited. Guests stay on archived_at. History stays on this UUID.';

COMMENT ON COLUMN public.participants.exit_reason IS
  'Client codes: ended_by_participant, moved_provider, funding_ended, relocated, no_longer_suitable, deceased, other.';

CREATE INDEX IF NOT EXISTS participants_service_status_exited_idx
  ON public.participants (service_status)
  WHERE service_status = 'exited';

ALTER TABLE public.staff_registry
  ADD COLUMN IF NOT EXISTS exited_at timestamptz;

ALTER TABLE public.staff_registry
  ADD COLUMN IF NOT EXISTS exited_by_id uuid;

ALTER TABLE public.staff_registry
  ADD COLUMN IF NOT EXISTS exit_reason text;

ALTER TABLE public.staff_registry
  ADD COLUMN IF NOT EXISTS exit_notes text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_registry_exited_by_id_fkey'
  ) THEN
    ALTER TABLE public.staff_registry
      ADD CONSTRAINT staff_registry_exited_by_id_fkey
      FOREIGN KEY (exited_by_id) REFERENCES public.staff_registry(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.staff_registry.exit_reason IS
  'Staff/volunteer codes: resigned, contract_ended, role_ended, ceased_volunteering, other. active=false is the operational switch (PIN and day login).';
