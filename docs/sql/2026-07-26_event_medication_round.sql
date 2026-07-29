-- ============================================================
-- 2026-07-26 — BL-077 Trip Programme medication round
-- ============================================================
-- activity_kind = medication_round on event_venue_stops (like Day Centre Meds row).
-- Alternate med delivery plan when someone is covered elsewhere (hospital / other carer).
-- Idempotent. Anon grants for PIN terminals.
-- ============================================================

-- ── 1) Widen activity_kind check ────────────────────────────────────────────
ALTER TABLE public.event_venue_stops
  DROP CONSTRAINT IF EXISTS event_venue_stops_activity_kind_check;

ALTER TABLE public.event_venue_stops
  ADD CONSTRAINT event_venue_stops_activity_kind_check
  CHECK (activity_kind IN ('venue', 'meal', 'medication_round'));

-- ── 2) Alternate med plan (PIN-signed left-behind cover) ────────────────────
CREATE TABLE IF NOT EXISTS public.event_day_med_alternate_plans (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_day_session_id   uuid NOT NULL REFERENCES public.event_day_sessions(id) ON DELETE CASCADE,
  participant_id         uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  plan_note              text NOT NULL,
  attested_by_staff_id   uuid NOT NULL REFERENCES public.staff_registry(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_day_session_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_event_day_med_alternate_plans_session
  ON public.event_day_med_alternate_plans (event_day_session_id);

ALTER TABLE public.event_day_med_alternate_plans ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'event_day_med_alternate_plans'
      AND policyname = 'anon_all_event_day_med_alternate_plans'
  ) THEN
    CREATE POLICY anon_all_event_day_med_alternate_plans
      ON public.event_day_med_alternate_plans
      FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_day_med_alternate_plans TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_day_med_alternate_plans TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Validation (expect rows):
--
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conname = 'event_venue_stops_activity_kind_check';
-- -- should list venue, meal, medication_round
--
-- SELECT to_regclass('public.event_day_med_alternate_plans');
-- ---------------------------------------------------------------------------
