-- =============================================================================
-- 2026-10-04 — Day Centre Floor Leader (BL-131)
-- =============================================================================
--
-- One person leads the floor for the open day. The app sets them when the
-- centre opens, and again when the floor is handed over.
--
-- "Success. No rows returned" is expected.
--
-- Validation — expect 2 column rows, and a check that includes floor_leader:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'site_day_sessions'
--      AND column_name IN ('floor_leader_staff_id', 'floor_leader_since');
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.duty_bindings'::regclass
--      AND conname = 'duty_bindings_function_key_check';
-- =============================================================================

ALTER TABLE public.site_day_sessions
  ADD COLUMN IF NOT EXISTS floor_leader_staff_id uuid REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS floor_leader_since timestamptz;

DO $$
DECLARE
  cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  WHERE con.conrelid = 'public.duty_bindings'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%function_key%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.duty_bindings DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE public.duty_bindings
  ADD CONSTRAINT duty_bindings_function_key_check
  CHECK (function_key IN (
    'meal_prep',
    'fleet_drive',
    'centre_open',
    'centre_close',
    'med_admin',
    'floor_on_duty',
    'event_venue_open',
    'event_day_close',
    'med_witness',
    'floor_leader'
  ));

NOTIFY pgrst, 'reload schema';
