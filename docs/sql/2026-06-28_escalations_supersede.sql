-- Allow the Unground workflow to mark older grounded escalations as
-- 'resolved_superseded' so the coordinator dashboard only surfaces the
-- latest active denial per vehicle. The anon UPDATE policy previously
-- restricted USING to pending/claimed only, which blocked any update to
-- already-resolved rows.

DROP POLICY IF EXISTS "anon can update active escalations"
  ON public.operational_escalations;

CREATE POLICY "anon can update active escalations"
  ON public.operational_escalations
  FOR UPDATE
  TO anon
  USING (status IN ('pending', 'claimed', 'resolved_denied'))
  WITH CHECK (status IN (
    'claimed',
    'resolved_approved',
    'resolved_denied',
    'resolved_superseded'
  ));
