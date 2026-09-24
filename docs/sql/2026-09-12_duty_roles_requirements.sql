-- =============================================================================
-- 2026-09-12 — Duty roles + requirement catalogue (BL-126)
-- =============================================================================
--
-- Office-managed Duty roles (Food Preparation, Bus Driver, …) sit beside
-- ACCESS_ROLES. Each Duty role lists requirements: certificates or orientations.
-- Expiry is optional (blank = does not expire).
--
-- Function / asset bindings say which Duty role is challenged on the floor
-- (meal prep, fleet drive). Centre Open/Close keys exist but are not seeded.
--
-- Staff evidence stays on staff_registry.certifications JSONB; we add
-- requirementTypeId when a name matches the catalogue (aliases included).
--
-- Run on DEV then TEST. SQL Editor "Success. No rows returned" is expected
-- for the DDL / GRANT / seed body.
-- =============================================================================

-- ---------- 1) Catalogue ----------
CREATE TABLE IF NOT EXISTS public.requirement_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  kind        text NOT NULL
              CHECK (kind IN ('certificate', 'orientation')),
  aliases     text[] NOT NULL DEFAULT '{}',
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS requirement_types_name_lower_unique
  ON public.requirement_types (lower(trim(name)));

CREATE INDEX IF NOT EXISTS requirement_types_active_idx
  ON public.requirement_types (active, sort_order);

COMMENT ON TABLE public.requirement_types IS
  'BL-126: office catalogue of certificates and orientations. Expiry lives on the staff hold, not here.';

-- ---------- 2) Duty roles ----------
CREATE TABLE IF NOT EXISTS public.duty_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS duty_roles_name_lower_unique
  ON public.duty_roles (lower(trim(name)));

CREATE INDEX IF NOT EXISTS duty_roles_active_idx
  ON public.duty_roles (active, sort_order);

COMMENT ON TABLE public.duty_roles IS
  'BL-126: operational jobs (Food Preparation, Bus Driver). Not menu / ACCESS_ROLES.';

-- ---------- 3) Duty role → requirements ----------
CREATE TABLE IF NOT EXISTS public.duty_role_requirements (
  duty_role_id         uuid NOT NULL REFERENCES public.duty_roles(id) ON DELETE CASCADE,
  requirement_type_id  uuid NOT NULL REFERENCES public.requirement_types(id) ON DELETE CASCADE,
  sort_order           integer NOT NULL DEFAULT 0,
  PRIMARY KEY (duty_role_id, requirement_type_id)
);

-- ---------- 4) Staff ↔ Duty roles ----------
CREATE TABLE IF NOT EXISTS public.staff_duty_roles (
  staff_id      uuid NOT NULL REFERENCES public.staff_registry(id) ON DELETE CASCADE,
  duty_role_id  uuid NOT NULL REFERENCES public.duty_roles(id) ON DELETE CASCADE,
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, duty_role_id)
);

-- ---------- 5) Function / asset bindings ----------
CREATE TABLE IF NOT EXISTS public.duty_bindings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_key  text NOT NULL
                CHECK (function_key IN (
                  'meal_prep', 'fleet_drive', 'centre_open', 'centre_close', 'med_admin',
                  'floor_on_duty', 'event_venue_open', 'event_day_close', 'med_witness'
                )),
  subject_kind  text NOT NULL DEFAULT 'function'
                CHECK (subject_kind IN ('function', 'vehicle_category', 'fleet_asset')),
  subject_id    text,
  duty_role_id  uuid NOT NULL REFERENCES public.duty_roles(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS duty_bindings_unique
  ON public.duty_bindings (
    function_key,
    subject_kind,
    COALESCE(subject_id, ''),
    duty_role_id
  );

CREATE INDEX IF NOT EXISTS duty_bindings_function_idx
  ON public.duty_bindings (function_key, subject_kind);

COMMENT ON TABLE public.duty_bindings IS
  'BL-126: which Duty role is required to do a function or drive an asset/category.';

-- ---------- 6) RLS — authenticated + service_role, no anon ----------
ALTER TABLE public.requirement_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duty_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duty_role_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_duty_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duty_bindings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS requirement_types_authenticated_all ON public.requirement_types;
CREATE POLICY requirement_types_authenticated_all
  ON public.requirement_types FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS duty_roles_authenticated_all ON public.duty_roles;
CREATE POLICY duty_roles_authenticated_all
  ON public.duty_roles FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS duty_role_requirements_authenticated_all ON public.duty_role_requirements;
CREATE POLICY duty_role_requirements_authenticated_all
  ON public.duty_role_requirements FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS staff_duty_roles_authenticated_all ON public.staff_duty_roles;
CREATE POLICY staff_duty_roles_authenticated_all
  ON public.staff_duty_roles FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS duty_bindings_authenticated_all ON public.duty_bindings;
CREATE POLICY duty_bindings_authenticated_all
  ON public.duty_bindings FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.requirement_types FROM anon;
REVOKE ALL ON TABLE public.duty_roles FROM anon;
REVOKE ALL ON TABLE public.duty_role_requirements FROM anon;
REVOKE ALL ON TABLE public.staff_duty_roles FROM anon;
REVOKE ALL ON TABLE public.duty_bindings FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.requirement_types TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.duty_roles TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.duty_role_requirements TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.staff_duty_roles TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.duty_bindings TO authenticated, service_role;

-- ---------- 7) Seed catalogue (fixed UUIDs; do not overwrite office edits) ----------
INSERT INTO public.requirement_types (id, name, kind, aliases, sort_order) VALUES
  (
    '11111111-1111-4111-8111-000000000001',
    'Safe Food Handler',
    'certificate',
    ARRAY[
      'food handler basic',
      'safe food handling',
      'food handling',
      'safe food handler',
      'sfh',
      'food handler'
    ],
    10
  ),
  (
    '11111111-1111-4111-8111-000000000002',
    'WWCC',
    'certificate',
    ARRAY['wwc', 'wwcc', 'working with children', 'working with children check'],
    20
  ),
  (
    '11111111-1111-4111-8111-000000000003',
    'First Aid',
    'certificate',
    ARRAY['first aid / cpr', 'first aid/cpr', 'cpr', 'provide first aid'],
    30
  ),
  (
    '11111111-1111-4111-8111-000000000004',
    'Driver licence (Car)',
    'certificate',
    ARRAY['driver licence', 'car licence', 'c class', 'driver licence (c)', 'licence car'],
    40
  ),
  (
    '11111111-1111-4111-8111-000000000005',
    'Driver licence (LR)',
    'certificate',
    ARRAY['lr', 'driver licence (lr)', 'licence lr', 'light rigid'],
    50
  ),
  (
    '11111111-1111-4111-8111-000000000006',
    'Driver licence (HR)',
    'certificate',
    ARRAY['hr', 'driver licence (hr)', 'licence hr', 'heavy rigid'],
    60
  ),
  (
    '11111111-1111-4111-8111-000000000007',
    'NDIS Worker Screening',
    'certificate',
    ARRAY['ndis screening', 'worker screening'],
    70
  ),
  (
    '11111111-1111-4111-8111-000000000008',
    'Kitchen orientation',
    'orientation',
    ARRAY['kitchen induction', 'food prep orientation'],
    80
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.duty_roles (id, name, description, sort_order) VALUES
  (
    '22222222-2222-4222-8222-000000000001',
    'Food Preparation',
    'Cooked or packed meals at the Centre or on a trip.',
    10
  ),
  (
    '22222222-2222-4222-8222-000000000002',
    'Bus Driver',
    'Drive a bus or Coaster (licence class set on this role).',
    20
  ),
  (
    '22222222-2222-4222-8222-000000000003',
    'Car Driver',
    'Drive a car or HiAce.',
    30
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.duty_role_requirements (duty_role_id, requirement_type_id, sort_order) VALUES
  ('22222222-2222-4222-8222-000000000001', '11111111-1111-4111-8111-000000000001', 10),
  ('22222222-2222-4222-8222-000000000002', '11111111-1111-4111-8111-000000000005', 10),
  ('22222222-2222-4222-8222-000000000002', '11111111-1111-4111-8111-000000000002', 20),
  ('22222222-2222-4222-8222-000000000003', '11111111-1111-4111-8111-000000000004', 10),
  ('22222222-2222-4222-8222-000000000003', '11111111-1111-4111-8111-000000000002', 20)
ON CONFLICT (duty_role_id, requirement_type_id) DO NOTHING;

-- Function defaults. Centre Open/Close and Medical Admin are bindable but not seeded.
INSERT INTO public.duty_bindings (function_key, subject_kind, subject_id, duty_role_id) VALUES
  ('meal_prep', 'function', NULL, '22222222-2222-4222-8222-000000000001'),
  ('fleet_drive', 'vehicle_category', 'bus', '22222222-2222-4222-8222-000000000002'),
  ('fleet_drive', 'vehicle_category', 'coaster', '22222222-2222-4222-8222-000000000002'),
  ('fleet_drive', 'vehicle_category', 'hiace', '22222222-2222-4222-8222-000000000003')
ON CONFLICT DO NOTHING;

-- ---------- 8) Tag existing staff JSONB certs with requirementTypeId ----------
UPDATE public.staff_registry s
SET certifications = sub.next_certs
FROM (
  SELECT
    sr.id,
    COALESCE(
      (
        SELECT jsonb_agg(tagged.cert ORDER BY tagged.ord)
        FROM (
          SELECT
            c.ord,
            CASE
              WHEN nullif(trim(c.el->>'requirementTypeId'), '') IS NOT NULL THEN c.el
              WHEN matched.id IS NOT NULL THEN
                c.el || jsonb_build_object('requirementTypeId', matched.id::text)
              ELSE c.el
            END AS cert
          FROM jsonb_array_elements(COALESCE(sr.certifications, '[]'::jsonb))
            WITH ORDINALITY AS c(el, ord)
          LEFT JOIN LATERAL (
            SELECT rt.id
            FROM public.requirement_types rt
            WHERE rt.active
              AND (
                lower(trim(c.el->>'name')) = lower(trim(rt.name))
                OR lower(trim(c.el->>'name')) = ANY (
                  SELECT lower(trim(a)) FROM unnest(rt.aliases) a
                )
                OR (
                  length(trim(c.el->>'name')) >= 6
                  AND (
                    lower(trim(c.el->>'name')) LIKE '%' || lower(trim(rt.name)) || '%'
                    OR EXISTS (
                      SELECT 1
                      FROM unnest(rt.aliases) a
                      WHERE length(trim(a)) >= 6
                        AND lower(trim(c.el->>'name')) LIKE '%' || lower(trim(a)) || '%'
                    )
                  )
                )
              )
            ORDER BY
              CASE WHEN lower(trim(c.el->>'name')) = lower(trim(rt.name)) THEN 0 ELSE 1 END,
              rt.sort_order
            LIMIT 1
          ) matched ON true
        ) tagged
      ),
      COALESCE(sr.certifications, '[]'::jsonb)
    ) AS next_certs
  FROM public.staff_registry sr
) sub
WHERE s.id = sub.id
  AND s.certifications IS DISTINCT FROM sub.next_certs;

-- =============================================================================
-- Validation (run after this script — expect rows)
-- =============================================================================
-- SELECT name, kind FROM public.requirement_types ORDER BY sort_order;
--   expect 8 rows including "Safe Food Handler"
-- SELECT name FROM public.duty_roles ORDER BY sort_order;
--   expect Food Preparation, Bus Driver, Car Driver
-- SELECT function_key, subject_kind, subject_id
--   FROM public.duty_bindings ORDER BY function_key, subject_kind;
--   expect meal_prep + 3 fleet_drive category rows
-- =============================================================================
