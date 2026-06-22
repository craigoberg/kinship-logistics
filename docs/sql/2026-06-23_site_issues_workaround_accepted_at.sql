-- 2026-06-23 — site_issues_register.workaround_accepted_at
-- Adds a dedicated timestamp marking when a workaround was agreed:
--   RED   → set when the Opener accepts the Manager's GO proposal
--           (acceptEscalationWorkaround in src/lib/data-store.ts)
--   YELLOW→ set at issue creation when a workaround_plan is supplied
--           (createIssue in src/lib/api/site-issues.ts)
--
-- Powers the live "Workaround active — HH:MM:SS" timer on the lock banner
-- and the static "On workaround" / "Total time" summary once resolved.

ALTER TABLE public.site_issues_register
  ADD COLUMN IF NOT EXISTS workaround_accepted_at timestamptz;

-- Backfill: existing rows already at 'workaround_accepted' get a best-effort
-- value so historical timers aren't NULL on day-one.
UPDATE public.site_issues_register
   SET workaround_accepted_at = COALESCE(workaround_accepted_at, created_at)
 WHERE status = 'workaround_accepted'
   AND workaround_accepted_at IS NULL;
