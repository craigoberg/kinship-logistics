-- =============================================================================
-- 2026-08-05 — centre_operating_hours: PK + anon write (PIN / Alpha)
-- =============================================================================
--
-- Symptoms:
--   • Admin → Centre hours Save fails (PostgREST upsert / RLS)
--   • PIN / anon sessions can read hours but not update
--
-- Cause (TEST bootstrap):
--   • Table created without PRIMARY KEY on day_of_week
--   • 2026-07-12 migration used CREATE TABLE IF NOT EXISTS → PK never applied
--   • Original grants: anon SELECT only; writes authenticated-only
--
-- Idempotent. Run on TEST (and DEV for parity).
-- "Success. No rows returned" is normal for DDL.
-- =============================================================================

-- 1) Deduplicate if bootstrap inserted multiples without a key
DELETE FROM public.centre_operating_hours a
 USING public.centre_operating_hours b
 WHERE a.ctid < b.ctid
   AND a.day_of_week = b.day_of_week;

-- 2) Primary key on day_of_week (required for upsert onConflict)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.centre_operating_hours'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE public.centre_operating_hours
      ADD CONSTRAINT centre_operating_hours_pkey PRIMARY KEY (day_of_week);
  END IF;
END $$;

-- 3) Seed Mon–Sun if missing
INSERT INTO public.centre_operating_hours (day_of_week, open_time, close_time)
VALUES
  ('DAY-MON', '09:00', '15:00'),
  ('DAY-TUE', '09:00', '15:00'),
  ('DAY-WED', '09:00', '15:00'),
  ('DAY-THU', '09:00', '15:00'),
  ('DAY-FRI', '09:00', '15:00'),
  ('DAY-SAT', '09:00', '15:00'),
  ('DAY-SUN', '09:00', '15:00')
ON CONFLICT (day_of_week) DO NOTHING;

-- 4) Anon + authenticated write (PIN terminal uses publishable/anon key)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.centre_operating_hours
  TO anon, authenticated, service_role;

ALTER TABLE public.centre_operating_hours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "centre_operating_hours readable" ON public.centre_operating_hours;
DROP POLICY IF EXISTS "centre_operating_hours writable" ON public.centre_operating_hours;
DROP POLICY IF EXISTS "centre_operating_hours updatable" ON public.centre_operating_hours;
DROP POLICY IF EXISTS kinship_anon_all_centre_operating_hours ON public.centre_operating_hours;

CREATE POLICY kinship_anon_all_centre_operating_hours
  ON public.centre_operating_hours
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

-- Validation (expect 7 rows + PK + policy):
-- SELECT day_of_week, open_time::text, close_time::text
-- FROM public.centre_operating_hours ORDER BY day_of_week;
--
-- SELECT conname FROM pg_constraint
-- WHERE conrelid = 'public.centre_operating_hours'::regclass AND contype = 'p';
--
-- SELECT polname FROM pg_policy
-- WHERE polrelid = 'public.centre_operating_hours'::regclass;
