-- ============================================================
-- 2026-07-26 — BL-073 meal prep PIN attestation
-- ============================================================
-- Cooked/packed Open meal: preparer PIN attests checklist (and SFH ack),
-- OR Manager-on-Duty guest-preparer override with justification + Manager PIN.
-- Day-session user stays logged in; preparer only step-up PINs.
-- Idempotent. Anon PIN terminals use existing table grants.
-- ============================================================

ALTER TABLE public.site_day_activities
  ADD COLUMN IF NOT EXISTS prep_attestation_mode text NULL;

ALTER TABLE public.site_day_activities
  ADD COLUMN IF NOT EXISTS prep_attested_by_staff_id uuid NULL
    REFERENCES public.staff_registry(id);

ALTER TABLE public.site_day_activities
  ADD COLUMN IF NOT EXISTS guest_preparer_name text NULL;

ALTER TABLE public.site_day_activities
  ADD COLUMN IF NOT EXISTS prep_attestation_note text NULL;

ALTER TABLE public.event_venue_stops
  ADD COLUMN IF NOT EXISTS prep_attestation_mode text NULL;

ALTER TABLE public.event_venue_stops
  ADD COLUMN IF NOT EXISTS prep_attested_by_staff_id uuid NULL
    REFERENCES public.staff_registry(id);

ALTER TABLE public.event_venue_stops
  ADD COLUMN IF NOT EXISTS guest_preparer_name text NULL;

ALTER TABLE public.event_venue_stops
  ADD COLUMN IF NOT EXISTS prep_attestation_note text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_activities_prep_attestation_mode_check'
  ) THEN
    ALTER TABLE public.site_day_activities
      ADD CONSTRAINT site_day_activities_prep_attestation_mode_check
      CHECK (
        prep_attestation_mode IS NULL
        OR prep_attestation_mode IN ('preparer_pin', 'manager_guest_override')
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_prep_attestation_mode_check'
  ) THEN
    ALTER TABLE public.event_venue_stops
      ADD CONSTRAINT event_venue_stops_prep_attestation_mode_check
      CHECK (
        prep_attestation_mode IS NULL
        OR prep_attestation_mode IN ('preparer_pin', 'manager_guest_override')
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Validation (expect rows):
--
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_name = 'site_day_activities'
--   AND column_name IN (
--     'prep_attestation_mode', 'prep_attested_by_staff_id',
--     'guest_preparer_name', 'prep_attestation_note'
--   )
-- ORDER BY column_name;
-- -- expect 4 rows
--
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_name = 'event_venue_stops'
--   AND column_name IN (
--     'prep_attestation_mode', 'prep_attested_by_staff_id',
--     'guest_preparer_name', 'prep_attestation_note'
--   )
-- ORDER BY column_name;
-- -- expect 4 rows
-- ---------------------------------------------------------------------------
