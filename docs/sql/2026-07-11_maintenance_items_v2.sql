-- ============================================================
-- maintenance_items v2 — defer columns + maintenance_notes
-- Created: 2026-07-11
-- Run after: 2026-07-11_maintenance_items.sql
-- ============================================================

-- ── 1. Add deferred-state columns to maintenance_items ───────────────────────

ALTER TABLE public.maintenance_items
  ADD COLUMN IF NOT EXISTS deferred_until  DATE  NULL,
  ADD COLUMN IF NOT EXISTS deferred_reason TEXT  NULL,
  ADD COLUMN IF NOT EXISTS defer_count     INT   NOT NULL DEFAULT 0;

-- Widen the status check to include 'deferred'.
-- Drop the anonymous inline constraint first (Postgres auto-names it).
ALTER TABLE public.maintenance_items
  DROP CONSTRAINT IF EXISTS maintenance_items_status_check;

ALTER TABLE public.maintenance_items
  ADD CONSTRAINT maintenance_items_status_check
  CHECK (status IN ('open', 'in_progress', 'deferred', 'resolved', 'closed'));

-- ── 2. maintenance_notes table ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.maintenance_notes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     UUID        NOT NULL
                REFERENCES public.maintenance_items(id) ON DELETE CASCADE,
  note_text   TEXT        NOT NULL,
  author      TEXT        NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ordered by item + time (most recent last for timeline display)
CREATE INDEX IF NOT EXISTS maintenance_notes_item_id_idx
  ON public.maintenance_notes (item_id, created_at ASC);

-- ── 3. RLS for maintenance_notes ─────────────────────────────────────────────

ALTER TABLE public.maintenance_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_maintenance_notes_all"          ON public.maintenance_notes;
DROP POLICY IF EXISTS "authenticated_maintenance_notes_all" ON public.maintenance_notes;

CREATE POLICY "anon_maintenance_notes_all"
  ON public.maintenance_notes FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_maintenance_notes_all"
  ON public.maintenance_notes FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_notes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_notes TO authenticated;
