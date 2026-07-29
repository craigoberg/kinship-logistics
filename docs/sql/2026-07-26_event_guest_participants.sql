-- BL-098 — Event planned guests = real participants + roster bookings.
-- Guest lifecycle: participant_kind='guest', archive via archived_at.
-- Booking flags: is_guest_booking, host_participant_id, guest_ops_note.
--
-- Supabase SQL Editor may end with "Success. No rows returned" for DDL — expected.

-- ── participants ────────────────────────────────────────────────────────────
ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS participant_kind text NOT NULL DEFAULT 'client';

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS archived_at timestamptz DEFAULT NULL;

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS date_of_birth date DEFAULT NULL;

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS allergies_notes text DEFAULT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participants_participant_kind_check'
  ) THEN
    ALTER TABLE public.participants
      ADD CONSTRAINT participants_participant_kind_check
      CHECK (participant_kind IN ('client', 'guest'));
  END IF;
END $$;

COMMENT ON COLUMN public.participants.participant_kind IS
  'BL-098: client (default) or guest (planned outing guest / trial).';
COMMENT ON COLUMN public.participants.archived_at IS
  'BL-098: set when guest no longer active; reuse by clearing archived_at.';
COMMENT ON COLUMN public.participants.date_of_birth IS
  'DOB for duty-of-care; required for guest intake completeness.';
COMMENT ON COLUMN public.participants.allergies_notes IS
  'Allergies / key alerts text; "None" allowed when none known.';

CREATE INDEX IF NOT EXISTS participants_kind_archived_idx
  ON public.participants (participant_kind, archived_at);

-- ── event_roster_bookings ───────────────────────────────────────────────────
ALTER TABLE public.event_roster_bookings
  ADD COLUMN IF NOT EXISTS is_guest_booking boolean NOT NULL DEFAULT false;

ALTER TABLE public.event_roster_bookings
  ADD COLUMN IF NOT EXISTS host_participant_id uuid
    REFERENCES public.participants(id) ON DELETE SET NULL;

ALTER TABLE public.event_roster_bookings
  ADD COLUMN IF NOT EXISTS guest_ops_note text DEFAULT NULL;

COMMENT ON COLUMN public.event_roster_bookings.is_guest_booking IS
  'BL-098: true when this booking is a planned guest (non-NDIS headcount).';
COMMENT ON COLUMN public.event_roster_bookings.host_participant_id IS
  'BL-098: optional host client the guest is accompanying (not brings_carer).';
COMMENT ON COLUMN public.event_roster_bookings.guest_ops_note IS
  'BL-098: ticket / room / capacity planning note.';

CREATE INDEX IF NOT EXISTS event_roster_bookings_guest_idx
  ON public.event_roster_bookings (event_id)
  WHERE is_guest_booking = true;

-- ── Validation (expect rows) ────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'participants'
--   AND column_name IN ('participant_kind','archived_at','date_of_birth','allergies_notes');
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'event_roster_bookings'
--   AND column_name IN ('is_guest_booking','host_participant_id','guest_ops_note');
