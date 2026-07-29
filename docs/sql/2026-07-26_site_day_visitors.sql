-- BL-097 — Day Centre floor visitors (non-registered).
-- Not participants; not Event Deliver. Same-day arrive/leave; Close Centre
-- blocks while left_at IS NULL.
--
-- Supabase SQL Editor may end with "Success. No rows returned" for DDL — expected.

CREATE TABLE IF NOT EXISTS public.site_day_visitors (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id              uuid NOT NULL REFERENCES public.site_day_sessions(id) ON DELETE CASCADE,
  display_name            text NOT NULL,
  kind                    text NOT NULL
                          CHECK (kind IN ('trial', 'friend', 'family', 'other')),
  linked_participant_id   uuid REFERENCES public.participants(id) ON DELETE SET NULL,
  note                    text,
  arrived_at              timestamptz NOT NULL DEFAULT now(),
  arrived_by              uuid,
  left_at                 timestamptz,
  left_by                 uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_day_visitors_session_idx
  ON public.site_day_visitors (session_id);

CREATE INDEX IF NOT EXISTS site_day_visitors_present_idx
  ON public.site_day_visitors (session_id)
  WHERE left_at IS NULL;

COMMENT ON TABLE public.site_day_visitors IS
  'BL-097 Day Centre floor visitors (non-registered). Not NDIS clients; not Event Deliver.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_day_visitors TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_day_visitors TO anon;
GRANT ALL ON public.site_day_visitors TO service_role;

ALTER TABLE public.site_day_visitors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "site_day_visitors readable" ON public.site_day_visitors;
CREATE POLICY "site_day_visitors readable"
  ON public.site_day_visitors FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "site_day_visitors writable" ON public.site_day_visitors;
CREATE POLICY "site_day_visitors writable"
  ON public.site_day_visitors FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "site_day_visitors updatable" ON public.site_day_visitors;
CREATE POLICY "site_day_visitors updatable"
  ON public.site_day_visitors FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "site_day_visitors deletable" ON public.site_day_visitors;
CREATE POLICY "site_day_visitors deletable"
  ON public.site_day_visitors FOR DELETE TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.touch_site_day_visitors_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_site_day_visitors ON public.site_day_visitors;
CREATE TRIGGER trg_touch_site_day_visitors
  BEFORE UPDATE ON public.site_day_visitors
  FOR EACH ROW EXECUTE FUNCTION public.touch_site_day_visitors_updated_at();

-- ── Validation (expect rows after migrate) ──────────────────────────────────
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name = 'site_day_visitors';
--
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'site_day_visitors'
-- ORDER BY ordinal_position;
--
-- SELECT polname, polcmd FROM pg_policy
-- WHERE polrelid = 'public.site_day_visitors'::regclass;
