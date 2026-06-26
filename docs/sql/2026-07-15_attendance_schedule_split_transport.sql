-- 2026-07-15 — Split inbound vs. outbound transport on the recurring
-- attendance schedule so operators can roster e.g. Bus IN / Self-drive OUT.
--
-- Backfills both new columns from the existing single `transport_required`
-- field so historical schedules keep their meaning. The legacy column is
-- retained (and kept in sync from the modal write path) until every
-- downstream consumer has migrated.
--
-- Apply via Supabase SQL editor.

ALTER TABLE public.participant_attendance_schedules
  ADD COLUMN IF NOT EXISTS inbound_transport  text,
  ADD COLUMN IF NOT EXISTS outbound_transport text;

UPDATE public.participant_attendance_schedules
   SET inbound_transport  = COALESCE(inbound_transport,  transport_required),
       outbound_transport = COALESCE(outbound_transport, transport_required)
 WHERE inbound_transport IS NULL OR outbound_transport IS NULL;

COMMENT ON COLUMN public.participant_attendance_schedules.inbound_transport  IS
  'Transport vector for the morning trip TO the centre (lookup code from transport_types).';
COMMENT ON COLUMN public.participant_attendance_schedules.outbound_transport IS
  'Transport vector for the afternoon trip FROM the centre (lookup code from transport_types).';
