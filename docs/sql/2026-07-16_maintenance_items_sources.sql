-- ============================================================
-- maintenance_items — extend source CHECK constraint
-- Created: 2026-07-16
-- Purpose: Add centre_issue and vehicle_issue source values so that
--          Day Centre walkround issues and Bus/Vehicle pre-trip issues
--          can be correctly routed to the Maintenance & Repairs HUB tab.
--
-- GUARDRAILS §14 routing rules:
--   venue_issue    → Venue walkround (Log Venue Issue)
--   centre_issue   → Day Centre walkround (Log Anomaly from site-day)
--   vehicle_issue  → Bus / Vehicle pre-trip walkround (IssueAccumulatorPanel)
--   incident_fault → Big Red Button → Equipment & Asset lane
--   manual         → Manually added from Maintenance HUB tab
-- ============================================================

-- Drop the existing CHECK constraint and widen it.
ALTER TABLE public.maintenance_items
  DROP CONSTRAINT IF EXISTS maintenance_items_source_check;

ALTER TABLE public.maintenance_items
  ADD CONSTRAINT maintenance_items_source_check
  CHECK (source IN (
    'venue_issue',
    'centre_issue',
    'vehicle_issue',
    'incident_fault',
    'manual'
  ));

-- Ensure RLS is active (permissive policies already applied by
-- 2026-07-11_maintenance_items.sql — no further grants needed).
