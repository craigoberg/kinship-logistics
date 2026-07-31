-- 2026-07-30 — Council escalate mailto settings (BL-062)
--
-- Run in Supabase Dashboard → SQL Editor → Run All
--
-- Admin → System Parameters → Council email panel edits these keys.
-- DEV/TEST: set To to an internal inbox. PROD: real council address.
-- From: optional shared mailbox; blank = open mailto with the signed-in account.
--
-- Idempotent. Live DB may lack UNIQUE/PK on system_parameters.key (needed for
-- ON CONFLICT) — this script adds UNIQUE (key) when missing, then seeds.

-- ---------------------------------------------------------------------------
-- 0) Ensure UNIQUE on key (ON CONFLICT requires it)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.system_parameters
    GROUP BY key
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'system_parameters has duplicate key rows — resolve duplicates before adding UNIQUE(key)';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'system_parameters'
      AND c.contype IN ('p', 'u')
      AND pg_get_constraintdef(c.oid) ILIKE '%(key)%'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'system_parameters'
      AND (
        indexdef ILIKE '%UNIQUE%(%key%)%'
        OR indexdef ILIKE '%UNIQUE% (key)%'
        OR indexdef ILIKE '%UNIQUE% ("key")%'
      )
  ) THEN
    ALTER TABLE public.system_parameters
      ADD CONSTRAINT system_parameters_key_key UNIQUE (key);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Seed Council mailto params (preserve existing values on re-run)
-- ---------------------------------------------------------------------------
INSERT INTO public.system_parameters (key, value, description)
VALUES
  (
    'site_management.council_email_to',
    '""'::jsonb,
    'Council escalate mailto recipient (To). DEV/TEST = internal inbox; PROD = council maintenance address. Empty = Hub escalate logs without opening mail.'
  ),
  (
    'site_management.council_email_from',
    '""'::jsonb,
    'Optional shared mailbox for Council escalate (From). When set, mailto includes from=. When blank, open mailto as normal (operator account).'
  ),
  (
    'site_management.council_email_template',
    jsonb_build_object(
      'subject', 'Council Maintenance Request — {severity}',
      'body', $tpl$Hello Council Maintenance,

We are logging a {severity} maintenance request from the Day Centre.

Issue: {description}
Current workaround: {workaround}
Expected resolution by (per contract SLA): {deadline}

Please confirm receipt and ETA.

Thank you,
Day Centre Operations$tpl$
    ),
    'Default subject/body for Council escalate mailto. Tokens: {severity} {description} {workaround} {deadline} {date}.'
  ),
  (
    'site_management.council_sla_hours',
    jsonb_build_object('Sev_1', 4, 'Sev_2', 24, 'Sev_3', 72),
    'Hours until Council SLA deadline by tier (Sev_1 / Sev_2 / Sev_3). Used when escalating to Council.'
  )
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Validation (expect 4 rows after apply)
-- ---------------------------------------------------------------------------
-- SELECT key, value, left(description, 80) AS description
-- FROM public.system_parameters
-- WHERE key IN (
--   'site_management.council_email_to',
--   'site_management.council_email_from',
--   'site_management.council_email_template',
--   'site_management.council_sla_hours'
-- )
-- ORDER BY key;
