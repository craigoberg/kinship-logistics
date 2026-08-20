-- ============================================================
-- App ticket notify (BL-116) — dashboard inbox + Resend email
-- Created: 2026-08-19
--
-- Seeds Admin To/From for server email (not Council mailto).
-- Adds notify_email_sent_at so client POST + optional DB webhook
-- do not send twice.
--
-- "Success. No rows returned" is expected for this script (DDL/INSERT).
-- ============================================================

-- UNIQUE(key) required for ON CONFLICT (same dance as council params)
DO $$
BEGIN
  IF NOT EXISTS (
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

ALTER TABLE public.app_tickets
  ADD COLUMN IF NOT EXISTS notify_email_sent_at TIMESTAMPTZ NULL;

INSERT INTO public.system_parameters (key, value, description)
VALUES
  (
    'app_tickets.notify_to',
    '""'::jsonb,
    'Comma-separated emails pinged when someone files an App ticket. Empty = no email (Dashboard tile still shows open tickets). TEST = office inbox; not a tablet mailto.'
  ),
  (
    'app_tickets.notify_from',
    '""'::jsonb,
    'Optional Resend From address. Blank = RESEND_FROM env, else Yada Connect <onboarding@resend.dev> (Resend test sender).'
  )
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Validation (run after load — these SHOULD return rows)
--
-- 1) Params exist — expect 2 rows (values may be empty strings):
--    SELECT key, value
--    FROM public.system_parameters
--    WHERE key IN ('app_tickets.notify_to', 'app_tickets.notify_from')
--    ORDER BY 1;
--
-- 2) Column exists — expect 1 row:
--    SELECT column_name, data_type
--    FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name = 'app_tickets'
--      AND column_name = 'notify_email_sent_at';
-- ============================================================
