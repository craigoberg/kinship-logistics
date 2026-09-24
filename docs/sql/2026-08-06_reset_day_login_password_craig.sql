-- ============================================================
-- 2026-08-06 — Reset day-login password (craig@yada.org.au)
-- ============================================================
-- DEV: sryicqtigvfmbsiacqbp
-- Use when Dashboard "reset email" redirects to localhost and
-- you cannot set the password in the Auth UI.
--
-- BEFORE RUN: replace REPLACE_WITH_NEW_PASSWORD below with a
-- temporary password you will type at day login. Do not commit
-- a real password into git.
-- ============================================================

-- pgcrypto (crypt / gen_salt) — usually already enabled on Supabase
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
DECLARE
  v_email text := 'craig@yada.org.au';
  -- >>> CHANGE THIS before running <<<
  v_new_password text := 'REPLACE_WITH_NEW_PASSWORD';
  v_user_id uuid;
  v_updated int;
BEGIN
  IF v_new_password IS NULL
     OR length(trim(v_new_password)) < 8
     OR v_new_password = 'REPLACE_WITH_NEW_PASSWORD' THEN
    RAISE EXCEPTION
      'Set v_new_password to a real temporary password (min 8 chars) before running.';
  END IF;

  SELECT id
  INTO v_user_id
  FROM auth.users
  WHERE lower(trim(email)) = lower(trim(v_email))
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No auth.users row for %', v_email;
  END IF;

  UPDATE auth.users
  SET
    encrypted_password = extensions.crypt(v_new_password, extensions.gen_salt('bf')),
    email_confirmed_at = COALESCE(email_confirmed_at, now()),
    recovery_token = '',
    recovery_sent_at = NULL,
    email_change = '',
    email_change_token_new = '',
    email_change_token_current = '',
    confirmation_token = '',
    updated_at = now()
  WHERE id = v_user_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'Password reset for % (id=%); rows updated=%',
    v_email, v_user_id, v_updated;

  -- Drop existing sessions so old tokens cannot linger
  DELETE FROM auth.sessions WHERE user_id = v_user_id;
  DELETE FROM auth.refresh_tokens WHERE user_id = v_user_id::text;
END $$;

-- ============================================================
-- Validation (expect 1 row; password hash itself is not readable)
-- ============================================================
-- SELECT id, email, email_confirmed_at, updated_at,
--        (encrypted_password IS NOT NULL AND length(encrypted_password) > 20) AS has_password_hash
-- FROM auth.users
-- WHERE lower(email) = 'craig@yada.org.au';
--
-- Optional staff link check (expect auth_user_id match):
-- SELECT full_name, email, auth_user_id, active
-- FROM public.staff_registry
-- WHERE lower(email) = 'craig@yada.org.au';
