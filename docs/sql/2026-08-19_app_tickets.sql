-- ============================================================
-- app_tickets + app_ticket_notes  (Governance Hub — App tickets)
-- Created: 2026-08-19
-- BL-116: in-app support tickets (TEST + PROD). GREEN-note lifecycle.
--
-- NOT operational incidents or maintenance. Dedicated register so
-- NDIS Human / Maintenance / Compliance streams stay clean.
--
-- "Success. No rows returned" is expected for this script (DDL/GRANT only).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.app_tickets (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  title                 TEXT        NOT NULL,
  description           TEXT        NOT NULL,

  status                TEXT        NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'in_progress', 'deferred', 'resolved', 'closed')),

  reported_by_staff_id  UUID        NULL,   -- no FK — PIN placeholder ids must not fail
  reported_by_name      TEXT        NOT NULL,

  path_label            TEXT        NOT NULL,
  form_title            TEXT        NULL,
  last_control_label    TEXT        NULL,
  context_json          JSONB       NOT NULL DEFAULT '{}'::jsonb,

  resolution_notes      TEXT        NULL,
  deferred_until        DATE        NULL,
  deferred_reason       TEXT        NULL,
  defer_count           INTEGER     NOT NULL DEFAULT 0,
  resolved_at           TIMESTAMPTZ NULL,
  resolved_by_name      TEXT        NULL,
  last_note_at          TIMESTAMPTZ NULL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.app_ticket_notes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID        NOT NULL REFERENCES public.app_tickets(id) ON DELETE CASCADE,
  note_text   TEXT        NOT NULL,
  author      TEXT        NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS app_tickets_status_idx
  ON public.app_tickets (status);

CREATE INDEX IF NOT EXISTS app_tickets_created_at_idx
  ON public.app_tickets (created_at DESC);

CREATE INDEX IF NOT EXISTS app_ticket_notes_ticket_id_idx
  ON public.app_ticket_notes (ticket_id, created_at);

CREATE OR REPLACE FUNCTION public.set_app_tickets_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_tickets_updated_at ON public.app_tickets;
CREATE TRIGGER trg_app_tickets_updated_at
  BEFORE UPDATE ON public.app_tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_app_tickets_updated_at();

ALTER TABLE public.app_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_ticket_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_app_tickets_all" ON public.app_tickets;
CREATE POLICY "anon_app_tickets_all"
  ON public.app_tickets
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_app_tickets_all" ON public.app_tickets;
CREATE POLICY "authenticated_app_tickets_all"
  ON public.app_tickets
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "anon_app_ticket_notes_all" ON public.app_ticket_notes;
CREATE POLICY "anon_app_ticket_notes_all"
  ON public.app_ticket_notes
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_app_ticket_notes_all" ON public.app_ticket_notes;
CREATE POLICY "authenticated_app_ticket_notes_all"
  ON public.app_ticket_notes
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_tickets TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_tickets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_ticket_notes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_ticket_notes TO authenticated;

-- ============================================================
-- Validation (run after load — these SHOULD return rows)
--
-- 1) Tables exist — expect 2 rows:
--    SELECT table_name
--    FROM information_schema.tables
--    WHERE table_schema = 'public'
--      AND table_name IN ('app_tickets', 'app_ticket_notes')
--    ORDER BY 1;
--
-- 2) Anon can write — expect INSERT + SELECT + UPDATE + DELETE:
--    SELECT privilege_type
--    FROM information_schema.role_table_grants
--    WHERE table_schema = 'public'
--      AND table_name = 'app_tickets'
--      AND grantee = 'anon'
--    ORDER BY 1;
-- ============================================================
