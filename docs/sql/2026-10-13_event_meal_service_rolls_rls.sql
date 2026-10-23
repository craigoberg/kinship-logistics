-- 2026-10-13 — event_meal_service_rolls RLS for the signed-in day session
--
-- Symptom: Open meal (Morning Tea) toasts
--   new row violates row-level security policy for table "event_meal_service_rolls"
--   and the console shows POST 403.
-- Cause: the only policy is FOR ALL TO anon. The floor session is authenticated.
--         GRANT exists, RLS still rejects the insert.
--
-- Idempotent. "Success. No rows returned" is expected.
--
-- Validation (expect 1 row, roles {authenticated}, cmd ALL):
--   SELECT policyname, roles::text, cmd
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename = 'event_meal_service_rolls'
--   ORDER BY policyname;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_meal_service_rolls TO authenticated, service_role;
REVOKE ALL ON TABLE public.event_meal_service_rolls FROM anon;

DROP POLICY IF EXISTS "anon_all_event_meal_service_rolls" ON public.event_meal_service_rolls;
DROP POLICY IF EXISTS anon_all_event_meal_service_rolls ON public.event_meal_service_rolls;
DROP POLICY IF EXISTS event_meal_service_rolls_authenticated_all ON public.event_meal_service_rolls;

CREATE POLICY event_meal_service_rolls_authenticated_all
  ON public.event_meal_service_rolls
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
