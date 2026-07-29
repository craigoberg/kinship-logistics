-- 2026-07-23 — Point mandated-check param descriptions at Admin list UI
--
-- Run in Supabase Dashboard → SQL Editor → Run All
-- Does not change values — only description text (and ensures keys exist).
--
-- Edit UI: Admin → System Parameters → Mandated walkthrough checklists
-- (Venue Safety Template style). Not the raw JSON table.

INSERT INTO public.system_parameters (key, value, description)
VALUES
  (
    'site_management.mandated_compliance_checks',
    '[]'::jsonb,
    'Day Centre Start of Day mandated visual checks (string array). Empty = high-trust open. Edit in Admin → System Parameters → Mandated walkthrough checklists.'
  ),
  (
    'site_management.mandated_close_checks',
    '[]'::jsonb,
    'Day Centre Close mandated visual checks (string array). Empty = high-trust close. Edit in Admin → System Parameters → Mandated walkthrough checklists.'
  ),
  (
    'event_deliver.venue_open_checks',
    '[]'::jsonb,
    'Event Deliver Open location venue walkthrough checks (string array). Empty = high-trust open. Edit in Admin → System Parameters → Mandated walkthrough checklists. BL-070.'
  )
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Validation (expect 3 rows):
--
-- SELECT key, value, description
-- FROM public.system_parameters
-- WHERE key IN (
--   'site_management.mandated_compliance_checks',
--   'site_management.mandated_close_checks',
--   'event_deliver.venue_open_checks'
-- )
-- ORDER BY key;
-- ---------------------------------------------------------------------------
