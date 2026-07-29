-- Event Deliver roll alert thresholds + deferral max (GUARDRAILS §12.5 / BL-085) — 2026-07-18
-- Green lead-in uses *_yellow_mins_before; Yellow from deadline; Red + SMS after *_red_mins_after.
-- Recommended defaults: green lead 0, red at +30 minutes. SMS fires once per person (no repeat).
-- event_roll_max_defer_minutes: max Yellow/Red deadline push (leader/manager defer).

INSERT INTO public.system_parameters (key, value, description)
VALUES
  (
    'event_curfew_yellow_mins_before',
    '0'::jsonb,
    'Minutes before evening roll deadline for Green “approaching” banner. 0 = Green only at deadline minute, then Yellow.'
  ),
  (
    'event_curfew_red_mins_after',
    '30'::jsonb,
    'Minutes after evening roll deadline when RED escalates and SMS fires once per unaccounted participant.'
  ),
  (
    'event_morning_yellow_mins_before',
    '0'::jsonb,
    'Minutes before morning roll deadline for Green “approaching” banner. 0 = Green only at deadline minute, then Yellow.'
  ),
  (
    'event_morning_red_mins_after',
    '30'::jsonb,
    'Minutes after morning roll deadline when RED escalates and SMS fires once per unaccounted participant.'
  ),
  (
    'event_roll_max_defer_minutes',
    '120'::jsonb,
    'Maximum minutes a morning/evening roll deadline may be deferred (Yellow leader PIN or Red manager verbal). Default 120.'
  )
ON CONFLICT (key) DO UPDATE
SET
  value = EXCLUDED.value,
  description = EXCLUDED.description;

-- Validation (expect 5 rows):
-- SELECT key, value FROM system_parameters
-- WHERE key IN (
--   'event_curfew_yellow_mins_before', 'event_curfew_red_mins_after',
--   'event_morning_yellow_mins_before', 'event_morning_red_mins_after',
--   'event_roll_max_defer_minutes'
-- );
