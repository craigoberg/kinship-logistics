-- ============================================================================
-- 2026-06-21 — Emergency one-shot Day Centre retest unlock
--
-- Use this when the active Day Centre is still showing:
--   "Site Locked" / "claimed by Craig"
--
-- This script:
--   1. Ensures the escalation resolution columns exist.
--   2. Finds the latest active site_day_red escalation.
--   3. Sets it back to pending and clears claimed_by.
--   4. Resets the linked active Day Centre session out of escalated_lock.
-- ============================================================================

BEGIN;

ALTER TABLE public.operational_escalations
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES public.staff_registry(id),
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_notes text;

WITH target_escalation AS (
  SELECT e.id,
         e.source_issue_id
    FROM public.operational_escalations e
   WHERE (e.source_kind = 'site_day_red' OR e.gate_id = 'site_day_red')
     AND e.status IN ('pending', 'claimed')
   ORDER BY
     CASE WHEN e.status = 'claimed' THEN 0 ELSE 1 END,
     e.created_at DESC
   LIMIT 1
), reset_escalation AS (
  UPDATE public.operational_escalations e
     SET status = 'pending',
         claimed_by = NULL,
         claimed_at = NULL,
         resolved_by = NULL,
         resolved_at = NULL,
         resolution_notes = NULL,
         updated_at = now()
    FROM target_escalation te
   WHERE e.id = te.id
   RETURNING e.id, te.source_issue_id
), target_session AS (
  SELECT s.id
    FROM reset_escalation re
    JOIN public.site_issues_register i ON i.id = re.source_issue_id
    JOIN public.site_day_sessions s ON s.id = i.session_id
   LIMIT 1
), reset_session AS (
  UPDATE public.site_day_sessions s
     SET phase = 'active_day',
         manager_plan_text = NULL,
         manager_decision = NULL,
         manager_auth_staff_id = NULL,
         manager_auth_at = NULL,
         leader_decision = NULL,
         leader_auth_staff_id = NULL,
         leader_auth_at = NULL,
         closed_by_id = NULL,
         close_declared_at = NULL,
         close_leader_notes = NULL,
         updated_at = now()
    FROM target_session ts
   WHERE s.id = ts.id
   RETURNING s.id, s.phase
)
SELECT re.id AS reset_escalation_id,
       rs.id AS reset_session_id,
       rs.phase AS new_session_phase
  FROM reset_escalation re
  LEFT JOIN reset_session rs ON true;

COMMIT;