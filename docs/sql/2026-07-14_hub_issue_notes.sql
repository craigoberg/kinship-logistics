-- 2026-07-14: Central, append-only timeline for every Governance Hub issue.
-- Keyed by (source, source_row_id) so Day Centre, Incident, Escalation, and
-- Renewal rows all share one read/write surface. Immutable: SELECT/INSERT only.

CREATE TABLE IF NOT EXISTS public.hub_issue_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source        text NOT NULL CHECK (source IN ('day_centre','incident','escalation','renewal')),
  source_row_id text NOT NULL,
  note          text NOT NULL,
  kind          text NOT NULL DEFAULT 'append'
                CHECK (kind IN ('append','defer','escalate','resolve')),
  stamped_at    timestamptz NOT NULL DEFAULT now(),
  staff_id      text NULL,
  metadata      jsonb NULL
);

CREATE INDEX IF NOT EXISTS hub_issue_notes_source_row_idx
  ON public.hub_issue_notes (source, source_row_id, stamped_at);

-- Data API grants (must be explicit on public schema)
GRANT SELECT, INSERT ON public.hub_issue_notes TO authenticated;
GRANT ALL ON public.hub_issue_notes TO service_role;

ALTER TABLE public.hub_issue_notes ENABLE ROW LEVEL SECURITY;

-- Append-only: authenticated users can read all Hub timelines and insert
-- new notes. No UPDATE / DELETE policies → rows are immutable by design.
DROP POLICY IF EXISTS hub_issue_notes_select ON public.hub_issue_notes;
CREATE POLICY hub_issue_notes_select
  ON public.hub_issue_notes
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS hub_issue_notes_insert ON public.hub_issue_notes;
CREATE POLICY hub_issue_notes_insert
  ON public.hub_issue_notes
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
