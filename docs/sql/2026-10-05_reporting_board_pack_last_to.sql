-- Remember the last To date printed on the centre and trips board pack.
-- Next open starts the day after this date. Idempotent. Does not change other keys.
--
-- "Success. No rows returned" is expected (insert only).

INSERT INTO public.system_parameters (key, value, description)
VALUES (
  'reporting_board_pack_last_to',
  'null'::jsonb,
  'Last end date (YYYY-MM-DD) printed on the centre and trips board pack. The next report starts the day after.'
)
ON CONFLICT (key) DO NOTHING;

-- Validation — expect 1 row. value is null until someone prints.
-- SELECT key, value, description
-- FROM public.system_parameters
-- WHERE key = 'reporting_board_pack_last_to';
