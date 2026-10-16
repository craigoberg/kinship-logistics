-- =============================================================================
-- 2026-08-29 — Day & trip support people (staff / volunteer / carer) — BL-125
-- =============================================================================
--
-- Office records everyone attending on the day (not just clients) and plans
-- their own pickup / drop-off methods on Day Centre and trip buses.
--
-- Identity stays on staff_registry / carers_registry. Do NOT fake participants
-- rows (meals, meds, NDIS billing stay client-only).
--
-- Volunteers are staff_registry rows (personnel_type / role). person_kind
-- distinguishes staff vs volunteer vs carer on the new tables.
--
-- Run on DEV then TEST. SQL Editor "Success. No rows returned" is expected
-- for the DDL / GRANT body.
-- =============================================================================

-- ---------- 1) Manifest person refs ----------
ALTER TABLE public.trip_legs
  ADD COLUMN IF NOT EXISTS from_staff_id uuid REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS to_staff_id uuid REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS from_carer_id uuid REFERENCES public.carers_registry(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS to_carer_id uuid REFERENCES public.carers_registry(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.trip_legs.to_staff_id IS
  'BL-125: pickup/drop-off is this staff/volunteer (not a participant).';
COMMENT ON COLUMN public.trip_legs.to_carer_id IS
  'BL-125: pickup/drop-off is this carer (own stop, not host client).';

-- ---------- 2) Default run routes — person-kind ----------
ALTER TABLE public.bus_run_default_routes
  ALTER COLUMN participant_id DROP NOT NULL;

ALTER TABLE public.bus_run_default_routes
  ADD COLUMN IF NOT EXISTS person_kind text NOT NULL DEFAULT 'participant',
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staff_registry(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS carer_id uuid REFERENCES public.carers_registry(id) ON DELETE CASCADE;

UPDATE public.bus_run_default_routes
   SET person_kind = 'participant'
 WHERE person_kind IS NULL OR person_kind = '';

DO $$
BEGIN
  ALTER TABLE public.bus_run_default_routes
    DROP CONSTRAINT IF EXISTS bus_run_default_routes_person_kind_check;
  ALTER TABLE public.bus_run_default_routes
    ADD CONSTRAINT bus_run_default_routes_person_kind_check
    CHECK (person_kind IN ('participant', 'staff', 'volunteer', 'carer'));

  ALTER TABLE public.bus_run_default_routes
    DROP CONSTRAINT IF EXISTS bus_run_default_routes_one_person_check;
  ALTER TABLE public.bus_run_default_routes
    ADD CONSTRAINT bus_run_default_routes_one_person_check
    CHECK (
      (person_kind = 'participant' AND participant_id IS NOT NULL AND staff_id IS NULL AND carer_id IS NULL)
      OR (person_kind IN ('staff', 'volunteer') AND staff_id IS NOT NULL AND participant_id IS NULL AND carer_id IS NULL)
      OR (person_kind = 'carer' AND carer_id IS NOT NULL AND participant_id IS NULL AND staff_id IS NULL)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.bus_run_default_routes
  DROP CONSTRAINT IF EXISTS bus_run_default_routes_bus_run_code_direction_participant_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS bus_run_default_routes_run_dir_participant_uidx
  ON public.bus_run_default_routes (bus_run_code, direction, participant_id)
  WHERE participant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS bus_run_default_routes_run_dir_staff_uidx
  ON public.bus_run_default_routes (bus_run_code, direction, staff_id)
  WHERE staff_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS bus_run_default_routes_run_dir_carer_uidx
  ON public.bus_run_default_routes (bus_run_code, direction, carer_id)
  WHERE carer_id IS NOT NULL;

-- ---------- 3) Weekly Day Centre support schedules ----------
CREATE TABLE IF NOT EXISTS public.support_attendance_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_kind text NOT NULL
    CHECK (person_kind IN ('staff', 'volunteer', 'carer')),
  staff_id uuid REFERENCES public.staff_registry(id) ON DELETE CASCADE,
  carer_id uuid REFERENCES public.carers_registry(id) ON DELETE CASCADE,
  linked_participant_id uuid REFERENCES public.participants(id) ON DELETE SET NULL,
  day_of_week text NOT NULL,
  inbound_transport text,
  outbound_transport text,
  expected_arrival_time time without time zone NOT NULL DEFAULT '09:00:00',
  expected_departure_time time without time zone NOT NULL DEFAULT '15:00:00',
  pickup_address_override text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_attendance_schedules_person_check CHECK (
    (person_kind IN ('staff', 'volunteer') AND staff_id IS NOT NULL AND carer_id IS NULL)
    OR (person_kind = 'carer' AND carer_id IS NOT NULL AND staff_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS support_attendance_schedules_staff_day_uidx
  ON public.support_attendance_schedules (staff_id, day_of_week)
  WHERE staff_id IS NOT NULL AND active = true;

CREATE UNIQUE INDEX IF NOT EXISTS support_attendance_schedules_carer_day_uidx
  ON public.support_attendance_schedules (carer_id, day_of_week)
  WHERE carer_id IS NOT NULL AND active = true;

CREATE INDEX IF NOT EXISTS support_attendance_schedules_day_idx
  ON public.support_attendance_schedules (day_of_week, active);

COMMENT ON TABLE public.support_attendance_schedules IS
  'BL-125 weekly Day Centre plan for staff / volunteer / carer — own inbound/outbound methods.';

-- ---------- 4) Date-scoped support Off-today ----------
CREATE TABLE IF NOT EXISTS public.support_roster_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_date date NOT NULL,
  person_kind text NOT NULL
    CHECK (person_kind IN ('staff', 'volunteer', 'carer')),
  staff_id uuid REFERENCES public.staff_registry(id) ON DELETE CASCADE,
  carer_id uuid REFERENCES public.carers_registry(id) ON DELETE CASCADE,
  actual_status text NOT NULL DEFAULT 'absent',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_staff_id uuid REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  CONSTRAINT support_roster_logs_person_check CHECK (
    (staff_id IS NOT NULL AND carer_id IS NULL)
    OR (carer_id IS NOT NULL AND staff_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS support_roster_logs_staff_date_uidx
  ON public.support_roster_logs (roster_date, staff_id)
  WHERE staff_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS support_roster_logs_carer_date_uidx
  ON public.support_roster_logs (roster_date, carer_id)
  WHERE carer_id IS NOT NULL;

COMMENT ON TABLE public.support_roster_logs IS
  'BL-125 date-scoped Off today / floor Absent for support people (skips Manifest).';

-- ---------- 5) Day Centre support presence ----------
CREATE TABLE IF NOT EXISTS public.support_attendance_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.site_day_sessions(id) ON DELETE CASCADE,
  person_kind text NOT NULL
    CHECK (person_kind IN ('staff', 'volunteer', 'carer')),
  staff_id uuid REFERENCES public.staff_registry(id) ON DELETE CASCADE,
  carer_id uuid REFERENCES public.carers_registry(id) ON DELETE CASCADE,
  linked_participant_id uuid REFERENCES public.participants(id) ON DELETE SET NULL,
  expected_arrival_at timestamptz,
  expected_departure_at timestamptz,
  arrival_method text NOT NULL DEFAULT 'bus'
    CHECK (arrival_method IN ('bus', 'private', 'walk_in', 'other')),
  arrival_bus_run_code text,
  departure_vector text
    CHECK (departure_vector IS NULL OR departure_vector IN ('bus', 'family', 'independent')),
  departure_bus_run_code text,
  checked_in_at timestamptz,
  checked_in_by uuid REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  checked_out_at timestamptz,
  checked_out_by uuid REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'expected'
    CHECK (status IN ('expected', 'checked_in', 'checked_out', 'absent')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_attendance_log_person_check CHECK (
    (person_kind IN ('staff', 'volunteer') AND staff_id IS NOT NULL AND carer_id IS NULL)
    OR (person_kind = 'carer' AND carer_id IS NOT NULL AND staff_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS support_attendance_log_session_staff_uidx
  ON public.support_attendance_log (session_id, staff_id)
  WHERE staff_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS support_attendance_log_session_carer_uidx
  ON public.support_attendance_log (session_id, carer_id)
  WHERE carer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS support_attendance_log_session_idx
  ON public.support_attendance_log (session_id, status);

COMMENT ON TABLE public.support_attendance_log IS
  'BL-125 Day Centre floor presence for staff / volunteer / carer. Not meal/med recipients.';

-- ---------- 6) Trip support bookings ----------
CREATE TABLE IF NOT EXISTS public.event_support_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.event_manifest(id) ON DELETE CASCADE,
  person_kind text NOT NULL
    CHECK (person_kind IN ('staff', 'volunteer', 'carer')),
  staff_id uuid REFERENCES public.staff_registry(id) ON DELETE CASCADE,
  carer_id uuid REFERENCES public.carers_registry(id) ON DELETE CASCADE,
  linked_participant_id uuid REFERENCES public.participants(id) ON DELETE SET NULL,
  booking_status text NOT NULL DEFAULT 'Confirmed',
  outbound_transport_mode text NOT NULL DEFAULT 'bus'
    CHECK (outbound_transport_mode IN ('bus', 'self')),
  return_transport_mode text NOT NULL DEFAULT 'bus'
    CHECK (return_transport_mode IN ('bus', 'self')),
  outbound_bus_run_code text,
  return_bus_run_code text,
  pickup_order integer,
  trip_pickup_address_override text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_support_bookings_person_check CHECK (
    (person_kind IN ('staff', 'volunteer') AND staff_id IS NOT NULL AND carer_id IS NULL)
    OR (person_kind = 'carer' AND carer_id IS NOT NULL AND staff_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS event_support_bookings_event_staff_uidx
  ON public.event_support_bookings (event_id, staff_id)
  WHERE staff_id IS NOT NULL AND booking_status <> 'Cancelled';

CREATE UNIQUE INDEX IF NOT EXISTS event_support_bookings_event_carer_uidx
  ON public.event_support_bookings (event_id, carer_id)
  WHERE carer_id IS NOT NULL AND booking_status <> 'Cancelled';

CREATE INDEX IF NOT EXISTS event_support_bookings_event_idx
  ON public.event_support_bookings (event_id);

COMMENT ON TABLE public.event_support_bookings IS
  'BL-125 planned staff / volunteer / carer on a trip, with own IN/HOME methods.';

-- ---------- 7) Trip support presence ----------
CREATE TABLE IF NOT EXISTS public.event_support_attendance_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_day_session_id uuid NOT NULL REFERENCES public.event_day_sessions(id) ON DELETE CASCADE,
  person_kind text NOT NULL
    CHECK (person_kind IN ('staff', 'volunteer', 'carer')),
  staff_id uuid REFERENCES public.staff_registry(id) ON DELETE CASCADE,
  carer_id uuid REFERENCES public.carers_registry(id) ON DELETE CASCADE,
  linked_participant_id uuid REFERENCES public.participants(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'expected'
    CHECK (status IN ('expected', 'checked_in', 'checked_out', 'absent')),
  arrival_method text
    CHECK (arrival_method IS NULL OR arrival_method IN ('bus', 'private', 'walk_in', 'other')),
  arrival_bus_run_code text,
  return_transport text
    CHECK (return_transport IS NULL OR return_transport IN ('bus', 'self')),
  return_bus_run_code text,
  checked_in_at timestamptz,
  checked_in_by uuid REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  checked_out_at timestamptz,
  checked_out_by uuid REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_support_attendance_log_person_check CHECK (
    (person_kind IN ('staff', 'volunteer') AND staff_id IS NOT NULL AND carer_id IS NULL)
    OR (person_kind = 'carer' AND carer_id IS NOT NULL AND staff_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS event_support_attendance_log_session_staff_uidx
  ON public.event_support_attendance_log (event_day_session_id, staff_id)
  WHERE staff_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS event_support_attendance_log_session_carer_uidx
  ON public.event_support_attendance_log (event_day_session_id, carer_id)
  WHERE carer_id IS NOT NULL;

COMMENT ON TABLE public.event_support_attendance_log IS
  'BL-125 Event Deliver presence for staff / volunteer / carer.';

-- ---------- 8) Bus manifest can name staff riders ----------
ALTER TABLE public.event_bus_manifest
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staff_registry(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.event_bus_manifest.staff_id IS
  'BL-125: staff/volunteer seat on this hop / IN / HOME run.';

-- ---------- 9) RLS — authenticated + service_role only (BL-117) ----------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'support_attendance_schedules',
    'support_roster_logs',
    'support_attendance_log',
    'event_support_bookings',
    'event_support_attendance_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS kinship_authenticated_all_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY kinship_authenticated_all_%I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      t, t
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Validation (DDL-only run returns no rows — that is expected):
--
-- Expect 5 tables:
--   SELECT to_regclass('public.support_attendance_schedules') AS schedules,
--          to_regclass('public.support_roster_logs') AS roster_logs,
--          to_regclass('public.support_attendance_log') AS day_log,
--          to_regclass('public.event_support_bookings') AS trip_bookings,
--          to_regclass('public.event_support_attendance_log') AS trip_log;
--
-- Expect 4 trip_legs person-ref columns:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'trip_legs'
--     AND column_name IN ('from_staff_id','to_staff_id','from_carer_id','to_carer_id')
--   ORDER BY column_name;
--
-- Expect bus_run_default_routes person_kind + staff_id + carer_id:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'bus_run_default_routes'
--     AND column_name IN ('person_kind','staff_id','carer_id')
--   ORDER BY column_name;
--
-- Expect event_bus_manifest.staff_id:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'event_bus_manifest'
--     AND column_name = 'staff_id';
-- =============================================================================
