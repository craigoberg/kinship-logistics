-- 2026-07-07 — Coordinator-defined manifest pickup sequence (§11 / §12)
--
-- Seeds outbound leg order at trip start until driver reorders in-manifest.
-- Idempotent — safe to re-run in Supabase SQL editor.

ALTER TABLE public.event_roster_bookings
  ADD COLUMN IF NOT EXISTS pickup_order integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.event_roster_bookings.pickup_order IS
  'Coordinator drag-order on event roster; lower = earlier pickup. Manifest seeds legs in this order.';

CREATE INDEX IF NOT EXISTS event_roster_bookings_event_pickup_order_idx
  ON public.event_roster_bookings (event_id, pickup_order);

-- Backfill existing rows by created_at within each event.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY created_at ASC) * 10 AS rn
  FROM public.event_roster_bookings
  WHERE pickup_order = 0
)
UPDATE public.event_roster_bookings b
   SET pickup_order = ranked.rn
  FROM ranked
 WHERE b.id = ranked.id;
