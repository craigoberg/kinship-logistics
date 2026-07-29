-- 2026-07-29 — Ensure hub_issue_notes is Alpha-ready on TEST
-- Idempotent. Safe if table already exists from bootstrap.
--
-- Also: Dashboard was querying source='site_issue' (invalid CHECK value) —
-- that is fixed in app code (day_centre|event). This SQL hardens the table.

CREATE TABLE IF NOT EXISTS public.hub_issue_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source        text NOT NULL,
  source_row_id text NOT NULL,
  note          text NOT NULL,
  kind          text NOT NULL DEFAULT 'append',
  stamped_at    timestamptz NOT NULL DEFAULT now(),
  staff_id      text NULL,
  metadata      jsonb NULL
);

ALTER TABLE public.hub_issue_notes
  ALTER COLUMN stamped_at SET DEFAULT now();

ALTER TABLE public.hub_issue_notes
  DROP CONSTRAINT IF EXISTS hub_issue_notes_source_check;

ALTER TABLE public.hub_issue_notes
  ADD CONSTRAINT hub_issue_notes_source_check
  CHECK (source IN (
    'day_centre',
    'event',
    'incident',
    'escalation',
    'renewal'
  ));

ALTER TABLE public.hub_issue_notes
  DROP CONSTRAINT IF EXISTS hub_issue_notes_kind_check;

ALTER TABLE public.hub_issue_notes
  ADD CONSTRAINT hub_issue_notes_kind_check
  CHECK (kind IN ('append', 'defer', 'escalate', 'resolve'));

CREATE INDEX IF NOT EXISTS hub_issue_notes_source_row_idx
  ON public.hub_issue_notes (source, source_row_id, stamped_at);

ALTER TABLE public.hub_issue_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kinship_anon_all_hub_issue_notes ON public.hub_issue_notes;
CREATE POLICY kinship_anon_all_hub_issue_notes
  ON public.hub_issue_notes
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS hub_issue_notes_select ON public.hub_issue_notes;
CREATE POLICY hub_issue_notes_select
  ON public.hub_issue_notes
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS hub_issue_notes_insert ON public.hub_issue_notes;
CREATE POLICY hub_issue_notes_insert
  ON public.hub_issue_notes
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

GRANT SELECT, INSERT ON public.hub_issue_notes TO anon;
GRANT SELECT, INSERT ON public.hub_issue_notes TO authenticated;
GRANT ALL ON public.hub_issue_notes TO service_role;

NOTIFY pgrst, 'reload schema';

-- Validation:
-- SELECT column_name, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'hub_issue_notes' AND column_name = 'stamped_at';
-- Expect column_default containing now()
