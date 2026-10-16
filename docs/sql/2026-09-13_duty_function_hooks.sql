-- =============================================================================
-- 2026-09-13 — Duty function hooks (BL-126 follow-on)
-- =============================================================================
--
-- Extra function_key values so office can bind Duty roles to helper check-in,
-- centre open/close, event open/close, and med witness. No seed bindings —
-- empty bind = floor fall-through (allow).
--
-- Run on DEV then TEST after 2026-09-12_duty_roles_requirements.sql.
-- SQL Editor "Success. No rows returned" is expected for the ALTER body.
-- =============================================================================

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
    'med_witness'
  ));

COMMENT ON TABLE public.duty_bindings IS
  'BL-126: which Duty role is required to do a function or drive an asset/category. Unbound function = fall through.';

-- =============================================================================
-- Validation (run after this script — expect 1 row listing the new keys)
-- =============================================================================
-- SELECT pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'public.duty_bindings'::regclass
--     AND conname = 'duty_bindings_function_key_check';
--   expect function_key IN (… floor_on_duty, event_venue_open, event_day_close, med_witness …)
-- =============================================================================
