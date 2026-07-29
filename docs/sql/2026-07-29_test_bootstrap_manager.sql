-- ============================================================================
-- 2026-07-29 — TEST only: one manager so you can log in + Admin restore
-- before the JSON backup is loaded (chicken-and-egg on empty TEST).
--
-- PIN: 1234 (change after restore / do not use on PROD)
-- Email: set to the address you will use for Supabase Auth day-login.
-- After restore, staff_registry is overwritten; create Auth users to match
-- restored staff emails. You can delete this bootstrap row by restoring.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO public.staff_registry (
  full_name,
  role,
  pin_hash,
  active,
  email
)
SELECT
  'TEST Bootstrap Manager',
  'manager',
  encode(digest('1234', 'sha256'), 'hex'),
  true,
  'REPLACE_WITH_YOUR_DAY_LOGIN_EMAIL@yada.org.au'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.staff_registry s
  WHERE s.email = 'REPLACE_WITH_YOUR_DAY_LOGIN_EMAIL@yada.org.au'
);
