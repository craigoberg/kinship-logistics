-- 2026-07-16 Phase 5 — Event context columns on site_issues_register
--
-- §12.6: Issues raised from an event day coordinator screen must carry
-- event_id and event_day_session_id so the ActiveIssuesRegister can filter
-- to the relevant outing and trip report can surface them.
--
-- session_id is made nullable so outing issues are not forced to carry a
-- site_day_sessions row (which is a Day Centre concept). Existing Day Centre
-- rows are unaffected — they retain their session_id values.

-- 1. Make session_id nullable (was implicitly NOT NULL via FK behaviour).
ALTER TABLE public.site_issues_register
  ALTER COLUMN session_id DROP NOT NULL;

-- 2. Add event context FK columns.
ALTER TABLE public.site_issues_register
  ADD COLUMN IF NOT EXISTS event_id             uuid REFERENCES public.event_manifest(id)     ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_day_session_id uuid REFERENCES public.event_day_sessions(id) ON DELETE SET NULL;

-- 3. Indexes for event-scoped lookups.
CREATE INDEX IF NOT EXISTS site_issues_register_event_id_idx
  ON public.site_issues_register (event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS site_issues_register_event_day_session_idx
  ON public.site_issues_register (event_day_session_id)
  WHERE event_day_session_id IS NOT NULL;

-- 4. Comments.
COMMENT ON COLUMN public.site_issues_register.event_id IS
  'Set for issues raised in outing event context (§12.6). NULL for Day Centre issues.';
COMMENT ON COLUMN public.site_issues_register.event_day_session_id IS
  'Set for issues raised within a specific outing day session (§12.6).';

-- 5. Re-affirm grants.
GRANT SELECT, INSERT, UPDATE ON public.site_issues_register TO authenticated;
GRANT ALL ON public.site_issues_register TO service_role;
