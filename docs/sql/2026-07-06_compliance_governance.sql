-- Compliance Governance Engine
-- Centralized registry of every "thing that expires" — rego, certifications,
-- insurance policies, equipment audits, council inspections, etc.
--
-- The dashboard's exception feed, the Governance Hub admin CRUD UI, and the
-- Resolve modals all read from this single table and dispatch off
-- `action_module`. Adding a new compliance category (e.g. 'COUNCIL') only
-- requires inserting a row here — no code change needed for it to surface
-- as a dashboard tile.
--
-- Every INSERT/UPDATE/DELETE appends a COMPLIANCE_ASSET_<OP> row to the
-- operational_ledger via a SECURITY DEFINER trigger.

CREATE TABLE IF NOT EXISTS public.compliance_assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category        text NOT NULL,           -- 'VEHICLE' | 'STAFF' | 'INSURANCE' | 'EQUIPMENT' | 'FACILITY' | …
  type            text NOT NULL,           -- 'rego' | 'service' | 'certification' | 'policy' | 'extinguisher' | …
  name            text NOT NULL,
  description     text,
  subject_table   text,                    -- 'transport_assets' | 'staff_registry' | null
  subject_id      uuid,                    -- FK-by-convention into subject_table; null for standalone
  expiry_date     date,
  next_action_at  timestamptz,
  action_module   text NOT NULL DEFAULT 'generic_resolve',
                                           -- dispatch key — see src/lib/dashboard/dispatch-resolve-modal.tsx
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,
                                           -- { yellow_days, red_days, checklist_category?, handshake?, … }
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS compliance_assets_active_next_action_idx
  ON public.compliance_assets (status, next_action_at);
CREATE INDEX IF NOT EXISTS compliance_assets_category_idx
  ON public.compliance_assets (category);
CREATE INDEX IF NOT EXISTS compliance_assets_action_module_idx
  ON public.compliance_assets (action_module);
CREATE INDEX IF NOT EXISTS compliance_assets_subject_idx
  ON public.compliance_assets (subject_table, subject_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_assets TO anon, authenticated;
GRANT ALL ON public.compliance_assets TO service_role;

ALTER TABLE public.compliance_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "compliance_assets readable by all" ON public.compliance_assets;
CREATE POLICY "compliance_assets readable by all"
  ON public.compliance_assets
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Writes are open at the RLS layer (mirrors system_parameters); the API layer
-- enforces manager-only via canManageSystemParameters() / is_manager() before
-- calling. Tighten here once every writer holds an auth-linked staff row.
DROP POLICY IF EXISTS "compliance_assets writable" ON public.compliance_assets;
CREATE POLICY "compliance_assets writable"
  ON public.compliance_assets
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.compliance_assets_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS compliance_assets_touch_updated_at_trg ON public.compliance_assets;
CREATE TRIGGER compliance_assets_touch_updated_at_trg
  BEFORE UPDATE ON public.compliance_assets
  FOR EACH ROW EXECUTE FUNCTION public.compliance_assets_touch_updated_at();

-- Change-log trigger — every write becomes an immutable ledger receipt.
CREATE OR REPLACE FUNCTION public.log_compliance_asset_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
BEGIN
  INSERT INTO public.operational_ledger(
    staff_id, category, severity, action_type, metadata
  ) VALUES (
    v_actor,
    'CENTRE',
    'INFO',
    'COMPLIANCE_ASSET_' || TG_OP,
    jsonb_build_object(
      'op',     TG_OP,
      'before', CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
      'after',  CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END,
      'source', 'compliance_assets_trigger'
    )
  );
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS compliance_assets_audit_trg ON public.compliance_assets;
CREATE TRIGGER compliance_assets_audit_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.compliance_assets
  FOR EACH ROW EXECUTE FUNCTION public.log_compliance_asset_change();

-- Seed a representative spread so the Governance Hub renders non-empty on
-- first load. ON CONFLICT-safe via WHERE NOT EXISTS guards.
INSERT INTO public.compliance_assets (category, type, name, description, action_module, config, expiry_date)
SELECT 'INSURANCE', 'policy', 'Public Liability — Annual Cover',
       'Centre-wide public liability policy. Renew via broker.',
       'insurance_renewal',
       '{"yellow_days":45,"red_days":14,"handshake":"single"}'::jsonb,
       (current_date + interval '60 days')::date
WHERE NOT EXISTS (
  SELECT 1 FROM public.compliance_assets WHERE name = 'Public Liability — Annual Cover'
);

INSERT INTO public.compliance_assets (category, type, name, description, action_module, config, expiry_date)
SELECT 'EQUIPMENT', 'extinguisher', 'Depot Fire Extinguisher — Annual Inspection',
       'Two-person formal safety audit on the depot fire extinguisher.',
       'formal_audit',
       '{"yellow_days":30,"red_days":7,"handshake":"dual","checklist_category":"VEHICLE_FORMAL_AUDIT"}'::jsonb,
       (current_date + interval '20 days')::date
WHERE NOT EXISTS (
  SELECT 1 FROM public.compliance_assets WHERE name = 'Depot Fire Extinguisher — Annual Inspection'
);

INSERT INTO public.compliance_assets (category, type, name, description, action_module, config, expiry_date)
SELECT 'FACILITY', 'lease', 'Depot Building Lease — Anniversary Review',
       'Annual review of the depot lease terms.',
       'generic_resolve',
       '{"yellow_days":60,"red_days":14,"handshake":"single"}'::jsonb,
       (current_date + interval '90 days')::date
WHERE NOT EXISTS (
  SELECT 1 FROM public.compliance_assets WHERE name = 'Depot Building Lease — Anniversary Review'
);

NOTIFY pgrst, 'reload schema';
