-- Make verify_operator_pin() compare against SHA-256 hex hashes stored in
-- staff_registry.pin_hash. The client (staff-form-sheet + medication modal)
-- already writes pin_hash as SHA-256 hex via hashPin() in src/lib/data-store.ts.
-- The Yada terminal login (loginWithPin) sends the raw 4-digit PIN to this
-- RPC; this function hashes server-side and compares.
--
-- After applying, any legacy plaintext pin_hash rows (e.g. "1234") will stop
-- matching. Re-seed those PINs through the Staff form so they're stored as
-- SHA-256 hex.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP FUNCTION IF EXISTS public.verify_operator_pin(text);

CREATE OR REPLACE FUNCTION public.verify_operator_pin(entered_pin text)
RETURNS TABLE (
  id uuid,
  full_name text,
  role text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
  SELECT s.id, s.full_name, s.role
  FROM public.staff_registry s
  WHERE s.active = true
    AND s.pin_hash IS NOT NULL
    AND s.pin_hash = encode(digest(entered_pin, 'sha256'), 'hex')
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.verify_operator_pin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_operator_pin(text)
  TO anon, authenticated, service_role;
