-- =============================================================================
-- 2026-10-03 — Go-live PIN login
-- =============================================================================
--
-- PIN first:
--   Driver, support worker, volunteer, carer — unique PIN mints their session.
--   Manager / Assistant Manager — same PIN, then that person's email + password.
--
-- Pepper for pin_lookup lives in the app server env PIN_PEPPER, not in the
-- database and not in the browser. Existing 4-digit SHA-256 hashes stay until
-- that person signs in and chooses a 6-digit PIN.
--
-- "Success. No rows returned" is normal (DDL, grants, seeds).
--
-- Validation — expect 3 parameter rows:
--   SELECT key, value FROM public.system_parameters
--   WHERE key IN (
--     'auth_pin_max_attempts',
--     'auth_pin_device_max_attempts',
--     'auth_pin_device_lock_minutes'
--   );
--
-- Validation — expect pin columns on both registers:
--   SELECT column_name, table_name
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name IN ('staff_registry', 'carers_registry')
--     AND column_name IN (
--       'pin_lookup', 'pin_digits', 'pin_failed_count', 'pin_locked_at', 'auth_user_id'
--     )
--   ORDER BY table_name, column_name;
--   Staff should show 4 columns (auth_user_id already existed). Carers should show 5.
--
-- Validation — verify_operator_pin must NOT be executable by anon:
--   SELECT grantee, privilege_type
--   FROM information_schema.routine_privileges
--   WHERE routine_schema = 'public'
--     AND routine_name = 'verify_operator_pin'
--     AND grantee IN ('anon', 'authenticated');
--   Expect no rows.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.staff_registry
  ADD COLUMN IF NOT EXISTS pin_lookup text,
  ADD COLUMN IF NOT EXISTS pin_digits smallint,
  ADD COLUMN IF NOT EXISTS pin_failed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_at timestamptz;

ALTER TABLE public.carers_registry
  ADD COLUMN IF NOT EXISTS pin_hash text,
  ADD COLUMN IF NOT EXISTS pin_lookup text,
  ADD COLUMN IF NOT EXISTS pin_digits smallint,
  ADD COLUMN IF NOT EXISTS pin_failed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS auth_user_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'carers_registry_auth_user_id_fkey'
  ) THEN
    ALTER TABLE public.carers_registry
      ADD CONSTRAINT carers_registry_auth_user_id_fkey
      FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS staff_registry_pin_lookup_uidx
  ON public.staff_registry (pin_lookup)
  WHERE pin_lookup IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS carers_registry_pin_lookup_uidx
  ON public.carers_registry (pin_lookup)
  WHERE pin_lookup IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS carers_registry_auth_user_id_key
  ON public.carers_registry (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- Legacy unsalted SHA-256 (64 hex chars). Bcrypt leftovers are not treated as a 4-digit login.
UPDATE public.staff_registry
   SET pin_digits = 4
 WHERE pin_lookup IS NULL
   AND pin_digits IS NULL
   AND pin_hash ~ '^[0-9a-fA-F]{64}$';

CREATE TABLE IF NOT EXISTS public.pin_pad_lockouts (
  scope_key text PRIMARY KEY,
  fail_count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz
);

ALTER TABLE public.pin_pad_lockouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pin_pad_lockouts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.pin_pad_lockouts TO service_role;

INSERT INTO public.system_parameters (key, value, description)
VALUES
  (
    'auth_pin_max_attempts',
    '5'::jsonb,
    'Wrong PIN attempts against a known person before that PIN locks until a manager unlocks it.'
  ),
  (
    'auth_pin_device_max_attempts',
    '8'::jsonb,
    'Wrong codes on the PIN pad (this tablet or IP) before the pad sleeps.'
  ),
  (
    'auth_pin_device_lock_minutes',
    '15'::jsonb,
    'Minutes the PIN pad stays asleep after too many wrong codes.'
  )
ON CONFLICT (key) DO NOTHING;

-- Global "whose PIN is this" lookup is retired. Named checks and sign-in run
-- on the app server, which holds PIN_PEPPER.
CREATE OR REPLACE FUNCTION public.verify_operator_pin(entered_pin text)
RETURNS TABLE (
  id uuid,
  full_name text,
  role text,
  personnel_type text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'verify_operator_pin is retired. Sign in with the PIN pad or manager login.';
END;
$$;

REVOKE ALL ON FUNCTION public.verify_operator_pin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_operator_pin(text) FROM anon;
REVOKE ALL ON FUNCTION public.verify_operator_pin(text) FROM authenticated;

CREATE OR REPLACE FUNCTION public.verify_staff_pin(_staff_id uuid, _pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'verify_staff_pin is retired. PIN checks run on the app server.';
END;
$$;

REVOKE ALL ON FUNCTION public.verify_staff_pin(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_staff_pin(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.verify_staff_pin(uuid, text) FROM authenticated;

NOTIFY pgrst, 'reload schema';
