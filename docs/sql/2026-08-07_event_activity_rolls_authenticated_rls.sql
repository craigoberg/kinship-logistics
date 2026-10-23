-- 2026-08-07 — event_activity_rolls RLS: allow authenticated (day login)
--
-- Symptom: POST /event_activity_rolls … 403 Forbidden when seeding activity
--          roll (open venue / leave for next / walk-other).
-- Cause:   Phase B policies were TO anon only. Day email+password session
--          uses role authenticated — GRANTs exist, but RLS blocks INSERT.
-- PIN-only (anon JWT) still works; this adds authenticated alongside anon.
--
-- Idempotent. Run on DEV and TEST.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_activity_rolls TO anon, authenticated;

DROP POLICY IF EXISTS "anon_read_event_activity_rolls" ON public.event_activity_rolls;
DROP POLICY IF EXISTS "anon_insert_event_activity_rolls" ON public.event_activity_rolls;
DROP POLICY IF EXISTS "anon_update_event_activity_rolls" ON public.event_activity_rolls;
DROP POLICY IF EXISTS "anon_delete_event_activity_rolls" ON public.event_activity_rolls;
DROP POLICY IF EXISTS "kinship_anon_all_event_activity_rolls" ON public.event_activity_rolls;

CREATE POLICY "anon_read_event_activity_rolls"
  ON public.event_activity_rolls
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "anon_insert_event_activity_rolls"
  ON public.event_activity_rolls
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "anon_update_event_activity_rolls"
  ON public.event_activity_rolls
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "anon_delete_event_activity_rolls"
  ON public.event_activity_rolls
  FOR DELETE
  TO anon, authenticated
  USING (true);

-- ── Validation (expect roles include authenticated on all four) ─────────────
-- SELECT policyname, roles, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'event_activity_rolls'
-- ORDER BY policyname;
-- Expected: 4 rows; each roles array contains anon and authenticated.
