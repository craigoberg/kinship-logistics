-- ============================================================================
-- 2026-07-05 — Formal Safety Audit
--
-- Database-driven checklist for the "Two-Man" Formal Audit safety review on
-- the ResolveVehicleMaintenanceModal. Items live in `checklist_items` keyed
-- by `category` (e.g. 'VEHICLE_FORMAL_AUDIT') so audits stay flexible without
-- code changes. Per-audit responses are mirrored into `checklist_responses`
-- keyed by the operational_ledger row id, while the same payload is also
-- embedded as metadata on the ledger entry for a self-contained receipt.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.checklist_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text NOT NULL,
  category   text NOT NULL,
  sort_order int  NOT NULL DEFAULT 100,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checklist_items_category_idx
  ON public.checklist_items (category, sort_order);

GRANT SELECT ON public.checklist_items TO anon, authenticated;
GRANT ALL    ON public.checklist_items TO service_role;

ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "checklist_items_read" ON public.checklist_items;
CREATE POLICY "checklist_items_read"
  ON public.checklist_items
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.checklist_responses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id  uuid NOT NULL REFERENCES public.operational_ledger(id) ON DELETE CASCADE,
  item_id    uuid NOT NULL REFERENCES public.checklist_items(id),
  status     text NOT NULL CHECK (status IN ('pass','fail','na')),
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checklist_responses_ledger_idx
  ON public.checklist_responses (ledger_id);

GRANT SELECT, INSERT ON public.checklist_responses TO anon, authenticated;
GRANT ALL ON public.checklist_responses TO service_role;

ALTER TABLE public.checklist_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "checklist_responses_read" ON public.checklist_responses;
CREATE POLICY "checklist_responses_read"
  ON public.checklist_responses
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "checklist_responses_insert" ON public.checklist_responses;
CREATE POLICY "checklist_responses_insert"
  ON public.checklist_responses
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- Seed VEHICLE_FORMAL_AUDIT items (idempotent).
INSERT INTO public.checklist_items (label, category, sort_order)
SELECT v.label, 'VEHICLE_FORMAL_AUDIT', v.sort_order
FROM (VALUES
  ('Brakes operating correctly',          10),
  ('Tyre tread + pressure within spec',   20),
  ('All exterior lights functional',      30),
  ('All seatbelts retract and lock',      40),
  ('Wheelchair restraints serviceable',   50),
  ('First-aid kit present + in date',     60),
  ('Fire extinguisher charged + in date', 70),
  ('Fluid levels checked',                80),
  ('No new body damage',                  90),
  ('Registration sticker valid',         100),
  ('No active dashboard warnings',       110)
) AS v(label, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.checklist_items ci
  WHERE ci.category = 'VEHICLE_FORMAL_AUDIT' AND ci.label = v.label
);
