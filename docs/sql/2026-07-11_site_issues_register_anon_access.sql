-- 2026-07-11 — site_issues_register: anon access + event-day context columns
--
-- Run in Supabase Dashboard → SQL Editor → Run All
--
-- Fixes:
--   • Active Issues Register in Trip Days returns empty / spins (no anon SELECT grant)
--   • Event-day issues can be written but not read back by anon key sessions
--   • Ensures event_id + event_day_session_id columns exist (Phase 5 — idempotent)
--   • Ensures indexes exist for event-scoped lookups
--   • Ensures session_id is nullable (event-day issues set it to null)
--
-- All policies are permissive (true). App auth is enforced at the PIN session
-- layer, not at the DB row level. This matches every other operational table.

-- ─── 1. Nullable session_id (idempotent) ─────────────────────────────────────
ALTER TABLE public.site_issues_register
  ALTER COLUMN session_id DROP NOT NULL;

-- ─── 2. Event context columns (idempotent) ───────────────────────────────────
ALTER TABLE public.site_issues_register
  ADD COLUMN IF NOT EXISTS event_id             uuid REFERENCES public.event_manifest(id)     ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_day_session_id uuid REFERENCES public.event_day_sessions(id) ON DELETE SET NULL;

-- ─── 3. Indexes for event-scoped lookups ────────────────────────────────────
CREATE INDEX IF NOT EXISTS site_issues_register_event_id_idx
  ON public.site_issues_register (event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS site_issues_register_event_day_session_idx
  ON public.site_issues_register (event_day_session_id)
  WHERE event_day_session_id IS NOT NULL;

-- ─── 4. Grants — add anon alongside authenticated ───────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_issues_register TO anon, authenticated;
GRANT ALL                            ON public.site_issues_register TO service_role;

-- ─── 5. Permissive RLS policies for anon ────────────────────────────────────
-- Drop any restrictive leftovers first.
DROP POLICY IF EXISTS "site_issues_register readable"  ON public.site_issues_register;
DROP POLICY IF EXISTS "site_issues_register writable"  ON public.site_issues_register;
DROP POLICY IF EXISTS "site_issues_register updatable" ON public.site_issues_register;

-- Recreate as permissive for both anon and authenticated.
-- App-level auth (PIN sessions) gates who can reach these screens.
CREATE POLICY "site_issues_register readable"
  ON public.site_issues_register
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "site_issues_register writable"
  ON public.site_issues_register
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "site_issues_register updatable"
  ON public.site_issues_register
  FOR UPDATE TO anon, authenticated
  USING (true) WITH CHECK (true);

-- ─── 6. Reload PostgREST schema cache ───────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ─── 7. Verification — should return at least one row for your test issue ───
SELECT id, severity, issue_description, event_day_session_id, status, created_at
FROM public.site_issues_register
WHERE event_day_session_id IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;
