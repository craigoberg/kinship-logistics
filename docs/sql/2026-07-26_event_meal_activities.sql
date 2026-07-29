-- BL-073 Phase C — Trip meal activities on event_venue_stops.
-- Meals are Programme activities; transport/hop logic must ignore meal stops.
-- Idempotent.

ALTER TABLE event_venue_stops
  ADD COLUMN IF NOT EXISTS activity_kind text NOT NULL DEFAULT 'venue';

ALTER TABLE event_venue_stops
  ADD COLUMN IF NOT EXISTS meal_slot text NULL;

ALTER TABLE event_venue_stops
  ADD COLUMN IF NOT EXISTS meal_source text NULL;

ALTER TABLE event_venue_stops
  ADD COLUMN IF NOT EXISTS menu_notes text NULL;

-- Meals may omit venue (on-site / packed).
ALTER TABLE event_venue_stops
  ALTER COLUMN venue_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_activity_kind_check'
  ) THEN
    ALTER TABLE event_venue_stops
      ADD CONSTRAINT event_venue_stops_activity_kind_check
      CHECK (activity_kind IN ('venue', 'meal'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_meal_slot_check'
  ) THEN
    ALTER TABLE event_venue_stops
      ADD CONSTRAINT event_venue_stops_meal_slot_check
      CHECK (
        meal_slot IS NULL
        OR meal_slot IN ('breakfast', 'morning_tea', 'lunch', 'dinner')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_meal_source_check'
  ) THEN
    ALTER TABLE event_venue_stops
      ADD CONSTRAINT event_venue_stops_meal_source_check
      CHECK (
        meal_source IS NULL
        OR meal_source IN (
          'delivered_by_us', 'own_food', 'venue_provided', 'packed', 'purchase'
        )
      );
  END IF;
END $$;

-- Light service roll for meal activities (who was offered/served).
CREATE TABLE IF NOT EXISTS event_meal_service_rolls (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_stop_id     uuid NOT NULL REFERENCES event_venue_stops(id) ON DELETE CASCADE,
  participant_id    uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'expected'
    CHECK (status IN ('expected', 'served', 'declined', 'na')),
  notes             text NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by_id     uuid NULL REFERENCES staff_registry(id),
  UNIQUE (venue_stop_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_event_meal_service_rolls_stop
  ON event_meal_service_rolls (venue_stop_id);

ALTER TABLE event_meal_service_rolls ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'event_meal_service_rolls'
      AND policyname = 'anon_all_event_meal_service_rolls'
  ) THEN
    CREATE POLICY anon_all_event_meal_service_rolls ON event_meal_service_rolls
      FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON event_meal_service_rolls TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON event_meal_service_rolls TO authenticated;

-- Validation:
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'event_venue_stops'
--     AND column_name IN ('activity_kind','meal_slot','meal_source','menu_notes');
-- SELECT to_regclass('public.event_meal_service_rolls');
