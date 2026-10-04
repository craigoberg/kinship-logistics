-- =============================================================================
-- 2026-10-04 — One person, several hats (client / staff / volunteer / carer)
-- =============================================================================
--
-- A human is one people row. Client, staff/volunteer, and carer registers
-- point at that person. Guest is a short client visit, not a second human.
-- Driver and food prep stay duties. System access level stays personnel_type.
--
-- Run on DEV then TEST. "Success. No rows returned" is expected for the DDL.
--
-- Validation — expect 1 row, people_table not null:
--   SELECT to_regclass('public.people') AS people_table,
--          (SELECT count(*) FROM public.people) AS people,
--          (SELECT count(*) FROM public.staff_registry WHERE person_id IS NULL) AS staff_unlinked,
--          (SELECT count(*) FROM public.carers_registry WHERE person_id IS NULL) AS carers_unlinked;
-- Expect staff_unlinked = 0 and carers_unlinked = 0.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.people IS
  'One human. Hats live on participants, staff_registry, and carers_registry via person_id.';

ALTER TABLE public.staff_registry
  ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES public.people(id) ON DELETE SET NULL;
ALTER TABLE public.carers_registry
  ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES public.people(id) ON DELETE SET NULL;
ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES public.people(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS staff_registry_person_id_idx ON public.staff_registry (person_id);
CREATE INDEX IF NOT EXISTS carers_registry_person_id_idx ON public.carers_registry (person_id);
CREATE INDEX IF NOT EXISTS participants_person_id_idx ON public.participants (person_id);

-- One person per existing row that is not linked yet.
DO $$
DECLARE
  r record;
  pid uuid;
BEGIN
  FOR r IN SELECT id, full_name FROM public.staff_registry WHERE person_id IS NULL LOOP
    INSERT INTO public.people (display_name)
    VALUES (coalesce(nullif(trim(r.full_name), ''), 'Staff'))
    RETURNING id INTO pid;
    UPDATE public.staff_registry SET person_id = pid WHERE id = r.id;
  END LOOP;

  FOR r IN SELECT id, full_name FROM public.carers_registry WHERE person_id IS NULL LOOP
    INSERT INTO public.people (display_name)
    VALUES (coalesce(nullif(trim(r.full_name), ''), 'Carer'))
    RETURNING id INTO pid;
    UPDATE public.carers_registry SET person_id = pid WHERE id = r.id;
  END LOOP;

  FOR r IN
    SELECT id, trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) AS full_name
    FROM public.participants
    WHERE person_id IS NULL
  LOOP
    INSERT INTO public.people (display_name)
    VALUES (coalesce(nullif(trim(r.full_name), ''), 'Client'))
    RETURNING id INTO pid;
    UPDATE public.participants SET person_id = pid WHERE id = r.id;
  END LOOP;
END $$;

-- Jenny Simpkin: carer of Jamie, mistaken support-worker row, and Disco guest.
-- Does nothing unless each of those is exactly one row. Leaves Jenny McAlees.
DO $$
DECLARE
  n_carer int;
  n_staff int;
  n_guest int;
  v_carer uuid;
  v_staff uuid;
  v_guest uuid;
  v_person uuid;
BEGIN
  SELECT count(*) INTO n_carer FROM public.carers_registry
   WHERE lower(trim(full_name)) = 'jenny simpkin';
  SELECT count(*) INTO n_staff FROM public.staff_registry
   WHERE lower(trim(full_name)) = 'jenny simpkin';
  SELECT count(*) INTO n_guest FROM public.participants
   WHERE lower(trim(coalesce(first_name, ''))) = 'jenny'
     AND lower(trim(coalesce(last_name, ''))) = 'simpkin'
     AND participant_kind = 'guest';

  IF n_carer <> 1 THEN
    RAISE NOTICE 'person hats: skip Jenny Simpkin link (carer count %)', n_carer;
    RETURN;
  END IF;

  SELECT id, person_id INTO v_carer, v_person
    FROM public.carers_registry
   WHERE lower(trim(full_name)) = 'jenny simpkin';

  IF n_staff = 1 THEN
    SELECT id INTO v_staff FROM public.staff_registry
     WHERE lower(trim(full_name)) = 'jenny simpkin';
    UPDATE public.staff_registry
       SET person_id = v_person,
           personnel_type = 'Volunteer',
           role = CASE
             WHEN lower(trim(coalesce(role, ''))) IN ('support worker', '') THEN 'Volunteer'
             ELSE role
           END
     WHERE id = v_staff;

    UPDATE public.support_attendance_schedules s
       SET staff_id = v_staff,
           carer_id = NULL,
           person_kind = 'volunteer'
     WHERE s.carer_id = v_carer
       AND s.active = true
       AND NOT EXISTS (
         SELECT 1 FROM public.support_attendance_schedules s2
          WHERE s2.staff_id = v_staff
            AND s2.day_of_week = s.day_of_week
            AND s2.active = true
            AND s2.id <> s.id
       );

    UPDATE public.support_attendance_log l
       SET staff_id = v_staff,
           carer_id = NULL,
           person_kind = 'volunteer'
     WHERE l.carer_id = v_carer
       AND l.status = 'expected'
       AND NOT EXISTS (
         SELECT 1 FROM public.support_attendance_log x
          WHERE x.session_id = l.session_id
            AND x.staff_id = v_staff
       );
  ELSE
    RAISE NOTICE 'person hats: Jenny Simpkin staff count %, left unchanged', n_staff;
  END IF;

  IF n_guest = 1 THEN
    SELECT id INTO v_guest FROM public.participants
     WHERE lower(trim(coalesce(first_name, ''))) = 'jenny'
       AND lower(trim(coalesce(last_name, ''))) = 'simpkin'
       AND participant_kind = 'guest';
    UPDATE public.participants
       SET person_id = v_person,
           archived_at = coalesce(archived_at, now())
     WHERE id = v_guest;
  ELSE
    RAISE NOTICE 'person hats: Jenny Simpkin guest count %, left unchanged', n_guest;
  END IF;
END $$;

DELETE FROM public.people p
 WHERE NOT EXISTS (SELECT 1 FROM public.staff_registry s WHERE s.person_id = p.id)
   AND NOT EXISTS (SELECT 1 FROM public.carers_registry c WHERE c.person_id = p.id)
   AND NOT EXISTS (SELECT 1 FROM public.participants x WHERE x.person_id = p.id);

ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.people FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.people TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.people TO service_role;
DROP POLICY IF EXISTS kinship_authenticated_all_people ON public.people;
CREATE POLICY kinship_authenticated_all_people
  ON public.people FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
