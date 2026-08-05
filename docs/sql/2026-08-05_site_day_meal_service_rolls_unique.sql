-- =============================================================================
-- 2026-08-05 — site_day_meal_service_rolls UNIQUE + defaults (TEST bootstrap)
-- =============================================================================
--
-- Symptom: Day Centre meal open saves attestation/source, then errors; serve
--   roll stays empty ("No checked-in clients" / no names).
--
-- Cause: TEST bootstrap CREATE TABLE IF NOT EXISTS built:
--   site_day_meal_service_rolls without UNIQUE(activity_id, participant_id),
--   without DEFAULT 'expected', and without FKs. App seed uses
--   upsert onConflict activity_id,participant_id → PostgREST 42P10.
--   Activity UPDATE already committed → "saved but errors".
--
-- Idempotent. Run on TEST (and DEV for parity).
-- =============================================================================

-- Orphans would block FK add
DELETE FROM public.site_day_meal_service_rolls r
WHERE NOT EXISTS (
        SELECT 1 FROM public.site_day_activities a WHERE a.id = r.activity_id
      )
   OR NOT EXISTS (
        SELECT 1 FROM public.participants p WHERE p.id = r.participant_id
      );

-- Keep one row per (activity, participant) before UNIQUE
DELETE FROM public.site_day_meal_service_rolls a
USING public.site_day_meal_service_rolls b
WHERE a.activity_id = b.activity_id
  AND a.participant_id = b.participant_id
  AND a.ctid < b.ctid;

ALTER TABLE public.site_day_meal_service_rolls
  ALTER COLUMN status SET DEFAULT 'expected';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_meal_service_rolls_status_check'
  ) THEN
    ALTER TABLE public.site_day_meal_service_rolls
      ADD CONSTRAINT site_day_meal_service_rolls_status_check
      CHECK (status IN (
        'expected', 'served', 'modified', 'own_order', 'declined', 'na'
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_meal_service_rolls_activity_participant_key'
  ) THEN
    ALTER TABLE public.site_day_meal_service_rolls
      ADD CONSTRAINT site_day_meal_service_rolls_activity_participant_key
      UNIQUE (activity_id, participant_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_meal_service_rolls_activity_id_fkey'
  ) THEN
    ALTER TABLE public.site_day_meal_service_rolls
      ADD CONSTRAINT site_day_meal_service_rolls_activity_id_fkey
      FOREIGN KEY (activity_id)
      REFERENCES public.site_day_activities(id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_meal_service_rolls_participant_id_fkey'
  ) THEN
    ALTER TABLE public.site_day_meal_service_rolls
      ADD CONSTRAINT site_day_meal_service_rolls_participant_id_fkey
      FOREIGN KEY (participant_id)
      REFERENCES public.participants(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_site_day_meal_service_rolls_activity
  ON public.site_day_meal_service_rolls (activity_id);

ALTER TABLE public.site_day_meal_service_rolls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_all_site_day_meal_service_rolls
  ON public.site_day_meal_service_rolls;
DROP POLICY IF EXISTS kinship_anon_all_site_day_meal_service_rolls
  ON public.site_day_meal_service_rolls;

CREATE POLICY kinship_anon_all_site_day_meal_service_rolls
  ON public.site_day_meal_service_rolls
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_day_meal_service_rolls
  TO anon, authenticated;

-- Validation (expect 1 row for UNIQUE + status check):
-- SELECT conname, contype
-- FROM pg_constraint
-- WHERE conrelid = 'public.site_day_meal_service_rolls'::regclass
--   AND conname IN (
--     'site_day_meal_service_rolls_activity_participant_key',
--     'site_day_meal_service_rolls_status_check',
--     'site_day_meal_service_rolls_activity_id_fkey',
--     'site_day_meal_service_rolls_participant_id_fkey'
--   );
--
-- Expect DEFAULT 'expected':
-- SELECT column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'site_day_meal_service_rolls'
--   AND column_name = 'status';
