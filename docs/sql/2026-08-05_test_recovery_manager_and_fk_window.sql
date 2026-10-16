-- ============================================================================
-- 2026-08-05 — TEST recovery after failed restore wipe
--
-- 1) Re-apply FK load window (safeupdate-safe DELETE … WHERE true)
-- 2) Re-seed bootstrap manager PIN 1234
-- 3) Fix verify_operator_pin (return all matches + personnel_type)
--
-- Does NOT truncate or delete operational data except replacing the
-- bootstrap manager row. Run on TEST only.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- FK stash + RPCs ----------
CREATE TABLE IF NOT EXISTS public._backup_fk_restore_stash (
  id bigserial PRIMARY KEY,
  table_name text NOT NULL,
  constraint_name text NOT NULL,
  definition text NOT NULL
);

ALTER TABLE public._backup_fk_restore_stash ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._backup_fk_restore_stash FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public._backup_fk_restore_stash TO service_role;
GRANT ALL ON SEQUENCE public._backup_fk_restore_stash_id_seq TO service_role;

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
     AND c.relname NOT LIKE '\_backup\_%' ESCAPE '\'
   ORDER BY c.relname;
$$;

GRANT EXECUTE ON FUNCTION public.list_backup_tables()
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.backup_drop_all_public_fks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  n integer := 0;
  v_live integer;
  v_stashed integer;
BEGIN
  SELECT COUNT(*)::integer INTO v_live
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
   WHERE ns.nspname = 'public'
     AND con.contype = 'f';

  SELECT COUNT(*)::integer INTO v_stashed
    FROM public._backup_fk_restore_stash;

  IF v_live = 0 THEN
    RETURN v_stashed;
  END IF;

  DELETE FROM public._backup_fk_restore_stash WHERE true;

  FOR r IN
    SELECT
      rel.relname AS table_name,
      con.conname AS constraint_name,
      pg_get_constraintdef(con.oid, true) AS definition
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND con.contype = 'f'
    ORDER BY rel.relname, con.conname
  LOOP
    INSERT INTO public._backup_fk_restore_stash (table_name, constraint_name, definition)
    VALUES (r.table_name, r.constraint_name, r.definition);

    EXECUTE format(
      'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
      r.table_name,
      r.constraint_name
    );
    n := n + 1;
  END LOOP;

  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.backup_restore_all_public_fks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT table_name, constraint_name, definition
      FROM public._backup_fk_restore_stash
     ORDER BY table_name, constraint_name
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I %s NOT VALID',
        r.table_name,
        r.constraint_name,
        r.definition
      );
      n := n + 1;
    EXCEPTION
      WHEN duplicate_object THEN
        NULL;
      WHEN OTHERS THEN
        RAISE NOTICE 'Could not re-add FK %.%: %', r.table_name, r.constraint_name, SQLERRM;
    END;
  END LOOP;

  FOR r IN
    SELECT table_name, constraint_name
      FROM public._backup_fk_restore_stash
     ORDER BY table_name, constraint_name
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER TABLE public.%I VALIDATE CONSTRAINT %I',
        r.table_name,
        r.constraint_name
      );
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'FK %.% left NOT VALID (orphans): %',
          r.table_name, r.constraint_name, SQLERRM;
    END;
  END LOOP;

  DELETE FROM public._backup_fk_restore_stash WHERE true;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.backup_drop_all_public_fks() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backup_restore_all_public_fks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backup_drop_all_public_fks() TO service_role;
GRANT EXECUTE ON FUNCTION public.backup_restore_all_public_fks() TO service_role;

-- ---------- PIN verify + bootstrap manager ----------
DROP FUNCTION IF EXISTS public.verify_operator_pin(text);

CREATE OR REPLACE FUNCTION public.verify_operator_pin(entered_pin text)
RETURNS TABLE (
  id uuid,
  full_name text,
  role text,
  personnel_type text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
  SELECT s.id, s.full_name, s.role, s.personnel_type
  FROM public.staff_registry s
  WHERE s.active = true
    AND s.pin_hash IS NOT NULL
    AND s.pin_hash = encode(digest(entered_pin, 'sha256'), 'hex');
$$;

REVOKE ALL ON FUNCTION public.verify_operator_pin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_operator_pin(text)
  TO anon, authenticated, service_role;

DELETE FROM public.staff_registry
WHERE full_name = 'TEST Bootstrap Manager'
   OR email = 'bootstrap@test.local';

INSERT INTO public.staff_registry (
  full_name,
  role,
  personnel_type,
  pin_hash,
  active,
  email
)
VALUES (
  'TEST Bootstrap Manager',
  'manager',
  'manager',
  encode(digest('1234', 'sha256'), 'hex'),
  true,
  'bootstrap@test.local'
);

-- ---------- Validation (expect rows) ----------
-- SELECT count(*) FROM staff_registry;  -- at least 1
-- SELECT * FROM verify_operator_pin('1234');  -- bootstrap manager
-- SELECT backup_drop_all_public_fks();   -- number
-- SELECT backup_restore_all_public_fks(); -- put FKs back before app restore
