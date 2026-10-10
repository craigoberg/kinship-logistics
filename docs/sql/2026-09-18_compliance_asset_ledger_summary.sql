-- Human-readable COMPLIANCE_ASSET_* ledger receipts for Admin Activity log.
-- The old trigger stored only before/after JSON and used auth.uid() (or the
-- all-zero UUID) as staff_id — which is why the log showed "Unknown operator"
-- / "COMPLIANCE ASSET INSERT" with no asset name.
--
-- Success. No rows returned = expected for CREATE FUNCTION / DROP TRIGGER.
--
-- Validation (expect 1 row):
--   SELECT proname FROM pg_proc WHERE proname = 'log_compliance_asset_change';
--
-- After a fleet/compliance save, newest receipt should include metadata.summary
-- and metadata.asset_name (expect 1+ rows):
--   SELECT action_type, metadata->>'summary' AS summary, metadata->>'actor_name' AS actor
--   FROM operational_ledger
--   WHERE action_type LIKE 'COMPLIANCE_ASSET_%'
--   ORDER BY created_at DESC
--   LIMIT 5;

CREATE OR REPLACE FUNCTION public.log_compliance_asset_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_actor_name text;
  v_name text;
  v_type text;
  v_cat text;
  v_subject text;
  v_verb text;
  v_summary text;
BEGIN
  v_actor := COALESCE(
    (
      SELECT sr.id
      FROM public.staff_registry sr
      WHERE sr.auth_user_id = auth.uid()
      LIMIT 1
    ),
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.created_by END,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.created_by END,
    '00000000-0000-0000-0000-000000000000'::uuid
  );

  SELECT sr.full_name INTO v_actor_name
  FROM public.staff_registry sr
  WHERE sr.id = v_actor
  LIMIT 1;

  IF v_actor_name IS NULL OR btrim(v_actor_name) = '' THEN
    v_actor_name := CASE
      WHEN v_actor = '00000000-0000-0000-0000-000000000000'::uuid THEN 'System'
      ELSE 'System'
    END;
  END IF;

  v_name := COALESCE(NEW.name, OLD.name);
  v_type := COALESCE(NEW.type, OLD.type);
  v_cat := COALESCE(NEW.category, OLD.category);
  v_subject := NULLIF(
    trim(
      BOTH ' '
      FROM concat_ws(
        ' ',
        replace(COALESCE(NEW.subject_table, OLD.subject_table, ''), '_', ' '),
        COALESCE(NEW.subject_id::text, OLD.subject_id::text, '')
      )
    ),
    ''
  );

  v_verb := CASE TG_OP
    WHEN 'INSERT' THEN 'Added'
    WHEN 'DELETE' THEN 'Removed'
    ELSE 'Updated'
  END;

  v_summary := v_verb || ' compliance asset “' || COALESCE(v_name, 'unnamed') || '”';
  IF v_type IS NOT NULL OR v_cat IS NOT NULL THEN
    v_summary := v_summary || ' (' || concat_ws(', ', v_type, v_cat) || ')';
  END IF;
  IF v_subject IS NOT NULL THEN
    v_summary := v_summary || ' — ' || v_subject;
  END IF;

  INSERT INTO public.operational_ledger(
    staff_id, category, severity, action_type, metadata
  ) VALUES (
    v_actor,
    'CENTRE',
    'INFO',
    'COMPLIANCE_ASSET_' || TG_OP,
    jsonb_build_object(
      'op', TG_OP,
      'source', 'compliance_assets_trigger',
      'actor_name', v_actor_name,
      'asset_name', v_name,
      'asset_type', v_type,
      'asset_category', v_cat,
      'summary', v_summary,
      'before', CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
      'after', CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END
    )
  );
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS compliance_assets_audit_trg ON public.compliance_assets;
CREATE TRIGGER compliance_assets_audit_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.compliance_assets
  FOR EACH ROW EXECUTE FUNCTION public.log_compliance_asset_change();

NOTIFY pgrst, 'reload schema';
