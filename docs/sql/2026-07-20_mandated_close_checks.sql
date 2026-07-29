-- 2026-07-20 — Day Centre mandated close checks (Admin-editable)
--
-- Run in Supabase Dashboard → SQL Editor → Run All
--
-- Open:  site_management.mandated_compliance_checks  (Start of Day ticks)
-- Close: site_management.mandated_close_checks       (Closure dialog ticks)
--
-- Value shape: JSON string array, e.g.
--   ["All lights off","Alarm armed","Medication fridge locked"]
-- Empty array [] = high-trust 1-tap (no ticks required).
-- Edit via Admin → System Parameters → Mandated walkthrough checklists
-- (list UI, not JSON). ON CONFLICT preserves Manager-edited values; only
-- description is refreshed on re-run.

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
  )
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Validation (expect 2 rows; value may be [] or Manager-edited arrays):
--
-- SELECT key, value, description
-- FROM public.system_parameters
-- WHERE key IN (
--   'site_management.mandated_close_checks',
--   'site_management.mandated_compliance_checks'
-- )
-- ORDER BY key;
-- ---------------------------------------------------------------------------
