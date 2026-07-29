-- ============================================================
-- 2026-07-26 — BL-073 live meal open + preparer / SFH fields
-- ============================================================
-- Adds preparer attribution on Centre + Trip meals, widens meal
-- service roll outcomes, and adds Day Centre meal serve rolls.
-- Idempotent. Anon grants for PIN terminals.
-- ============================================================

-- ── 1) site_day_activities preparer columns ─────────────────────────────────
ALTER TABLE public.site_day_activities
  ADD COLUMN IF NOT EXISTS prepared_by_staff_id uuid NULL
    REFERENCES public.staff_registry(id);

ALTER TABLE public.site_day_activities
  ADD COLUMN IF NOT EXISTS preparer_cert_status text NULL;

ALTER TABLE public.site_day_activities
  ADD COLUMN IF NOT EXISTS preparer_ack_note text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_activities_preparer_cert_status_check'
  ) THEN
    ALTER TABLE public.site_day_activities
      ADD CONSTRAINT site_day_activities_preparer_cert_status_check
      CHECK (
        preparer_cert_status IS NULL
        OR preparer_cert_status IN ('ok', 'warn_missing', 'warn_expired', 'na')
      );
  END IF;
END $$;

-- ── 2) event_venue_stops preparer columns ───────────────────────────────────
ALTER TABLE public.event_venue_stops
  ADD COLUMN IF NOT EXISTS prepared_by_staff_id uuid NULL
    REFERENCES public.staff_registry(id);

ALTER TABLE public.event_venue_stops
  ADD COLUMN IF NOT EXISTS preparer_cert_status text NULL;

ALTER TABLE public.event_venue_stops
  ADD COLUMN IF NOT EXISTS preparer_ack_note text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_preparer_cert_status_check'
  ) THEN
    ALTER TABLE public.event_venue_stops
      ADD CONSTRAINT event_venue_stops_preparer_cert_status_check
      CHECK (
        preparer_cert_status IS NULL
        OR preparer_cert_status IN ('ok', 'warn_missing', 'warn_expired', 'na')
      );
  END IF;
END $$;

-- ── 3) Widen event_meal_service_rolls status ────────────────────────────────
ALTER TABLE public.event_meal_service_rolls
  DROP CONSTRAINT IF EXISTS event_meal_service_rolls_status_check;

ALTER TABLE public.event_meal_service_rolls
  ADD CONSTRAINT event_meal_service_rolls_status_check
  CHECK (status IN (
    'expected', 'served', 'modified', 'own_order', 'declined', 'na'
  ));

-- ── 4) Day Centre meal serve rolls ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.site_day_meal_service_rolls (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id       uuid NOT NULL REFERENCES public.site_day_activities(id) ON DELETE CASCADE,
  participant_id    uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'expected'
    CHECK (status IN (
      'expected', 'served', 'modified', 'own_order', 'declined', 'na'
    )),
  notes             text NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by_id     uuid NULL REFERENCES public.staff_registry(id),
  UNIQUE (activity_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_site_day_meal_service_rolls_activity
  ON public.site_day_meal_service_rolls (activity_id);

ALTER TABLE public.site_day_meal_service_rolls ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'site_day_meal_service_rolls'
      AND policyname = 'anon_all_site_day_meal_service_rolls'
  ) THEN
    CREATE POLICY anon_all_site_day_meal_service_rolls
      ON public.site_day_meal_service_rolls
      FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_day_meal_service_rolls TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_day_meal_service_rolls TO authenticated;

-- ── Validation (expect rows) ────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'site_day_activities'
--     AND column_name IN ('prepared_by_staff_id','preparer_cert_status','preparer_ack_note');
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'event_venue_stops'
--     AND column_name IN ('prepared_by_staff_id','preparer_cert_status','preparer_ack_note');
-- SELECT to_regclass('public.site_day_meal_service_rolls');
-- SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conname = 'event_meal_service_rolls_status_check';
