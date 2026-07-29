-- BL-090 follow-on: activity "Not at activity" skip reason text on event_activity_rolls.
-- Idempotent. Anon PIN terminals need read/write (existing grants cover UPDATE).

ALTER TABLE event_activity_rolls
  ADD COLUMN IF NOT EXISTS notes text;

-- Validation (expect notes column):
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'event_activity_rolls' AND column_name = 'notes';
