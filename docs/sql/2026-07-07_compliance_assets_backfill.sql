-- Backfill compliance_assets from existing transport_assets + staff_registry.
-- Idempotent: re-runnable safely via WHERE NOT EXISTS guards.
-- Run AFTER docs/sql/2026-07-06_compliance_governance.sql.

-- ---------------------------------------------------------------------------
-- VEHICLE REGO
-- ---------------------------------------------------------------------------
INSERT INTO public.compliance_assets (
  category, type, name, description,
  subject_table, subject_id,
  expiry_date, action_module, config, status
)
SELECT
  'VEHICLE',
  'rego',
  format('%s (%s) — Registration', a.name, coalesce(a.rego_plate, '—')),
  'Vehicle registration renewal — auto-backfilled from transport_assets.',
  'transport_assets',
  a.id,
  a.registration_expiry,
  'vehicle_rego',
  jsonb_build_object(
    'yellow_days',
      coalesce((SELECT (value)::text::int FROM public.system_parameters WHERE key = 'rego_threshold_days'), 30),
    'red_days', 7,
    'handshake', 'single',
    'backfilled', true
  ),
  'active'
FROM public.transport_assets a
WHERE a.is_active = true
  AND a.registration_expiry IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.compliance_assets c
     WHERE c.subject_table = 'transport_assets'
       AND c.subject_id = a.id
       AND c.type = 'rego'
  );

-- ---------------------------------------------------------------------------
-- VEHICLE SERVICE — surface only when last_service_date is known so RYGE
-- has something to anchor to. expiry_date = last_service_date + 365d as a
-- coarse default; Managers can refine via the Governance Hub.
-- ---------------------------------------------------------------------------
INSERT INTO public.compliance_assets (
  category, type, name, description,
  subject_table, subject_id,
  expiry_date, action_module, config, status
)
SELECT
  'VEHICLE',
  'service',
  format('%s (%s) — Scheduled Service', a.name, coalesce(a.rego_plate, '—')),
  'Scheduled vehicle service — auto-backfilled from transport_assets.last_service_date.',
  'transport_assets',
  a.id,
  (a.last_service_date::date + interval '365 days')::date,
  'vehicle_service',
  jsonb_build_object(
    'yellow_days', 30,
    'red_days', 7,
    'handshake', 'single',
    'backfilled', true,
    'service_interval_km', a.service_interval_km
  ),
  'active'
FROM public.transport_assets a
WHERE a.is_active = true
  AND a.last_service_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.compliance_assets c
     WHERE c.subject_table = 'transport_assets'
       AND c.subject_id = a.id
       AND c.type = 'service'
  );

-- ---------------------------------------------------------------------------
-- STAFF CERTIFICATIONS — one row per (staff, cert) with an expiry.
-- ---------------------------------------------------------------------------
INSERT INTO public.compliance_assets (
  category, type, name, description,
  subject_table, subject_id,
  expiry_date, action_module, config, status
)
SELECT
  'STAFF',
  'certification',
  format('%s · %s', s.full_name, coalesce(cert->>'name', 'Certification')),
  'Staff certification renewal — auto-backfilled from staff_registry.certifications.',
  'staff_registry',
  s.id,
  nullif(cert->>'expiry', '')::date,
  'staff_cert',
  jsonb_build_object(
    'yellow_days',
      coalesce((SELECT (value)::text::int FROM public.system_parameters WHERE key = 'cert_threshold_days'), 30),
    'red_days', 7,
    'handshake', 'single',
    'cert_name', cert->>'name',
    'backfilled', true
  ),
  'active'
FROM public.staff_registry s,
     LATERAL jsonb_array_elements(coalesce(s.certifications, '[]'::jsonb)) AS cert
WHERE coalesce(s.active, true) = true
  AND nullif(cert->>'expiry', '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.compliance_assets c
     WHERE c.subject_table = 'staff_registry'
       AND c.subject_id = s.id
       AND c.type = 'certification'
       AND coalesce(c.config->>'cert_name', '') = coalesce(cert->>'name', '')
  );

NOTIFY pgrst, 'reload schema';
