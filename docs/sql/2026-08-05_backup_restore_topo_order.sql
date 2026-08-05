-- ============================================================================
-- 2026-08-05 — Fix order_tables_for_restore: true topological sort by FK edges
--
-- Previous version sorted by FK *count*, which put high-FK parents (e.g.
-- transport_trips) AFTER their children (trip_legs). Apply on DEV + TEST.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.order_tables_for_restore(p_tables text[])
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining text[];
  v_ordered text[] := ARRAY[]::text[];
  v_ready text[];
  v_guard int := 0;
BEGIN
  IF p_tables IS NULL OR cardinality(p_tables) IS NULL OR cardinality(p_tables) = 0 THEN
    RETURN ARRAY[]::text[];
  END IF;

  v_remaining := p_tables;

  LOOP
    v_guard := v_guard + 1;
    IF v_guard > 10000 THEN
      EXIT;
    END IF;

    -- Tables with no parent still in the remaining set
    SELECT COALESCE(array_agg(t ORDER BY t), ARRAY[]::text[])
      INTO v_ready
      FROM unnest(v_remaining) AS t
     WHERE NOT EXISTS (
       SELECT 1
         FROM pg_constraint con
         JOIN pg_class child ON child.oid = con.conrelid
         JOIN pg_namespace ns ON ns.oid = child.relnamespace
         JOIN pg_class parent ON parent.oid = con.confrelid
         JOIN pg_namespace nsp ON nsp.oid = parent.relnamespace
        WHERE con.contype = 'f'
          AND ns.nspname = 'public'
          AND nsp.nspname = 'public'
          AND child.relname = t
          AND parent.relname = ANY (v_remaining)
          AND parent.relname <> child.relname
     );

    EXIT WHEN cardinality(v_ready) IS NULL OR cardinality(v_ready) = 0;

    v_ordered := v_ordered || v_ready;
    v_remaining := ARRAY(
      SELECT x FROM unnest(v_remaining) AS x
       WHERE NOT (x = ANY (v_ready))
    );
  END LOOP;

  -- Cycles / leftovers
  IF cardinality(v_remaining) IS NOT NULL AND cardinality(v_remaining) > 0 THEN
    v_ordered := v_ordered || (
      SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::text[])
        FROM unnest(v_remaining) AS x
    );
  END IF;

  RETURN v_ordered;
END;
$$;

REVOKE ALL ON FUNCTION public.order_tables_for_restore(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.order_tables_for_restore(text[])
  TO anon, authenticated, service_role;

-- Validation (expect transport_trips before trip_legs):
-- SELECT * FROM unnest(order_tables_for_restore(ARRAY['trip_legs','transport_trips'])) WITH ORDINALITY;
