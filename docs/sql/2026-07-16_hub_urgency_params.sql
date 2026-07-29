-- =============================================================================
-- Hub Urgency System Parameters + maintenance_items.last_note_at
-- 2026-07-16
-- =============================================================================
--
-- Purpose:
--   1. Add last_note_at column to maintenance_items so the active item list
--      can compute staleness without N+1 note queries.
--   2. Seed configurable urgency thresholds in system_parameters for all three
--      Governance Hub tabs: Human Issues, Maintenance, and Compliance Assets.
--
-- Idempotent: safe to re-run. Uses IF NOT EXISTS / ON CONFLICT DO NOTHING.
--
-- Post-migration validation (run after applying — see section at bottom).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. maintenance_items — track latest note timestamp on the parent row
-- ---------------------------------------------------------------------------
-- Added here so the list query can compute "time since last activity"
-- without joining maintenance_notes for every row. Updated by the app on
-- every addMaintenanceNote() call.

ALTER TABLE maintenance_items
  ADD COLUMN IF NOT EXISTS last_note_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 2. Human Issue urgency thresholds
-- ---------------------------------------------------------------------------
-- Rewarn:    issue resurfaces on Active tab 1 hour before defer deadline.
-- Yellow:    defer deadline has passed, no activity yet.
-- Red:       1 hour after defer deadline with no activity.
-- Active SLA: Yellow after 24 h without a log note, Red after 48 h.

INSERT INTO system_parameters (key, value, description) VALUES
  (
    'issue_defer_rewarn_hours',
    '1'::jsonb,
    'Hours before a deferred Human Issue deadline that the item resurfaces on the Active tab (replaces issue_defer_rewarn_days for Human Issues).'
  ),
  (
    'issue_defer_overdue_red_hours',
    '1'::jsonb,
    'Hours after a Human Issue defer deadline (with no activity) before the urgency badge turns Red / Overdue.'
  ),
  (
    'issue_active_yellow_hours',
    '24'::jsonb,
    'Hours since last log-note activity before an active (non-deferred) Human Issue shows an amber Update Due badge.'
  ),
  (
    'issue_active_red_hours',
    '48'::jsonb,
    'Hours since last log-note activity before an active (non-deferred) Human Issue shows a red Stale badge.'
  )
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Maintenance item urgency thresholds
-- ---------------------------------------------------------------------------
-- Rewarn:    item resurfaces on Active tab 7 days before defer deadline.
-- Yellow:    defer deadline has passed, no activity yet.
-- Red:       7 days after defer deadline with no activity.
-- Active SLA: Yellow after 7 days, Red after 14 days without a log note.

INSERT INTO system_parameters (key, value, description) VALUES
  (
    'maintenance_defer_rewarn_days',
    '7'::jsonb,
    'Days before a deferred Maintenance item deadline that it resurfaces on the Active tab.'
  ),
  (
    'maintenance_defer_overdue_red_days',
    '7'::jsonb,
    'Days after a Maintenance defer deadline (with no activity) before the urgency badge turns Red / Overdue.'
  ),
  (
    'maintenance_active_yellow_days',
    '7'::jsonb,
    'Days since last log-note activity before an active Maintenance item shows an amber Update Due badge.'
  ),
  (
    'maintenance_active_red_days',
    '14'::jsonb,
    'Days since last log-note activity before an active Maintenance item shows a red Stale badge.'
  )
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Compliance asset urgency thresholds
-- ---------------------------------------------------------------------------
-- Existing compliance_defer_rewarn_days (already in system_parameters) is
-- reused for the rewarn window. Three new keys added.
-- Active SLA: Yellow after 7 days, Red after 14 days without a hub log note.

INSERT INTO system_parameters (key, value, description) VALUES
  (
    'compliance_defer_overdue_red_days',
    '7'::jsonb,
    'Days after a Compliance asset defer deadline (with no activity) before the urgency badge turns Red / Overdue.'
  ),
  (
    'compliance_active_yellow_days',
    '7'::jsonb,
    'Days since last log-note activity before an active Compliance asset shows an amber Update Due badge.'
  ),
  (
    'compliance_active_red_days',
    '14'::jsonb,
    'Days since last log-note activity before an active Compliance asset shows a red Stale badge.'
  )
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- Post-migration validation
-- =============================================================================
-- "No rows returned" above is expected for DDL (ALTER TABLE) — normal.
-- Run these SELECTs to confirm the migration succeeded:

-- 1. Verify last_note_at column was added:
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'maintenance_items'
--   AND column_name = 'last_note_at';
-- Expected: 1 row — (last_note_at, timestamp with time zone)

-- 2. Verify all 11 new urgency params were seeded:
-- SELECT key, value
-- FROM system_parameters
-- WHERE key IN (
--   'issue_defer_rewarn_hours',
--   'issue_defer_overdue_red_hours',
--   'issue_active_yellow_hours',
--   'issue_active_red_hours',
--   'maintenance_defer_rewarn_days',
--   'maintenance_defer_overdue_red_days',
--   'maintenance_active_yellow_days',
--   'maintenance_active_red_days',
--   'compliance_defer_overdue_red_days',
--   'compliance_active_yellow_days',
--   'compliance_active_red_days'
-- )
-- ORDER BY key;
-- Expected: 11 rows.
