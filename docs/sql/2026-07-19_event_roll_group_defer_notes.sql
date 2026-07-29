-- Event Deliver — group roll defer notes on trip day (banner-only, Option A)
-- 2026-07-19
--
-- Stores the latest *group* Yellow/Red defer reason for morning / evening rolls.
-- Individual defer notes stay on event_morning_log / event_curfew_log.notes.
--
-- "Success. No rows returned" is normal for this DDL script.

ALTER TABLE public.event_day_sessions
  ADD COLUMN IF NOT EXISTS morning_group_defer_note text,
  ADD COLUMN IF NOT EXISTS evening_group_defer_note text;

COMMENT ON COLUMN public.event_day_sessions.morning_group_defer_note IS
  'Latest group Morning Roll defer summary for Event Deliver banner (e.g. Group Deferred +30m — reason). Not per-person.';

COMMENT ON COLUMN public.event_day_sessions.evening_group_defer_note IS
  'Latest group Evening Roll defer summary for Event Deliver banner (e.g. Group Deferred +30m — reason). Not per-person.';

GRANT SELECT, UPDATE ON public.event_day_sessions TO anon, authenticated;

-- ── Validation (expect 2 rows) ───────────────────────────────────────────────
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'event_day_sessions'
--   AND column_name IN ('morning_group_defer_note', 'evening_group_defer_note')
-- ORDER BY column_name;
