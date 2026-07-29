-- 2026-07-18 — Event Deliver "Reset Start of Day" (test rewind)
--
-- Allows anon DELETE on event_activity_rolls (Phase B only granted SELECT/INSERT/UPDATE).
-- Other wipe targets (attendance, morning/curfew, bus manifest, transport_trips, site_issues)
-- already have DELETE policies from earlier migrations.
--
-- Run in Supabase SQL Editor → Run All
-- "Success. No rows returned" is normal for DDL.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_activity_rolls TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_activity_rolls TO authenticated;

DROP POLICY IF EXISTS "anon_delete_event_activity_rolls" ON public.event_activity_rolls;
CREATE POLICY "anon_delete_event_activity_rolls"
  ON public.event_activity_rolls
  FOR DELETE TO anon, authenticated
  USING (true);

NOTIFY pgrst, 'reload schema';

-- ── Validation (expect 1+ rows) ─────────────────────────────────────────────
-- SELECT policyname FROM pg_policies
-- WHERE tablename = 'event_activity_rolls'
-- ORDER BY policyname;
-- Expect: anon_delete_event_activity_rolls among the list
--
-- SELECT has_table_privilege('anon', 'public.event_activity_rolls', 'delete') AS anon_can_delete;
-- Expect: anon_can_delete = true
