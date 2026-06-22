-- 2026-07-09_escalations_operator_ack.sql
-- Adds the three-phase operator-acknowledgment columns to operational_escalations.
--
-- Phase model (single rail — applies to both Manifest/Pre-Trip and Day Centre):
--   pending / claimed                           → office still working it
--   resolved_approved AND operator_ack IS NULL  → manager approved; the on-site
--                                                 operator (driver OR opener)
--                                                 must still confirm before the
--                                                 shield drops
--   resolved_approved AND operator_ack NOT NULL → fully closed
--
-- Naming is deliberately generic ("operator") so the same column serves both
-- the driver (bus walkaround) and the opener (site day) flows.
--
-- Idempotent. Safe to re-run.

ALTER TABLE public.operational_escalations
  ADD COLUMN IF NOT EXISTS operator_acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS operator_acknowledged_by uuid REFERENCES public.staff_registry(id);

-- Force PostgREST to pick up the new columns immediately.
NOTIFY pgrst, 'reload schema';
