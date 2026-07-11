-- ============================================================
-- maintenance_items  (Governance Hub — Maintenance & Repairs tab)
-- Created: 2026-07-11
-- Purpose: Track any physical repair, equipment fault, or venue
--          defect that needs follow-up after a RYGE log event.
--
-- Auto-populated by:
--   • Log Venue Issue (YELLOW or RED) via EventDayVerbalAnomalyFlow
--   • INCIDENT/FAULT — Equipment & Asset lane via IncidentIntakeDialog
-- Also supports manual entries from the HUB Maintenance & Repairs tab.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.maintenance_items (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What needs fixing
  title             TEXT        NOT NULL,
  description       TEXT        NOT NULL,

  -- RYGE severity at time of logging
  severity          TEXT        NOT NULL DEFAULT 'yellow'
                    CHECK (severity IN ('green', 'yellow', 'red')),

  -- Lifecycle
  status            TEXT        NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),

  -- How this item was created
  source            TEXT        NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('venue_issue', 'incident_fault', 'manual')),

  -- Optional back-link to the originating row
  source_ref_id     UUID        NULL,   -- site_issues_register.id  OR  operational_incidents.id

  -- Optional links
  venue_id          UUID        NULL,   -- venues.id (no FK — venue may be soft-deleted)
  event_id          UUID        NULL,   -- events.id

  -- Contextual text
  location_label    TEXT        NULL,   -- e.g. "Toilet Block 3", "Bus bay 2"
  reported_by       TEXT        NULL,   -- staff name / id
  assigned_to       TEXT        NULL,   -- manager / contractor handling it

  -- Resolution
  resolution_notes  TEXT        NULL,
  resolved_at       TIMESTAMPTZ NULL,

  -- Timestamps
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS maintenance_items_status_idx
  ON public.maintenance_items (status);

CREATE INDEX IF NOT EXISTS maintenance_items_severity_idx
  ON public.maintenance_items (severity);

CREATE INDEX IF NOT EXISTS maintenance_items_source_idx
  ON public.maintenance_items (source);

CREATE INDEX IF NOT EXISTS maintenance_items_event_id_idx
  ON public.maintenance_items (event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS maintenance_items_created_at_idx
  ON public.maintenance_items (created_at DESC);

-- ── updated_at trigger ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_maintenance_items_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_maintenance_items_updated_at ON public.maintenance_items;
CREATE TRIGGER trg_maintenance_items_updated_at
  BEFORE UPDATE ON public.maintenance_items
  FOR EACH ROW EXECUTE FUNCTION public.set_maintenance_items_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.maintenance_items ENABLE ROW LEVEL SECURITY;

-- anon (PIN-session): full access — operators log items in the field
DROP POLICY IF EXISTS "anon_maintenance_items_all" ON public.maintenance_items;
CREATE POLICY "anon_maintenance_items_all"
  ON public.maintenance_items
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- authenticated (logged-in users): full access
DROP POLICY IF EXISTS "authenticated_maintenance_items_all" ON public.maintenance_items;
CREATE POLICY "authenticated_maintenance_items_all"
  ON public.maintenance_items
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── Grants ───────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.maintenance_items TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.maintenance_items TO authenticated;
