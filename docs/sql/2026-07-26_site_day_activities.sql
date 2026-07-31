-- BL-100 / BL-073 Phase D — Day Centre Activities (meals + later med rounds).
-- Idempotent. Anon grants for PIN terminals.

CREATE TABLE IF NOT EXISTS site_day_activities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES site_day_sessions(id) ON DELETE CASCADE,
  activity_kind   text NOT NULL DEFAULT 'meal'
    CHECK (activity_kind IN ('meal', 'medication_round', 'other')),
  meal_slot       text NULL
    CHECK (meal_slot IS NULL OR meal_slot IN (
      'breakfast', 'morning_tea', 'lunch', 'dinner'
    )),
  title           text NOT NULL,
  meal_source     text NULL
    CHECK (meal_source IS NULL OR meal_source IN (
      'delivered_by_us', 'own_food', 'venue_provided', 'packed', 'purchase'
    )),
  menu_notes      text NULL,
  phase           text NOT NULL DEFAULT 'pending'
    CHECK (phase IN ('pending', 'active', 'completed')),
  sort_order      int NOT NULL DEFAULT 0,
  opened_at       timestamptz NULL,
  opened_by_id    uuid NULL REFERENCES staff_registry(id),
  closed_at       timestamptz NULL,
  closed_by_id    uuid NULL REFERENCES staff_registry(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_day_activities_session
  ON site_day_activities (session_id, sort_order);

ALTER TABLE site_day_activities ENABLE ROW LEVEL SECURITY;

-- PIN terminal = anon; day login (BL-099) = authenticated. Both need ALL.
DROP POLICY IF EXISTS anon_all_site_day_activities ON site_day_activities;
DROP POLICY IF EXISTS kinship_anon_all_site_day_activities ON site_day_activities;
CREATE POLICY kinship_anon_all_site_day_activities ON site_day_activities
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON site_day_activities TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON site_day_activities TO authenticated;

-- Seed template keys (JSON array of { meal_slot, title, meal_source }).
INSERT INTO system_parameters (key, value, description)
VALUES (
  'site_day.activity_template',
  '[
    {"meal_slot":"morning_tea","title":"Morning tea","meal_source":"delivered_by_us"},
    {"meal_slot":"lunch","title":"Lunch","meal_source":"delivered_by_us"}
  ]'::jsonb,
  'Day Centre Activities template seeded on Open Centre (BL-073/BL-100).'
)
ON CONFLICT (key) DO NOTHING;

-- Validation (expect rows):
-- SELECT key FROM system_parameters WHERE key = 'site_day.activity_template';
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'site_day_activities' ORDER BY ordinal_position;
