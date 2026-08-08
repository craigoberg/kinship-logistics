-- ============================================================================
-- 2026-08-05 — DEV structure dump queries (run on DEV, paste JSON results back)
--
-- Purpose: finish DEV↔TEST structural parity beyond columns/constraints/indexes.
-- Run each query separately in Supabase SQL Editor → download/copy JSON.
-- ============================================================================

-- =============================================================================
-- A) ENUMS (public)
-- =============================================================================
SELECT
  t.typname AS enum_name,
  e.enumlabel AS enum_value,
  e.enumsortorder AS sort_order
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
ORDER BY t.typname, e.enumsortorder;

-- =============================================================================
-- B) FUNCTIONS / RPCs in public (definitions)
--     Paste as functions.json — may be large
-- =============================================================================
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS args,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
ORDER BY p.proname, 2;

-- =============================================================================
-- C) TRIGGERS on public tables
-- =============================================================================
SELECT
  c.relname AS table_name,
  t.tgname AS trigger_name,
  pg_get_triggerdef(t.oid, true) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

-- =============================================================================
-- D) RLS policies on public tables
-- =============================================================================
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- =============================================================================
-- E) Columns with udt_name (better than data_type alone for enums)
--     Optional refresh of columns.json
-- =============================================================================
SELECT
  table_name,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
