-- Expected access checks for each venue type.
-- A new venue copies that type's list. Changing the list, or the venue's type,
-- means the next baseline must be signed again.
-- Run after docs/sql/2026-10-14_venue_types.sql.
-- Idempotent. "Success. No rows returned" is expected.

CREATE TABLE IF NOT EXISTS public.venue_requirements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL,
  prompt      text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'archived')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_requirements_code_key UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS public.venue_type_requirements (
  venue_type_code  text NOT NULL,
  requirement_code text NOT NULL REFERENCES public.venue_requirements (code),
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_type_code, requirement_code)
);

CREATE TABLE IF NOT EXISTS public.venue_requirement_changes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_code     text,
  venue_type_code      text,
  action               text NOT NULL,
  before_text          text,
  after_text           text,
  reason               text NOT NULL,
  changed_by_staff_id  uuid,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.venue_requirement_changes IS
  'Why a venue requirement was added, renamed, or removed. Kept for NDIS review.';

ALTER TABLE public.venue_template_fields
  ADD COLUMN IF NOT EXISTS requirement_code text,
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS baseline_voided_at timestamptz;

COMMENT ON COLUMN public.venues.baseline_voided_at IS
  'Set when the type or its requirements change. A baseline signed before this must be signed again.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_requirements TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_type_requirements TO authenticated, service_role;
GRANT SELECT, INSERT ON public.venue_requirement_changes TO authenticated, service_role;
REVOKE ALL ON TABLE public.venue_requirements FROM anon;
REVOKE ALL ON TABLE public.venue_type_requirements FROM anon;
REVOKE ALL ON TABLE public.venue_requirement_changes FROM anon;

ALTER TABLE public.venue_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_type_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_requirement_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS venue_requirements_authenticated_all ON public.venue_requirements;
CREATE POLICY venue_requirements_authenticated_all
  ON public.venue_requirements FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS venue_type_requirements_authenticated_all ON public.venue_type_requirements;
CREATE POLICY venue_type_requirements_authenticated_all
  ON public.venue_type_requirements FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS venue_requirement_changes_authenticated_read ON public.venue_requirement_changes;
CREATE POLICY venue_requirement_changes_authenticated_read
  ON public.venue_requirement_changes FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS venue_requirement_changes_authenticated_insert ON public.venue_requirement_changes;
CREATE POLICY venue_requirement_changes_authenticated_insert
  ON public.venue_requirement_changes FOR INSERT TO authenticated WITH CHECK (true);

INSERT INTO public.venue_requirements (code, prompt, sort_order) VALUES
  ('step_free_entry', 'Step-free or ramped entry the group can use', 10),
  ('accessible_toilet', 'Accessible toilet the group can use', 20),
  ('emergency_exits', 'Emergency exits identified and clear', 30),
  ('muster_point', 'Evacuation muster point is known', 40),
  ('site_briefed', 'Site contact briefed on this group''s needs', 50),
  ('first_aid_contact', 'First aid and an emergency contact on site are confirmed', 60),
  ('safe_group_size', 'Maximum safe group size for this visit is known', 70),
  ('known_hazards', 'Hazards for this visit are recorded (traffic, water, crowds, steps)', 80),
  ('firm_paths', 'Firm paths, not only soft grass or sand', 110),
  ('shade_shelter', 'Shade or shelter if the group will be outside for a while', 120),
  ('drinking_water', 'Drinking water is available', 130),
  ('park_handrails', 'Handrails where there are steps, decks, or lookouts', 140),
  ('hotel_lift', 'Lift if bedrooms are not on the entry level', 110),
  ('hotel_bathroom', 'Accessible bathroom with room to transfer', 120),
  ('hotel_handrails', 'Handrails by the shower, bath, or toilet', 130),
  ('hotel_after_hours', 'After-hours contact for the building', 140),
  ('hotel_overnight_evac', 'Overnight evacuation plan the group can follow', 150),
  ('hotel_dining_access', 'Dining or meal area is reachable without stairs', 160),
  ('cinema_seating', 'Accessible seating in the auditorium', 110),
  ('cinema_route', 'Step-free route from the door to the seat', 120),
  ('cinema_captions', 'Captions or a hearing option has been considered', 130),
  ('cinema_levels', 'Lift or ramp if the cinema is not all on one level', 140),
  ('museum_route', 'Step-free route through the exhibits the group will see', 110),
  ('museum_lift', 'Lift if the visit uses more than one floor', 120),
  ('museum_rest', 'A quiet or rest space is available', 130),
  ('museum_seating', 'Seats along the route', 140),
  ('sports_change', 'Accessible change room the group can use', 110),
  ('sports_water_entry', 'If there is water, a hoist, ramp, or transfer has been considered', 120),
  ('sports_viewing', 'People watching can sit or stand safely', 130),
  ('sports_handrails', 'Handrails on stairs, pool edges, or ramps', 140),
  ('dining_space', 'Space for a wheelchair at the table', 110),
  ('dining_toilet', 'Accessible toilet, or the nearest one is identified', 120),
  ('dining_diet', 'Kitchen has been told about allergies and meal texture', 130),
  ('dining_handrails', 'Handrails if there are steps to the table', 140),
  ('shops_levels', 'Lift or a step-free way between the floors you will use', 110),
  ('shops_rest', 'A quiet space has been considered', 120),
  ('shops_seats', 'Somewhere to sit and rest', 130),
  ('shops_dropoff', 'Step-free path from the drop-off to the entrance', 140),
  ('club_entry', 'Step-free entry to the room you will use', 110),
  ('club_lighting', 'Lighting and trip hazards checked', 120)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.venue_type_requirements (venue_type_code, requirement_code)
SELECT t.code, r.code
FROM (VALUES
  ('general'), ('park'), ('hotel'), ('cinema'), ('museum'),
  ('sports'), ('restaurant'), ('shopping'), ('club')
) AS t(code)
CROSS JOIN (VALUES
  ('step_free_entry'), ('accessible_toilet'), ('emergency_exits'), ('muster_point'),
  ('site_briefed'), ('first_aid_contact'), ('safe_group_size'), ('known_hazards')
) AS r(code)
ON CONFLICT DO NOTHING;

INSERT INTO public.venue_type_requirements (venue_type_code, requirement_code)
SELECT type_code, requirement_code
FROM (VALUES
  ('park', 'firm_paths'),
  ('park', 'shade_shelter'),
  ('park', 'drinking_water'),
  ('park', 'park_handrails'),
  ('hotel', 'hotel_lift'),
  ('hotel', 'hotel_bathroom'),
  ('hotel', 'hotel_handrails'),
  ('hotel', 'hotel_after_hours'),
  ('hotel', 'hotel_overnight_evac'),
  ('hotel', 'hotel_dining_access'),
  ('cinema', 'cinema_seating'),
  ('cinema', 'cinema_route'),
  ('cinema', 'cinema_captions'),
  ('cinema', 'cinema_levels'),
  ('museum', 'museum_route'),
  ('museum', 'museum_lift'),
  ('museum', 'museum_rest'),
  ('museum', 'museum_seating'),
  ('sports', 'sports_change'),
  ('sports', 'sports_water_entry'),
  ('sports', 'sports_viewing'),
  ('sports', 'sports_handrails'),
  ('restaurant', 'dining_space'),
  ('restaurant', 'dining_toilet'),
  ('restaurant', 'dining_diet'),
  ('restaurant', 'dining_handrails'),
  ('shopping', 'shops_levels'),
  ('shopping', 'shops_rest'),
  ('shopping', 'shops_seats'),
  ('shopping', 'shops_dropoff'),
  ('club', 'club_entry'),
  ('club', 'club_lighting')
) AS x(type_code, requirement_code)
ON CONFLICT DO NOTHING;

-- One current copy of each requirement per venue. Drops extras from a double save.
DELETE FROM public.venue_template_fields f
WHERE f.requirement_code IS NOT NULL
  AND f.id <> (
    SELECT id FROM public.venue_template_fields keep
    WHERE keep.venue_id = f.venue_id
      AND keep.requirement_code = f.requirement_code
    ORDER BY keep.created_at, keep.id
    LIMIT 1
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.venue_safety_answers a WHERE a.field_id = f.id
  );

CREATE UNIQUE INDEX IF NOT EXISTS venue_template_fields_requirement_uidx
  ON public.venue_template_fields (venue_id, requirement_code)
  WHERE requirement_code IS NOT NULL;

ALTER TABLE public.venue_template_fields
  ADD COLUMN IF NOT EXISTS assessment_met boolean,
  ADD COLUMN IF NOT EXISTS assessment_reason text;

-- Validation: park expect 12 rows (8 shared + 4 outdoor). Column expect 1 row.
-- SELECT count(*) FROM venue_type_requirements WHERE venue_type_code = 'park';
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'venues' AND column_name = 'baseline_voided_at';
