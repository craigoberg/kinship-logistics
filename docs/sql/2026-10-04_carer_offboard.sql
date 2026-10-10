-- =============================================================================
-- 2026-10-04 — Carer off-board and primary-contact history
-- =============================================================================
--
-- A carer can leave. The client keeps a record of who the contact was and
-- the dates they were linked. Off-board is a manager action in the app.
--
-- "Success. No rows returned" is expected.
--
-- Validation — expect both names, and open_terms at least 1:
--   SELECT to_regclass('public.carer_client_terms') AS terms,
--          (SELECT count(*) FROM public.carer_client_terms WHERE ended_at IS NULL) AS open_terms;
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'carers_registry'
--      AND column_name IN ('exited_at', 'exit_reason');
-- =============================================================================

ALTER TABLE public.carers_registry
  ADD COLUMN IF NOT EXISTS exited_at timestamptz,
  ADD COLUMN IF NOT EXISTS exited_by_id uuid REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS exit_reason text,
  ADD COLUMN IF NOT EXISTS exit_notes text;

CREATE TABLE IF NOT EXISTS public.carer_client_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carer_id uuid NOT NULL REFERENCES public.carers_registry(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  was_primary boolean NOT NULL DEFAULT false,
  end_reason text
);

CREATE INDEX IF NOT EXISTS carer_client_terms_participant_idx
  ON public.carer_client_terms (participant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS carer_client_terms_carer_idx
  ON public.carer_client_terms (carer_id, started_at DESC);

INSERT INTO public.carer_client_terms (carer_id, participant_id, started_at, was_primary)
SELECT c.id, c.participant_id, coalesce(c.created_at, now()), coalesce(c.is_primary_contact, false)
  FROM public.carers_registry c
 WHERE c.participant_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.carer_client_terms t
      WHERE t.carer_id = c.id AND t.participant_id = c.participant_id AND t.ended_at IS NULL
   );

ALTER TABLE public.carer_client_terms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.carer_client_terms FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.carer_client_terms TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.carer_client_terms TO service_role;
DROP POLICY IF EXISTS kinship_authenticated_all_carer_client_terms ON public.carer_client_terms;
CREATE POLICY kinship_authenticated_all_carer_client_terms
  ON public.carer_client_terms FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
