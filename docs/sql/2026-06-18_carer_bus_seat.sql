-- 2026-06-18 — Carer linkage + bus seat tracking
-- Apply via the Lovable Cloud SQL runner. Idempotent.

-- 1. carers_registry already has relationship/address/is_primary_contact.
--    Guarantee defaults and a partial unique index so only one carer per
--    participant can be flagged as the primary emergency contact.
ALTER TABLE public.carers_registry
  ALTER COLUMN is_primary_contact SET DEFAULT false;

UPDATE public.carers_registry
  SET is_primary_contact = false
  WHERE is_primary_contact IS NULL;

ALTER TABLE public.carers_registry
  ALTER COLUMN is_primary_contact SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS carers_registry_one_primary_per_participant
  ON public.carers_registry (participant_id)
  WHERE is_primary_contact = true AND participant_id IS NOT NULL;

-- 2. event_roster_bookings — carer companion + bus seat tracking
ALTER TABLE public.event_roster_bookings
  ADD COLUMN IF NOT EXISTS brings_carer boolean NOT NULL DEFAULT false;

ALTER TABLE public.event_roster_bookings
  ADD COLUMN IF NOT EXISTS carer_id uuid
    REFERENCES public.carers_registry(id) ON DELETE SET NULL;

ALTER TABLE public.event_roster_bookings
  ADD COLUMN IF NOT EXISTS carer_transport_required boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS event_roster_bookings_carer_id_idx
  ON public.event_roster_bookings (carer_id);

-- Grants follow existing pattern (authenticated full CRUD, service_role all).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carers_registry TO authenticated;
GRANT ALL ON public.carers_registry TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_roster_bookings TO authenticated;
GRANT ALL ON public.event_roster_bookings TO service_role;
