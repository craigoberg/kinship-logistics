-- Emergency retest reset for a double-login claim collision on Day Centre Red.
--
-- Default usage (lifts the lock and returns the Day Centre to active_day):
--   SELECT * FROM public.reset_active_site_day_red_escalation();
--
-- To keep the current Red screen locked but make the escalation claimable again:
--   SELECT * FROM public.reset_active_site_day_red_escalation('escalated_lock');

DROP FUNCTION IF EXISTS public.reset_active_site_day_red_escalation(text);

ALTER TABLE public.operational_escalations
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES public.staff_registry(id),
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_notes text;

CREATE OR REPLACE FUNCTION public.reset_active_site_day_red_escalation(
  p_session_phase text DEFAULT 'active_day'
)
RETURNS TABLE (
  escalation_id uuid,
  previous_escalation_status text,
  new_escalation_status text,
  previous_claimed_by uuid,
  previous_claimed_at timestamptz,
  session_id uuid,
  previous_session_phase text,
  new_session_phase text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_escalation_id uuid;
  v_previous_escalation_status text;
  v_previous_claimed_by uuid;
  v_previous_claimed_at timestamptz;
  v_session_id uuid;
  v_previous_session_phase text;
BEGIN
  IF p_session_phase NOT IN (
    'open_pending',
    'active_day',
    'escalated_lock',
    'closed_orderly',
    'closed_no_go'
  ) THEN
    RAISE EXCEPTION 'Invalid site_day_sessions phase: %', p_session_phase;
  END IF;

  SELECT e.id,
         e.status::text,
         e.claimed_by,
         e.claimed_at
    INTO v_escalation_id,
         v_previous_escalation_status,
         v_previous_claimed_by,
         v_previous_claimed_at
    FROM public.operational_escalations e
   WHERE (e.source_kind = 'site_day_red' OR e.gate_id = 'site_day_red')
     AND e.status IN ('pending', 'claimed')
   ORDER BY
     CASE WHEN e.status = 'claimed' THEN 0 ELSE 1 END,
     e.created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF v_escalation_id IS NULL THEN
    RAISE EXCEPTION 'No active site_day_red escalation found.';
  END IF;

  UPDATE public.operational_escalations e
     SET status = 'pending',
         claimed_by = NULL,
         claimed_at = NULL,
         resolved_by = NULL,
         resolved_at = NULL,
         resolution_notes = NULL
   WHERE e.id = v_escalation_id;

  SELECT s.id,
         s.phase::text
    INTO v_session_id,
         v_previous_session_phase
    FROM public.site_day_sessions s
   WHERE s.phase IN ('escalated_lock', 'active_day', 'open_pending')
   ORDER BY
     CASE WHEN s.phase = 'escalated_lock' THEN 0 ELSE 1 END,
     s.session_date DESC,
     s.updated_at DESC
   LIMIT 1
   FOR UPDATE;

  IF v_session_id IS NOT NULL THEN
    UPDATE public.site_day_sessions s
       SET phase = p_session_phase,
           manager_plan_text = NULL,
           manager_decision = NULL,
           manager_auth_staff_id = NULL,
           manager_auth_at = NULL,
           leader_decision = NULL,
           leader_auth_staff_id = NULL,
           leader_auth_at = NULL,
           closed_by_id = CASE
             WHEN p_session_phase IN ('open_pending', 'active_day', 'escalated_lock')
               THEN NULL
             ELSE s.closed_by_id
           END,
           close_declared_at = CASE
             WHEN p_session_phase IN ('open_pending', 'active_day', 'escalated_lock')
               THEN NULL
             ELSE s.close_declared_at
           END,
           close_leader_notes = CASE
             WHEN p_session_phase IN ('open_pending', 'active_day', 'escalated_lock')
               THEN NULL
             ELSE s.close_leader_notes
           END
     WHERE s.id = v_session_id;
  END IF;

  RETURN QUERY
  SELECT v_escalation_id,
         v_previous_escalation_status,
         'pending'::text,
         v_previous_claimed_by,
         v_previous_claimed_at,
         v_session_id,
         v_previous_session_phase,
         CASE WHEN v_session_id IS NULL THEN NULL ELSE p_session_phase END;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_active_site_day_red_escalation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_active_site_day_red_escalation(text) TO service_role;