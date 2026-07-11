-- 2026-07-11 — Fix vendors RLS for anon (PIN / field staff sessions).
-- Run this if you already applied 2026-07-11_vendors_registry.sql and get 401 on save.
--
-- The app uses the anon role for most writes (same pattern as venues, transport_assets).

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendors TO anon, authenticated;

DROP POLICY IF EXISTS "vendors writable" ON public.vendors;
CREATE POLICY "vendors writable"
  ON public.vendors FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "vendors updatable" ON public.vendors;
CREATE POLICY "vendors updatable"
  ON public.vendors FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
