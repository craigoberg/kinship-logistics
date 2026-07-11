-- ============================================================================
-- 2026-07-11  Venue annual compliance assets
--
-- Creates one compliance_asset per active venue with:
--   type  = 'venue_annual_review'
--   expiry = venue.created_at + 1 year
--   yellow = 60 days  /  red = 14 days
--
-- Idempotent — skips venues that already have an active venue_annual_review
-- asset. Safe to re-run.
-- ============================================================================

INSERT INTO compliance_assets (
    category,
    type,
    name,
    description,
    subject_table,
    subject_id,
    expiry_date,
    next_action_at,
    action_module,
    config,
    status,
    created_by
)
SELECT
    'VENUE'                                                       AS category,
    'venue_annual_review'                                         AS type,
    'Annual Safety Review — ' || v.name                          AS name,
    'Annual baseline sign-off required for ' || v.name ||
    '. Must be renewed each year by a manager completing a new physical baseline review.'
                                                                  AS description,
    'venues'                                                      AS subject_table,
    v.id                                                          AS subject_id,
    (v.created_at::date + interval '1 year')::date               AS expiry_date,
    NULL                                                          AS next_action_at,
    'generic_resolve'                                             AS action_module,
    jsonb_build_object(
        'yellow_days', 60,
        'red_days',    14,
        'handshake',   'single'
    )                                                             AS config,
    'active'                                                      AS status,
    v.created_by_staff_id                                         AS created_by
FROM venues v
WHERE v.status = 'active'
  AND NOT EXISTS (
      SELECT 1
        FROM compliance_assets ca
       WHERE ca.subject_table = 'venues'
         AND ca.subject_id    = v.id
         AND ca.type          = 'venue_annual_review'
         AND ca.status        = 'active'
  );

-- Verify: show created assets for review
SELECT
    ca.id,
    v.name         AS venue,
    ca.expiry_date,
    ca.status
FROM compliance_assets ca
JOIN venues v ON v.id = ca.subject_id
WHERE ca.subject_table = 'venues'
  AND ca.type          = 'venue_annual_review'
ORDER BY ca.expiry_date;
