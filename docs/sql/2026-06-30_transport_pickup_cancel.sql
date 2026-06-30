-- Manager SMS recipients when a driver cancels a manifest pickup (YELLOW Hub issue).
INSERT INTO public.system_parameters (key, value, description)
VALUES (
  'transport_pickup_sms_recipients',
  'null'::jsonb,
  'Comma-separated E.164 mobile numbers for pickup-cancellation SMS alerts. Falls back to attendance_red_sms_recipients, then Manager staff_registry phones.'
)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
