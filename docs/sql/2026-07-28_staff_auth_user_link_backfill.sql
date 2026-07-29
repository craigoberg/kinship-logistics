-- ============================================================
-- 2026-07-28 — Link staff_registry ↔ auth.users (thin day login)
-- ============================================================
-- Idempotent email backfill for BL-099 day session.
-- Create Auth users in Dashboard with the same email as staff_registry.
-- Then run this so auth_user_id is populated (is_manager / attribution).
-- ============================================================

ALTER TABLE public.staff_registry
  ADD COLUMN IF NOT EXISTS auth_user_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS staff_registry_auth_user_id_uidx
  ON public.staff_registry (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

UPDATE public.staff_registry s
SET auth_user_id = u.id
FROM auth.users u
WHERE s.auth_user_id IS NULL
  AND s.email IS NOT NULL
  AND lower(trim(s.email)) = lower(trim(u.email))
  AND NOT EXISTS (
    SELECT 1 FROM public.staff_registry s2
    WHERE s2.auth_user_id = u.id AND s2.id <> s.id
  );

-- Validation (expect rows for linked staff):
--   SELECT full_name, email, auth_user_id
--   FROM public.staff_registry
--   WHERE auth_user_id IS NOT NULL
--   ORDER BY full_name;
