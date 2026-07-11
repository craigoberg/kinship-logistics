-- ============================================================================
-- 2026-07-11  Governance Hub — No-News-Is-Good-News visibility parameters
--
-- Three new system_parameters rows that control when items surface on the
-- Governance Hub Active tab vs. staying hidden until action is needed.
--
-- Idempotent — uses INSERT ... ON CONFLICT DO NOTHING so re-running is safe.
-- ============================================================================

INSERT INTO system_parameters (key, value, description)
VALUES
  (
    'compliance_hub_visibility_days',
    '60'::jsonb,
    'Days before expiry that a compliance asset first appears on the Governance Hub Active tab. Assets with expiry further away than this (and RYGE = green) are hidden. Must be wider than the yellow threshold (compliance_warning_days_default). Default: 60 days.'
  ),
  (
    'compliance_defer_rewarn_days',
    '7'::jsonb,
    'Days before a compliance asset deferral deadline expires that the item moves from the Deferred tab back to the Active tab. Ensures managers see the approaching deadline in time to act. Default: 7 days.'
  ),
  (
    'issue_defer_rewarn_days',
    '7'::jsonb,
    'Days before a deferred open issue (site issue, incident, escalation) deadline expires that it resurfaces on the Active issues tab. Managers see it in time to act before the deferral lapses. Default: 7 days.'
  )
ON CONFLICT (key) DO NOTHING;

-- Verify
SELECT key, value, description FROM system_parameters
WHERE key IN (
  'compliance_hub_visibility_days',
  'compliance_defer_rewarn_days',
  'issue_defer_rewarn_days'
)
ORDER BY key;
