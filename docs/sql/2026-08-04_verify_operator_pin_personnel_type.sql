-- =============================================================================
-- 2026-08-04 — verify_operator_pin also returns personnel_type
-- =============================================================================
--
-- Login classifies terminal access from SYSTEM ACCESS LEVEL (personnel_type)
-- first, then falls back to role/title. Without personnel_type in the RPC
-- payload, free-text titles like "Driver" used to fail PIN login when
-- classifyRole only recognised support_worker.
--
-- Idempotent. Run on TEST (and DEV) before/with the app deploy that prefers
-- personnel_type in loginWithPin.
--
-- "Success. No rows returned" is normal for CREATE OR REPLACE.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
    AND s.pin_hash = encode(digest(entered_pin, 'sha256'), 'hex')
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.verify_operator_pin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_operator_pin(text)
  TO anon, authenticated, service_role;

-- Validation (expect 1 row):
-- SELECT proname, pg_get_function_result(oid)
-- FROM pg_proc
-- WHERE proname = 'verify_operator_pin'
--   AND pronamespace = 'public'::regnamespace;
-- Expect result text to include personnel_type.
