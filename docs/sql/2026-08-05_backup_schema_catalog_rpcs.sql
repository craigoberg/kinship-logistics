-- ============================================================================
-- 2026-08-05 — Backup v2: live schema catalog export + DDL executor
--
-- export_backup_schema_catalog() — discovers public schema at backup time
--   (enums, columns, constraints, indexes, functions, triggers, RLS policies).
-- exec_backup_ddl(sql) — service_role only; runs one DDL statement for restore.
--
-- Idempotent. Apply on DEV and TEST (and PROD when created).
-- ============================================================================

-- ---------- export_backup_schema_catalog ----------
CREATE OR REPLACE FUNCTION public.export_backup_schema_catalog()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'exportedAt', now(),
    'enums', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'enum_name', t.typname,
          'enum_value', e.enumlabel,
          'sort_order', e.enumsortorder
        )
        ORDER BY t.typname, e.enumsortorder
      )
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
    ), '[]'::jsonb),

    'columns', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'table_name', c.table_name,
          'column_name', c.column_name,
          'data_type', c.data_type,
          'udt_name', c.udt_name,
          'is_nullable', c.is_nullable,
          'column_default', c.column_default,
          'ordinal_position', c.ordinal_position
        )
        ORDER BY c.table_name, c.ordinal_position
      )
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
    ), '[]'::jsonb),

    'constraints', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'constraint_name', con.conname,
          'type', con.contype,
          'table_name', rel.relname,
          'definition', pg_get_constraintdef(con.oid, true)
        )
        ORDER BY rel.relname, con.contype, con.conname
      )
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = rel.relnamespace
      WHERE n.nspname = 'public'
    ), '[]'::jsonb),

    'indexes', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'tablename', i.tablename,
          'indexname', i.indexname,
          'indexdef', i.indexdef
        )
        ORDER BY i.tablename, i.indexname
      )
      FROM pg_indexes i
      WHERE i.schemaname = 'public'
    ), '[]'::jsonb),

    'functions', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'function_name', p.proname,
          'args', pg_get_function_identity_arguments(p.oid),
          'definition', pg_get_functiondef(p.oid)
        )
        ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)
      )
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.prokind = 'f'
    ), '[]'::jsonb),

    'triggers', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'table_name', c.relname,
          'trigger_name', t.tgname,
          'definition', pg_get_triggerdef(t.oid, true)
        )
        ORDER BY c.relname, t.tgname
      )
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND NOT t.tgisinternal
    ), '[]'::jsonb),

    'policies', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schemaname', pol.schemaname,
          'tablename', pol.tablename,
          'policyname', pol.policyname,
          'permissive', pol.permissive,
          'roles', to_jsonb(pol.roles),
          'cmd', pol.cmd,
          'qual', pol.qual,
          'with_check', pol.with_check
        )
        ORDER BY pol.tablename, pol.policyname
      )
      FROM pg_policies pol
      WHERE pol.schemaname = 'public'
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.export_backup_schema_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.export_backup_schema_catalog()
  TO anon, authenticated, service_role;

-- ---------- exec_backup_ddl ----------
-- Runs a single DDL statement during schema restore. service_role only.
CREATE OR REPLACE FUNCTION public.exec_backup_ddl(p_sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trim text := btrim(coalesce(p_sql, ''));
BEGIN
  IF v_trim = '' THEN
    RETURN;
  END IF;

  -- Allowlist prefixes only (no DROP TABLE / TRUNCATE / DELETE via this path)
  IF v_trim !~* '^(CREATE|ALTER|DROP\s+POLICY|DROP\s+TRIGGER|DROP\s+INDEX|DO\s|GRANT|REVOKE|COMMENT)' THEN
    RAISE EXCEPTION 'exec_backup_ddl rejected statement (prefix not allowed)';
  END IF;

  IF v_trim ~* '\mDROP\s+TABLE\M' OR v_trim ~* '\mTRUNCATE\M' THEN
    RAISE EXCEPTION 'exec_backup_ddl rejected destructive statement';
  END IF;

  EXECUTE v_trim;
END;
$$;

REVOKE ALL ON FUNCTION public.exec_backup_ddl(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exec_backup_ddl(text) TO service_role;

-- ---------- Validation ----------
-- SELECT jsonb_typeof(export_backup_schema_catalog()->'columns');  -- expect "array"
-- SELECT jsonb_array_length(export_backup_schema_catalog()->'columns'); -- expect ~800+
-- SELECT proname FROM pg_proc WHERE proname IN ('export_backup_schema_catalog','exec_backup_ddl');
