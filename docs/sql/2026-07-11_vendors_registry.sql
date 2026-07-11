-- 2026-07-11 — Simple vendor registry for event expense logging.
-- Names should align with MYOB supplier names for downstream export.
-- Apply via Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.vendors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  status      text NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'archived')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS vendors_name_lower_unique
  ON public.vendors (lower(trim(name)));

CREATE INDEX IF NOT EXISTS vendors_status_idx
  ON public.vendors (status);

COMMENT ON TABLE public.vendors IS
  'MYOB-aligned supplier names for event expense logging. Not a full AP ledger.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendors TO anon, authenticated;
GRANT ALL ON public.vendors TO service_role;

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendors readable" ON public.vendors;
CREATE POLICY "vendors readable"
  ON public.vendors FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "vendors writable" ON public.vendors;
CREATE POLICY "vendors writable"
  ON public.vendors FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "vendors updatable" ON public.vendors;
CREATE POLICY "vendors updatable"
  ON public.vendors FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
