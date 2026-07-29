-- Fix typo'd compliance_assets category: INSRUANCE → INSURANCE
-- Live DB probe (2026-07-12) confirmed 1 row with category = 'INSRUANCE'.
-- Idempotent: UPDATE only affects rows that still carry the old value.

UPDATE compliance_assets
SET category = 'INSURANCE'
WHERE category = 'INSRUANCE';

-- Validation — expect all insurance rows to show category = 'INSURANCE', none 'INSRUANCE':
SELECT id, name, category
FROM compliance_assets
WHERE category IN ('INSURANCE', 'INSRUANCE')
ORDER BY category, name;
