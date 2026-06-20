-- 2026-06-29 — Manager "Defer" support for Staff Certifications
--
-- Certifications are stored as a JSONB array on public.staff_registry.certifications
-- where each element matches:
--   { name: text, number: text, expiry: date-iso, deferredUntil: date-iso | null }
--
-- This migration extends the JSONB shape to include `deferredUntil`. Because the
-- column is JSONB there is no DDL change required — but we document the contract
-- here and backfill the new key on existing rows so dashboard scans can rely on
-- the property being present.
--
-- Dashboard logic (see src/hooks/use-exception-feed.ts → useStaffCertificationExceptions):
--   - expiry  < CURRENT_DATE                 → RED / critical (e.g. Craig Oberg WWC 15/06/2026)
--   - expiry <= CURRENT_DATE + INTERVAL '30 day' → YELLOW / warning
--   - deferredUntil > CURRENT_DATE           → suppressed from the Red/Critical list

BEGIN;

-- Backfill: ensure every existing cert object has a deferredUntil key (null by default).
UPDATE public.staff_registry s
SET certifications = (
  SELECT jsonb_agg(
    CASE
      WHEN c ? 'deferredUntil' THEN c
      ELSE c || jsonb_build_object('deferredUntil', NULL)
    END
  )
  FROM jsonb_array_elements(COALESCE(s.certifications, '[]'::jsonb)) AS c
)
WHERE jsonb_typeof(s.certifications) = 'array';

-- Optional helper view for SQL-side reporting / pg_cron sweeps.
CREATE OR REPLACE VIEW public.v_staff_certification_status AS
SELECT
  s.id              AS staff_id,
  s.full_name       AS staff_name,
  c->>'name'        AS cert_name,
  c->>'number'      AS cert_number,
  (c->>'expiry')::date         AS renewal_expiry_date,
  (c->>'deferredUntil')::date  AS deferred_until,
  CASE
    WHEN (c->>'deferredUntil')::date IS NOT NULL
      AND (c->>'deferredUntil')::date > CURRENT_DATE       THEN 'deferred'
    WHEN (c->>'expiry')::date IS NULL                       THEN 'green'
    WHEN (c->>'expiry')::date <  CURRENT_DATE               THEN 'red'
    WHEN (c->>'expiry')::date <= CURRENT_DATE + 30          THEN 'yellow'
    ELSE 'green'
  END AS status
FROM public.staff_registry s
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.certifications, '[]'::jsonb)) AS c
WHERE s.active IS TRUE;

GRANT SELECT ON public.v_staff_certification_status TO authenticated;
GRANT ALL    ON public.v_staff_certification_status TO service_role;

COMMIT;
