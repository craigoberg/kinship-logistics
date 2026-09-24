-- ============================================================================
-- 2026-08-05 — TEST recovery: fix verify_operator_pin + seed manager PIN 1234
--
-- Use when staff_registry was wiped and Backup/restore PIN is rejected.
-- PIN for bootstrap manager: 1234
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Return ALL staff matching the PIN (not LIMIT 1) so restore can match
-- the selected manager when several people share a PIN.
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

-- Reset / insert bootstrap manager with known SHA-256("1234")
-- Hash: 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4
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

-- ---------- Validation (run these; expect rows) ----------
-- 1) Staff row + hash length 64
-- SELECT id, full_name, role, personnel_type, active, length(pin_hash) AS hash_len, pin_hash
-- FROM staff_registry WHERE full_name = 'TEST Bootstrap Manager';
--
-- 2) RPC must return that row
-- SELECT * FROM verify_operator_pin('1234');
--
-- 3) Hash self-check (both sides equal)
-- SELECT encode(digest('1234', 'sha256'), 'hex') AS expected,
--        pin_hash AS stored
-- FROM staff_registry WHERE full_name = 'TEST Bootstrap Manager';
