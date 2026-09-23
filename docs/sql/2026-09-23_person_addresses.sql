-- =============================================================================
-- 2026-09-23 — Pickup / drop-off address book (BL-130)
-- =============================================================================
--
-- Home stays on participants.street_address, staff_registry.street_address,
-- and carers_registry.street_address. Named places live here. Run Planning
-- points each weekday morning/afternoon at one place (null = Home).
-- A driver change for one date writes day_stop_address_overrides and does
-- not change the standing weekday plan.
--
-- Backfill: a client regular_pickup_address that differs from home becomes
-- a "Regular pickup" place, and that person's schedule rows point at it
-- for both directions. A support pickup_address_override that differs from
-- their street address is treated the same ("Schedule pickup").
-- Old text columns are left in place.
--
-- Authenticated + service_role only. No anon grant (PII).
-- SQL Editor "Success. No rows returned" is expected for this script.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.person_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid REFERENCES public.participants(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES public.staff_registry(id) ON DELETE CASCADE,
  carer_id uuid REFERENCES public.carers_registry(id) ON DELETE CASCADE,
  label text NOT NULL,
  address text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_addresses_one_owner CHECK (
    ((participant_id IS NOT NULL)::int
      + (staff_id IS NOT NULL)::int
      + (carer_id IS NOT NULL)::int) = 1
  ),
  CONSTRAINT person_addresses_label_check CHECK (btrim(label) <> ''),
  CONSTRAINT person_addresses_address_check CHECK (btrim(address) <> '')
);

CREATE INDEX IF NOT EXISTS person_addresses_participant_idx
  ON public.person_addresses (participant_id)
  WHERE participant_id IS NOT NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS person_addresses_staff_idx
  ON public.person_addresses (staff_id)
  WHERE staff_id IS NOT NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS person_addresses_carer_idx
  ON public.person_addresses (carer_id)
  WHERE carer_id IS NOT NULL AND archived_at IS NULL;

COMMENT ON TABLE public.person_addresses IS
  'BL-130 named pickup/drop-off places. Home stays on the person street_address column.';

REVOKE ALL ON TABLE public.person_addresses FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.person_addresses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.person_addresses TO service_role;

ALTER TABLE public.person_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS person_addresses_authenticated_all ON public.person_addresses;
CREATE POLICY person_addresses_authenticated_all
  ON public.person_addresses
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.participant_attendance_schedules
  ADD COLUMN IF NOT EXISTS inbound_address_id uuid REFERENCES public.person_addresses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS outbound_address_id uuid REFERENCES public.person_addresses(id) ON DELETE SET NULL;

ALTER TABLE public.support_attendance_schedules
  ADD COLUMN IF NOT EXISTS inbound_address_id uuid REFERENCES public.person_addresses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS outbound_address_id uuid REFERENCES public.person_addresses(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.participant_attendance_schedules.inbound_address_id IS
  'BL-130 standing morning pickup place. Null = home street address.';
COMMENT ON COLUMN public.participant_attendance_schedules.outbound_address_id IS
  'BL-130 standing afternoon drop-off place. Null = home street address.';

CREATE TABLE IF NOT EXISTS public.day_stop_address_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_date date NOT NULL,
  direction text NOT NULL
    CHECK (direction IN ('morning', 'afternoon', 'outbound', 'return')),
  participant_id uuid REFERENCES public.participants(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES public.staff_registry(id) ON DELETE CASCADE,
  carer_id uuid REFERENCES public.carers_registry(id) ON DELETE CASCADE,
  address_id uuid REFERENCES public.person_addresses(id) ON DELETE SET NULL,
  custom_address text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_staff_id uuid REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  CONSTRAINT day_stop_address_overrides_one_owner CHECK (
    ((participant_id IS NOT NULL)::int
      + (staff_id IS NOT NULL)::int
      + (carer_id IS NOT NULL)::int) = 1
  ),
  CONSTRAINT day_stop_address_overrides_target_check CHECK (
    (address_id IS NOT NULL AND custom_address IS NULL)
    OR (
      address_id IS NULL
      AND custom_address IS NOT NULL
      AND btrim(custom_address) <> ''
    )
    OR (address_id IS NULL AND custom_address IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS day_stop_address_overrides_participant_uidx
  ON public.day_stop_address_overrides (service_date, direction, participant_id)
  WHERE participant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS day_stop_address_overrides_staff_uidx
  ON public.day_stop_address_overrides (service_date, direction, staff_id)
  WHERE staff_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS day_stop_address_overrides_carer_uidx
  ON public.day_stop_address_overrides (service_date, direction, carer_id)
  WHERE carer_id IS NOT NULL;

COMMENT ON TABLE public.day_stop_address_overrides IS
  'BL-130 this-date stop place. Null address_id and null custom_address means Home. Does not change the weekday plan.';

REVOKE ALL ON TABLE public.day_stop_address_overrides FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.day_stop_address_overrides TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.day_stop_address_overrides TO service_role;

ALTER TABLE public.day_stop_address_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS day_stop_address_overrides_authenticated_all ON public.day_stop_address_overrides;
CREATE POLICY day_stop_address_overrides_authenticated_all
  ON public.day_stop_address_overrides
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ---------- Backfill named places from the old single pickup strings ----------

INSERT INTO public.person_addresses (participant_id, label, address, sort_order)
SELECT p.id, 'Regular pickup', btrim(p.regular_pickup_address), 10
FROM public.participants p
WHERE btrim(coalesce(p.regular_pickup_address, '')) <> ''
  AND btrim(coalesce(p.regular_pickup_address, ''))
    IS DISTINCT FROM btrim(coalesce(p.street_address, ''))
  AND NOT EXISTS (
    SELECT 1
    FROM public.person_addresses a
    WHERE a.participant_id = p.id
      AND a.archived_at IS NULL
      AND btrim(a.address) = btrim(p.regular_pickup_address)
  );

UPDATE public.participant_attendance_schedules s
SET inbound_address_id = a.id,
    outbound_address_id = a.id
FROM public.person_addresses a
JOIN public.participants p ON p.id = a.participant_id
WHERE a.participant_id = s.participant_id
  AND a.archived_at IS NULL
  AND a.label = 'Regular pickup'
  AND btrim(a.address) = btrim(p.regular_pickup_address)
  AND s.inbound_address_id IS NULL
  AND s.outbound_address_id IS NULL;

INSERT INTO public.person_addresses (staff_id, label, address, sort_order)
SELECT DISTINCT s.staff_id, 'Schedule pickup', btrim(s.pickup_address_override), 10
FROM public.support_attendance_schedules s
JOIN public.staff_registry st ON st.id = s.staff_id
WHERE s.staff_id IS NOT NULL
  AND btrim(coalesce(s.pickup_address_override, '')) <> ''
  AND btrim(s.pickup_address_override) IS DISTINCT FROM btrim(coalesce(st.street_address, ''))
  AND NOT EXISTS (
    SELECT 1
    FROM public.person_addresses a
    WHERE a.staff_id = s.staff_id
      AND a.archived_at IS NULL
      AND btrim(a.address) = btrim(s.pickup_address_override)
  );

UPDATE public.support_attendance_schedules s
SET inbound_address_id = a.id,
    outbound_address_id = a.id
FROM public.person_addresses a
WHERE a.staff_id = s.staff_id
  AND a.archived_at IS NULL
  AND s.staff_id IS NOT NULL
  AND btrim(coalesce(s.pickup_address_override, '')) <> ''
  AND btrim(a.address) = btrim(s.pickup_address_override)
  AND s.inbound_address_id IS NULL
  AND s.outbound_address_id IS NULL;

INSERT INTO public.person_addresses (carer_id, label, address, sort_order)
SELECT DISTINCT s.carer_id, 'Schedule pickup', btrim(s.pickup_address_override), 10
FROM public.support_attendance_schedules s
JOIN public.carers_registry c ON c.id = s.carer_id
WHERE s.carer_id IS NOT NULL
  AND btrim(coalesce(s.pickup_address_override, '')) <> ''
  AND btrim(s.pickup_address_override) IS DISTINCT FROM btrim(coalesce(c.street_address, ''))
  AND NOT EXISTS (
    SELECT 1
    FROM public.person_addresses a
    WHERE a.carer_id = s.carer_id
      AND a.archived_at IS NULL
      AND btrim(a.address) = btrim(s.pickup_address_override)
  );

UPDATE public.support_attendance_schedules s
SET inbound_address_id = a.id,
    outbound_address_id = a.id
FROM public.person_addresses a
WHERE a.carer_id = s.carer_id
  AND a.archived_at IS NULL
  AND s.carer_id IS NOT NULL
  AND btrim(coalesce(s.pickup_address_override, '')) <> ''
  AND btrim(a.address) = btrim(s.pickup_address_override)
  AND s.inbound_address_id IS NULL
  AND s.outbound_address_id IS NULL;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- What "Success. No rows returned" means
--   DDL, grants, and backfill. An empty result pane is normal.
--
-- Validation (these SHOULD return rows):
--
-- 1) Tables exist — expect 2 rows:
--    SELECT to_regclass('public.person_addresses') AS person_addresses,
--           to_regclass('public.day_stop_address_overrides') AS day_overrides;
--
-- 2) Schedule columns — expect 4 rows:
--    SELECT table_name, column_name
--    FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND column_name IN ('inbound_address_id', 'outbound_address_id')
--      AND table_name IN (
--        'participant_attendance_schedules',
--        'support_attendance_schedules'
--      )
--    ORDER BY 1, 2;
--
-- 3) Privileges — expect authenticated SELECT, and no anon SELECT:
--    SELECT grantee, privilege_type
--    FROM information_schema.role_table_grants
--    WHERE table_schema = 'public'
--      AND table_name IN ('person_addresses', 'day_stop_address_overrides')
--      AND grantee IN ('anon', 'authenticated', 'service_role')
--    ORDER BY table_name, grantee, privilege_type;
--
-- 4) Backfill shape (row count depends on live data; 0 is valid):
--    SELECT label, count(*)
--    FROM public.person_addresses
--    WHERE archived_at IS NULL
--    GROUP BY label
--    ORDER BY label;
-- ---------------------------------------------------------------------------
