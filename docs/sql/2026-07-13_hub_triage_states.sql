-- 2026-07-13 Hub Triage States & Append-Only Timeline
--
-- Extends site_issues_register so the Governance Hub can:
--   1. Defer issues to a future "next action" date (drops off active list).
--   2. Escalate to Council with a Council Severity (drops off active list).
--   3. Maintain an append-only timeline of update notes (atomic optimistic
--      concurrency append, see appendUpdateNote in src/lib/api/unified-issues.ts).
--
-- All columns use ADD COLUMN IF NOT EXISTS so the migration is idempotent.

ALTER TABLE public.site_issues_register
  ADD COLUMN IF NOT EXISTS update_log        text        NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS deferred_until    timestamptz,
  ADD COLUMN IF NOT EXISTS council_severity  text;

-- Status vocabulary is plain text (no CHECK constraint added) so existing
-- rows ("open", "resolved") keep working and the new values
-- ("deferred", "awaiting_external") can be introduced without a migration
-- backfill.

COMMENT ON COLUMN public.site_issues_register.update_log IS
  'Append-only timeline. Format per entry: "\n\n[DD-MM-YYYY HH:MM] Staff Name: text". Mutated only via appendUpdateNote() with .eq(update_log, priorLog) optimistic concurrency.';
COMMENT ON COLUMN public.site_issues_register.deferred_until IS
  'When set with status=deferred, the row drops off the active Hub list until this timestamp.';
COMMENT ON COLUMN public.site_issues_register.council_severity IS
  'Council third-party priority designation (Sev 1..Sev 4) set when status=awaiting_external.';

-- Re-affirm Data API grants (public-schema-grants rule).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_issues_register TO authenticated;
GRANT ALL ON public.site_issues_register TO service_role;
