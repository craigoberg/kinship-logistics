-- Link operational_escalations rows back to their originating source
-- (bus walkaround vs Day Centre Red anomaly) so the manager Claim modal,
-- consultation flow, and ledger receipts can render source-aware context.
--
-- Additive only — existing rows keep working; defaults preserve legacy
-- bus-walkaround semantics.

ALTER TABLE public.operational_escalations
  ADD COLUMN IF NOT EXISTS source_kind text NULL;

ALTER TABLE public.operational_escalations
  ADD COLUMN IF NOT EXISTS source_issue_id uuid NULL;

-- Backfill: every existing row originated from the bus walkaround flow.
UPDATE public.operational_escalations
   SET source_kind = 'bus_walkaround'
 WHERE source_kind IS NULL;

-- Composite index for the Governance/Day Centre cross-reference lookups.
CREATE INDEX IF NOT EXISTS idx_op_escalations_source
  ON public.operational_escalations (source_kind, source_issue_id);
