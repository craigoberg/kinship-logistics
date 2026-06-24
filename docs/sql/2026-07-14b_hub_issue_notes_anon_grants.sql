-- 2026-07-14b: hub_issue_notes is reached by the PIN-authenticated app
-- as the `anon` Data API role (the app does not use Supabase Auth).
-- Open SELECT + INSERT to anon so the Manage Issue dialog can read prior
-- timeline entries and append new ones. Append-only is still enforced
-- (no UPDATE/DELETE policies exist).

GRANT SELECT, INSERT ON public.hub_issue_notes TO anon;

DROP POLICY IF EXISTS hub_issue_notes_select ON public.hub_issue_notes;
CREATE POLICY hub_issue_notes_select
  ON public.hub_issue_notes
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS hub_issue_notes_insert ON public.hub_issue_notes;
CREATE POLICY hub_issue_notes_insert
  ON public.hub_issue_notes
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
