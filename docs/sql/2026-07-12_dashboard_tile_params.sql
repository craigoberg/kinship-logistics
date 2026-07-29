-- Dashboard alert tile system parameters (BL-066 expansion)
--
-- attendance_noshow_red_hours: hours past expected_arrival_at before the
--   No-Show tile escalates from yellow → red. Default 2 hours.
--   Deliberately shorter than hub_issue_warn_hours (24h) because a missing
--   person arriving by bus is a duty-of-care escalation, not a governance lag.
--
-- roll_call_grace_minutes: minutes after the evening/morning roll call
--   deadline before the Roll Call Breach tile turns red. Yellow fires
--   immediately at the deadline. Default 30 minutes.

INSERT INTO system_parameters (key, value, description)
VALUES
  ('attendance_noshow_red_hours', '2'::jsonb,
   'Hours past expected arrival before the No-Show / Missing dashboard tile turns red'),
  ('roll_call_grace_minutes',     '30'::jsonb,
   'Minutes after roll call deadline before the Roll Call Breach tile turns red')
ON CONFLICT (key) DO NOTHING;

-- Validation — expect 2 rows:
SELECT key, value
FROM system_parameters
WHERE key IN ('attendance_noshow_red_hours', 'roll_call_grace_minutes');
