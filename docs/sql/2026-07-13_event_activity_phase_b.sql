-- ============================================================
-- BL-068 Phase B — Event Deliver Activity Loop
-- 2026-07-13
-- ============================================================
-- Adds activity state tracking to event_venue_stops and creates
-- event_activity_rolls for per-person activity check-in.
--
-- Idempotent: safe to run multiple times.
-- ============================================================

-- ── 1. Extend event_venue_stops with activity state ──────────────────────────

ALTER TABLE event_venue_stops
  ADD COLUMN IF NOT EXISTS phase             text        NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS movement_method   text        NOT NULL DEFAULT 'bus',
  ADD COLUMN IF NOT EXISTS opened_at         timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at         timestamptz,
  ADD COLUMN IF NOT EXISTS opened_by_id      uuid        REFERENCES staff_registry(id);

-- Constrain allowed values (idempotent via DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_phase_check'
  ) THEN
    ALTER TABLE event_venue_stops
      ADD CONSTRAINT event_venue_stops_phase_check
      CHECK (phase IN ('pending', 'active', 'completed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_movement_method_check'
  ) THEN
    ALTER TABLE event_venue_stops
      ADD CONSTRAINT event_venue_stops_movement_method_check
      CHECK (movement_method IN ('bus', 'walk', 'on_site'));
  END IF;
END;
$$;

-- ── 2. Create event_activity_rolls ───────────────────────────────────────────
-- Per-person check-in record for each venue stop (walk/on-site activities).
-- Bus hops are tracked via §11 Manifest; this table is for non-bus activities.

CREATE TABLE IF NOT EXISTS event_activity_rolls (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_stop_id         uuid        NOT NULL REFERENCES event_venue_stops(id) ON DELETE CASCADE,
  event_day_session_id  uuid        NOT NULL REFERENCES event_day_sessions(id) ON DELETE CASCADE,
  participant_id        uuid        NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  -- Status: expected → checked_in or absent
  status                text        NOT NULL DEFAULT 'expected',
  checked_in_at         timestamptz,
  checked_in_by_id      uuid        REFERENCES staff_registry(id),
  marked_absent_at      timestamptz,
  marked_absent_by_id   uuid        REFERENCES staff_registry(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_activity_rolls_status_check
    CHECK (status IN ('expected', 'checked_in', 'absent')),
  CONSTRAINT event_activity_rolls_unique_person_per_stop
    UNIQUE (venue_stop_id, participant_id)
);

-- ── 3. RLS on event_activity_rolls ───────────────────────────────────────────
ALTER TABLE event_activity_rolls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_event_activity_rolls"   ON event_activity_rolls;
DROP POLICY IF EXISTS "anon_insert_event_activity_rolls" ON event_activity_rolls;
DROP POLICY IF EXISTS "anon_update_event_activity_rolls" ON event_activity_rolls;

CREATE POLICY "anon_read_event_activity_rolls"
  ON event_activity_rolls FOR SELECT TO anon USING (true);

CREATE POLICY "anon_insert_event_activity_rolls"
  ON event_activity_rolls FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon_update_event_activity_rolls"
  ON event_activity_rolls FOR UPDATE TO anon USING (true);

-- ── 4. Grants ─────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON event_activity_rolls TO anon;

-- anon needs UPDATE on event_venue_stops to set phase/opened_at/closed_at
-- (SELECT + INSERT already exist from setup — this is safe to repeat)
GRANT SELECT, INSERT, UPDATE ON event_venue_stops TO anon;

-- ── 5. Validation queries (run these after migration to confirm success) ──────
-- Expect: 5 rows listing the new columns
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'event_venue_stops'
  AND column_name IN ('phase','movement_method','opened_at','closed_at','opened_by_id')
ORDER BY column_name;
-- Expected result: 5 rows — closed_at, movement_method, opened_at, opened_by_id, phase

-- Expect: table exists
SELECT COUNT(*) AS activity_roll_rows FROM event_activity_rolls;
-- Expected result: 0 (or N if any test rows exist) — table exists = success

-- Expect: 3 policies listed
SELECT policyname FROM pg_policies
WHERE tablename = 'event_activity_rolls'
ORDER BY policyname;
-- Expected result: anon_insert_event_activity_rolls, anon_read_event_activity_rolls, anon_update_event_activity_rolls
