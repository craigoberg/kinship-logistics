-- 2026-07-07 — Outing transport med bag decision (BL-014 / §12)
--
-- Per-booking coordinator decision: does a labelled med supply travel on the bus
-- for this outing? Separate from participant_medication_schedules (Day Centre).
-- Idempotent — safe to re-run in Supabase SQL editor.

ALTER TABLE public.event_roster_bookings
  ADD COLUMN IF NOT EXISTS transport_med_bag_required text NOT NULL DEFAULT 'not_set'
    CHECK (transport_med_bag_required IN ('yes', 'no', 'not_set')),
  ADD COLUMN IF NOT EXISTS transport_med_notes text;

COMMENT ON COLUMN public.event_roster_bookings.transport_med_bag_required IS
  'Outing only: does a med bag travel on the bus for this participant? yes | no | not_set (coordinator must set before Confirm).';
COMMENT ON COLUMN public.event_roster_bookings.transport_med_notes IS
  'Outing only: what is in the bag / what is excluded (e.g. PRN only; no daytime Panadol).';
