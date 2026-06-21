-- ============================================================================
-- 2026-06-21 — Add missing resolution/claim tracking columns to
-- operational_escalations so the reset RPC and application code can read/write
-- claimed_at, resolved_by, resolved_at, and resolution_notes.
-- ============================================================================

ALTER TABLE public.operational_escalations
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES public.staff_registry(id),
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_notes text;
