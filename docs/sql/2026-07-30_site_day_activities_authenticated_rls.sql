-- 2026-07-30 — site_day_activities RLS for day-login (authenticated)
--
-- Run in Supabase Dashboard → SQL Editor → Run All (DEV first).
--
-- Symptom: Activities tab — "new row violates row-level security policy
-- for table site_day_activities" / POST 403 while seeding template meals.
--
-- Cause: original policy was TO anon only. BL-099 day login uses JWT role
-- `authenticated`, so INSERT/UPDATE fail RLS even though GRANT exists.
-- Anon PIN-only sessions were unaffected.
--
-- Idempotent.

DROP POLICY IF EXISTS anon_all_site_day_activities ON public.site_day_activities;
DROP POLICY IF EXISTS kinship_anon_all_site_day_activities ON public.site_day_activities;

CREATE POLICY kinship_anon_all_site_day_activities
  ON public.site_day_activities
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_day_activities TO anon, authenticated;

-- Same pattern on meal service rolls (seeded when a meal is opened).
DROP POLICY IF EXISTS anon_all_site_day_meal_service_rolls
  ON public.site_day_meal_service_rolls;
DROP POLICY IF EXISTS kinship_anon_all_site_day_meal_service_rolls
  ON public.site_day_meal_service_rolls;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'site_day_meal_service_rolls'
  ) THEN
    EXECUTE $p$
      CREATE POLICY kinship_anon_all_site_day_meal_service_rolls
        ON public.site_day_meal_service_rolls
        FOR ALL
        TO anon, authenticated
        USING (true)
        WITH CHECK (true)
    $p$;
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_day_meal_service_rolls TO anon, authenticated';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Validation (expect 1+ rows with roles including authenticated)
-- ---------------------------------------------------------------------------
-- SELECT polname, polroles::regrole[]
-- FROM pg_policy
-- WHERE polrelid = 'public.site_day_activities'::regclass;
--
-- Or from SQL Editor as postgres — confirm insert path works from app after
-- hard refresh (Activities should seed morning tea / lunch / med round).
