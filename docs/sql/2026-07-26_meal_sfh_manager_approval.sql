-- ============================================================
-- 2026-07-26 — BL-073 SFH Manager approval + close BL-073 slice
-- ============================================================
-- Missing/expired Safe Food Handling on staff preparer requires
-- Manager / Coordinator PIN approval (not preparer soft-ack alone).
-- Idempotent.
-- ============================================================

ALTER TABLE public.site_day_activities
  ADD COLUMN IF NOT EXISTS sfh_approved_by_staff_id uuid NULL
    REFERENCES public.staff_registry(id);

ALTER TABLE public.event_venue_stops
  ADD COLUMN IF NOT EXISTS sfh_approved_by_staff_id uuid NULL
    REFERENCES public.staff_registry(id);

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Validation (expect 2 rows):
--
-- SELECT table_name, column_name
-- FROM information_schema.columns
-- WHERE column_name = 'sfh_approved_by_staff_id'
--   AND table_name IN ('site_day_activities', 'event_venue_stops')
-- ORDER BY table_name;
-- ---------------------------------------------------------------------------
