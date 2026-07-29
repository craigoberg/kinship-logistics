-- 2026-07-23 — Event Deliver venue open walkthrough checks (BL-070)
--
-- Run in Supabase Dashboard → SQL Editor → Run All
--
-- Key: event_deliver.venue_open_checks
-- Value shape: JSON string array, e.g.
--   ["Exits clear","First aid visible","Hazards noted / OK"]
-- Empty array [] = high-trust 1-tap open (no ticks required) until Admin fills.
-- Edit via Admin → System Parameters → Mandated walkthrough checklists
-- (list UI, not JSON). ON CONFLICT preserves Manager-edited values; only
-- description is refreshed on re-run.

INSERT INTO public.system_parameters (key, value, description)
VALUES
  (
    'event_deliver.venue_open_checks',
    '[]'::jsonb,
    'Event Deliver Open location venue walkthrough checks (string array). Empty = high-trust open. Edit in Admin → System Parameters → Mandated walkthrough checklists. BL-070.'
  )
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Validation (expect 1 row; value may be [] or Manager-edited array):
--
-- SELECT key, value, description
-- FROM public.system_parameters
-- WHERE key = 'event_deliver.venue_open_checks';
-- ---------------------------------------------------------------------------
