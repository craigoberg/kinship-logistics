-- ============================================================================
-- 2026-07-11 — Admin backup / restore helpers
--
-- Dynamic table discovery (public schema) + service-role-only truncate for
-- full restore. Apply in Supabase SQL editor on each environment.
-- ============================================================================

-- ---------- list_backup_tables ----------
-- Returns every user table in public schema. Called on each backup run so new
-- migrations are picked up automatically.

CREATE OR REPLACE FUNCTION public.list_backup_tables()
RETURNS TABLE(table_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.relname::text
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname NOT LIKE 'pg_%'
     AND c.relname NOT LIKE 'sql_%'
   ORDER BY c.relname;
$$;

REVOKE ALL ON FUNCTION public.list_backup_tables() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_backup_tables()
  TO anon, authenticated, service_role;

-- ---------- order_tables_for_restore ----------
-- Parents (fewer inbound FKs) before children for insert after truncate.

CREATE OR REPLACE FUNCTION public.order_tables_for_restore(p_tables text[])
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH input AS (
    SELECT unnest(p_tables) AS table_name
  ),
  fk_counts AS (
    SELECT i.table_name,
           COALESCE((
             SELECT COUNT(*)
               FROM pg_constraint con
               JOIN pg_class child ON child.oid = con.conrelid
               JOIN pg_namespace ns ON ns.oid = child.relnamespace
              WHERE con.contype = 'f'
                AND ns.nspname = 'public'
                AND child.relname = i.table_name
           ), 0) AS inbound_fk_count
      FROM input i
  )
  SELECT array_agg(table_name ORDER BY inbound_fk_count ASC, table_name ASC)
    FROM fk_counts;
$$;

REVOKE ALL ON FUNCTION public.order_tables_for_restore(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.order_tables_for_restore(text[])
  TO anon, authenticated, service_role;

-- ---------- truncate_backup_tables ----------
-- Destructive — service_role only. Clears listed tables before restore insert.

CREATE OR REPLACE FUNCTION public.truncate_backup_tables(p_tables text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sql text;
BEGIN
  IF p_tables IS NULL OR array_length(p_tables, 1) IS NULL THEN
    RETURN;
  END IF;

  v_sql := format(
    'TRUNCATE TABLE %s RESTART IDENTITY CASCADE',
    (
      SELECT string_agg(quote_ident(t), ', ' ORDER BY t)
        FROM unnest(p_tables) AS t
    )
  );

  EXECUTE v_sql;
END;
$$;

REVOKE ALL ON FUNCTION public.truncate_backup_tables(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.truncate_backup_tables(text[])
  TO service_role;
