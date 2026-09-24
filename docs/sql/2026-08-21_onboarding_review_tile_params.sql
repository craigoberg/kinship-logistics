-- Onboarding annual review tile windows (Hub Onboarding + Dashboard Band 3)
--
-- onboarding_review_yellow_days: days before review_due_at when the tile/list
--   turns yellow. Default 30 (enough to book family + print + wet-sign).
-- onboarding_review_red_days: days remaining at which the tile turns red.
--   Default 0 = red on the due date (and overdue). Same convention as Hub
--   compliance RYGE (red when days remaining ≤ red_days).

INSERT INTO system_parameters (key, value, description)
VALUES
  ('onboarding_review_yellow_days', '30'::jsonb,
   'Days before onboarding review due when Hub / Dashboard Band 3 turn yellow'),
  ('onboarding_review_red_days', '0'::jsonb,
   'Days remaining when onboarding review turns red (0 = red on the due date)')
ON CONFLICT (key) DO NOTHING;

-- Validation — expect 2 rows:
SELECT key, value
FROM system_parameters
WHERE key IN ('onboarding_review_yellow_days', 'onboarding_review_red_days');
