-- ============================================================
-- 2026-07-26 — BL-073 meal prep checklist (cooked / packed)
-- ============================================================
-- Admin-editable checks at Open meal when we prepare food.
-- Fridge temp stays on Open Centre (not duplicated here).
-- Empty array after Manager edit = high-trust (no ticks).
-- Seed defaults on first insert only (ON CONFLICT keeps edits).
-- Idempotent. Anon PIN terminals use existing table grants.
-- ============================================================

-- ── 1) system_parameters seed ────────────────────────────────────────────────
INSERT INTO public.system_parameters (key, value, description)
VALUES
  (
    'meal.prep_checks',
    '[
      "Hands washed / gloves as required",
      "Prep surface & utensils clean before use",
      "Allergies / IDDSI checked against people on site",
      "Separate boards/utensils for allergens / raw vs ready-to-eat (if applicable)",
      "Food from approved source / in date / stored correctly before prep",
      "Ready-to-eat food protected from contamination until serve",
      "Leftovers / waste handled safely (or N/A)"
    ]'::jsonb,
    'Meal prep walkthrough at Open meal for cooked/packed sources (string array). Empty = high-trust. Edit in Admin → System Parameters → Mandated walkthrough checklists. BL-073. Fridge temp stays on Open Centre.'
  )
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description;

-- ── 2) Persist completed labels on Centre + Trip meals ───────────────────────
ALTER TABLE public.site_day_activities
  ADD COLUMN IF NOT EXISTS prep_checks_completed jsonb NULL;

ALTER TABLE public.event_venue_stops
  ADD COLUMN IF NOT EXISTS prep_checks_completed jsonb NULL;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Validation (expect rows):
--
-- SELECT key, jsonb_array_length(value) AS n, description
-- FROM public.system_parameters
-- WHERE key = 'meal.prep_checks';
-- -- expect 1 row; n = 7 on first seed (or Manager-edited count)
--
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_name = 'site_day_activities'
--   AND column_name = 'prep_checks_completed';
--
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_name = 'event_venue_stops'
--   AND column_name = 'prep_checks_completed';
-- ---------------------------------------------------------------------------
