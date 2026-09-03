-- =============================================================================
-- 2026-09-03 — event_bus_manifest: staff/volunteer is a valid rider (§11.10)
-- =============================================================================
--
-- Hop / IN / HOME boarding rows may name staff_id with no participant_id.
-- The original CHECK required participant_id OR carer_id, which rejected
-- staff-only seats.
--
-- Idempotent. SQL Editor "Success. No rows returned" is expected for DDL.
-- =============================================================================

ALTER TABLE public.event_bus_manifest
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staff_registry(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.event_bus_manifest.staff_id IS
  'Staff/volunteer seat on this hop / IN / HOME run. Boarding is not clients-only.';

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.event_bus_manifest'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%participant_id%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%staff_id%'
  LOOP
    EXECUTE format('ALTER TABLE public.event_bus_manifest DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.event_bus_manifest'::regclass
      AND conname = 'event_bus_manifest_check'
  ) THEN
    ALTER TABLE public.event_bus_manifest
      ADD CONSTRAINT event_bus_manifest_check
      CHECK (
        participant_id IS NOT NULL
        OR carer_id IS NOT NULL
        OR staff_id IS NOT NULL
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS event_bus_manifest_trip_staff_uidx
  ON public.event_bus_manifest (transport_trip_id, staff_id)
  WHERE staff_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Validation (DDL-only run returns no rows — that is expected):
--
-- Expect CHECK to mention staff_id (1 row):
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'public.event_bus_manifest'::regclass
--     AND conname = 'event_bus_manifest_check';
--
-- Expect unique staff index (1 row):
--   SELECT indexname FROM pg_indexes
--   WHERE schemaname = 'public'
--     AND tablename = 'event_bus_manifest'
--     AND indexname = 'event_bus_manifest_trip_staff_uidx';
--
-- Expect staff_id column (1 row):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name = 'event_bus_manifest'
--     AND column_name = 'staff_id';
-- =============================================================================
