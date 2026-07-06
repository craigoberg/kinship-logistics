-- 2026-07-16 — GUARDRAILS §12 Phase 0: Venue registry + outing trip schema
--
-- Schema-only foundation for:
--   • Venue Management registry (§12.2)
--   • Event planning extensions — event_kind, venue stops, roster transport modes (§12.3)
--   • Event day sessions + bus check-on manifest (§12.4)
--   • Multi-day curfew / morning rolls (§12.5)
--
-- Idempotent. Run in Supabase SQL editor before Phase 1 UI work.
-- Does NOT backfill legacy events — existing rows keep event_kind = 'legacy'.

-- ============================================================================
-- 1. venues — managed destination registry (§12.2.1)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.venues (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  venue_type            text NOT NULL DEFAULT 'general',
  status                text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'archived')),
  street_address        text,
  gps_lat               numeric,
  gps_lng               numeric,
  access_notes          text,
  site_contact_name     text,
  site_contact_phone    text,
  max_safe_group_size   integer,
  risk_tier             text NOT NULL DEFAULT 'medium'
                        CHECK (risk_tier IN ('low', 'medium', 'high')),
  cloned_from_venue_id  uuid REFERENCES public.venues(id) ON DELETE SET NULL,
  created_by_staff_id   uuid REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS venues_status_idx
  ON public.venues (status);
CREATE INDEX IF NOT EXISTS venues_name_idx
  ON public.venues (lower(name));

COMMENT ON TABLE public.venues IS
  'Managed venue registry for out-of-centre outings (§12.2). Replaces free-text-only venue_name over time.';

-- ============================================================================
-- 2. venue_template_fields — variable safety prompts (§12.2.2)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.venue_template_fields (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  prompt          text NOT NULL,
  answer_type     text NOT NULL DEFAULT 'yes_no'
                  CHECK (answer_type IN ('yes_no', 'text', 'number', 'select')),
  options_json    jsonb,
  is_mandatory    boolean NOT NULL DEFAULT true,
  is_system_core  boolean NOT NULL DEFAULT false,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS venue_template_fields_venue_idx
  ON public.venue_template_fields (venue_id, sort_order);

COMMENT ON TABLE public.venue_template_fields IS
  'Per-venue safety checklist field definitions. Clone copies structure only — never answers (§12.2.2).';

-- ============================================================================
-- 3. venue_safety_baseline_signoffs + answers (§12.2.2)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.venue_safety_baseline_signoffs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id              uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  signed_off_by_staff_id uuid REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  signed_off_at         timestamptz NOT NULL DEFAULT now(),
  evidence_ref          text NOT NULL,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS venue_safety_baseline_signoffs_venue_idx
  ON public.venue_safety_baseline_signoffs (venue_id, signed_off_at DESC);

COMMENT ON COLUMN public.venue_safety_baseline_signoffs.evidence_ref IS
  'Manager evidence reference (§4.3 — minimum 20 characters). Ledger receipt written by API layer.';

CREATE TABLE IF NOT EXISTS public.venue_safety_answers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signoff_id        uuid NOT NULL REFERENCES public.venue_safety_baseline_signoffs(id) ON DELETE CASCADE,
  field_id          uuid NOT NULL REFERENCES public.venue_template_fields(id) ON DELETE CASCADE,
  answer_text       text,
  answer_json       jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signoff_id, field_id)
);

CREATE INDEX IF NOT EXISTS venue_safety_answers_signoff_idx
  ON public.venue_safety_answers (signoff_id);

-- ============================================================================
-- 4. event_venue_reconfirmations — per-event “still valid?” (§12.2.2)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.event_venue_reconfirmations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                uuid NOT NULL REFERENCES public.event_manifest(id) ON DELETE CASCADE,
  venue_id                uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  reconfirmed_by_staff_id uuid REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  reconfirmed_at          timestamptz NOT NULL DEFAULT now(),
  still_valid             boolean NOT NULL DEFAULT true,
  notes                   text,
  evidence_ref            text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, venue_id)
);

CREATE INDEX IF NOT EXISTS event_venue_reconfirmations_event_idx
  ON public.event_venue_reconfirmations (event_id);

-- ============================================================================
-- 5. event_manifest extensions (§12.3.1)
-- ============================================================================

ALTER TABLE public.event_manifest
  ADD COLUMN IF NOT EXISTS event_kind text NOT NULL DEFAULT 'legacy'
    CHECK (event_kind IN ('legacy', 'single_day_outing', 'multi_day_tour')),
  ADD COLUMN IF NOT EXISTS primary_venue_id uuid
    REFERENCES public.venues(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS base_hotel_venue_id uuid
    REFERENCES public.venues(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS curfew_time time,
  ADD COLUMN IF NOT EXISTS morning_roll_time time;

COMMENT ON COLUMN public.event_manifest.event_kind IS
  'legacy = existing centre-linked events; single_day_outing / multi_day_tour = §12 outing trips.';
COMMENT ON COLUMN public.event_manifest.primary_venue_id IS
  'Primary destination FK. venue_name retained as display fallback during migration.';
COMMENT ON COLUMN public.event_manifest.base_hotel_venue_id IS
  'Multi-day tours: hotel/base between daily hops (§12.3.1).';

CREATE INDEX IF NOT EXISTS event_manifest_event_kind_idx
  ON public.event_manifest (event_kind);
CREATE INDEX IF NOT EXISTS event_manifest_primary_venue_idx
  ON public.event_manifest (primary_venue_id)
  WHERE primary_venue_id IS NOT NULL;

-- ============================================================================
-- 6. event_venue_stops — ordered itinerary hops (§12.3.3)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.event_venue_stops (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES public.event_manifest(id) ON DELETE CASCADE,
  session_date    date NOT NULL,
  venue_id        uuid NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
  stop_order      integer NOT NULL CHECK (stop_order >= 0),
  label_override  text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, session_date, stop_order)
);

CREATE INDEX IF NOT EXISTS event_venue_stops_event_date_idx
  ON public.event_venue_stops (event_id, session_date, stop_order);

COMMENT ON TABLE public.event_venue_stops IS
  'Ordered venue sequence per calendar day. Each adjacent pair becomes one transport_trip at runtime (§12.4).';

-- ============================================================================
-- 7. event_day_sessions — mirror site_day_sessions (§12.4.1)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.event_day_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid NOT NULL REFERENCES public.event_manifest(id) ON DELETE CASCADE,
  session_date        date NOT NULL,
  phase               text NOT NULL DEFAULT 'planning'
                      CHECK (phase IN (
                        'planning',
                        'pre_departure',
                        'in_transit',
                        'at_base',
                        'closed_orderly',
                        'closed_incident'
                      )),
  manager_staff_id    uuid REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  curfew_time         time,
  morning_roll_time   time,
  opened_by_id        uuid REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  open_declared_at    timestamptz,
  open_leader_notes   text,
  closed_by_id        uuid REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  close_declared_at   timestamptz,
  close_leader_notes  text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, session_date)
);

CREATE INDEX IF NOT EXISTS event_day_sessions_event_date_idx
  ON public.event_day_sessions (event_id, session_date);
CREATE INDEX IF NOT EXISTS event_day_sessions_phase_idx
  ON public.event_day_sessions (phase);

COMMENT ON TABLE public.event_day_sessions IS
  'One row per event per calendar day. manager_staff_id required before phase leaves planning (§12.3.4).';

-- ============================================================================
-- 8. event_roster_bookings — outbound/return transport modes (§12.3.2)
-- ============================================================================

ALTER TABLE public.event_roster_bookings
  ADD COLUMN IF NOT EXISTS outbound_transport_mode text NOT NULL DEFAULT 'bus'
    CHECK (outbound_transport_mode IN ('bus', 'self')),
  ADD COLUMN IF NOT EXISTS return_transport_mode text NOT NULL DEFAULT 'bus'
    CHECK (return_transport_mode IN ('bus', 'self'));

COMMENT ON COLUMN public.event_roster_bookings.outbound_transport_mode IS
  'Self permitted only on first-day inbound (§12.3.2). Enforced in API.';
COMMENT ON COLUMN public.event_roster_bookings.return_transport_mode IS
  'Self permitted only on last-day outbound (§12.3.2). Enforced in API.';

-- ============================================================================
-- 9. transport_trips — hop linkage (§12.4.2)
-- ============================================================================

ALTER TABLE public.transport_trips
  ADD COLUMN IF NOT EXISTS trip_kind text
    CHECK (trip_kind IS NULL OR trip_kind IN (
      'day_centre', 'event', 'event_venue_hop', 'transport_request'
    )),
  ADD COLUMN IF NOT EXISTS event_day_session_id uuid
    REFERENCES public.event_day_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS venue_stop_from_id uuid
    REFERENCES public.event_venue_stops(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS venue_stop_to_id uuid
    REFERENCES public.event_venue_stops(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hop_index integer;

COMMENT ON COLUMN public.transport_trips.trip_kind IS
  'event_venue_hop = one leg between two event_venue_stops (§12.1 one hop = one trip).';
COMMENT ON COLUMN public.transport_trips.event_day_session_id IS
  'Coordinator session for this hop day (§12.4).';

CREATE INDEX IF NOT EXISTS transport_trips_event_day_session_idx
  ON public.transport_trips (event_day_session_id)
  WHERE event_day_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS transport_trips_trip_kind_idx
  ON public.transport_trips (trip_kind)
  WHERE trip_kind IS NOT NULL;

-- Best-effort backfill for existing rows (safe to re-run).
UPDATE public.transport_trips
   SET trip_kind = 'day_centre'
 WHERE trip_kind IS NULL
   AND bus_run_code IS NOT NULL;

UPDATE public.transport_trips
   SET trip_kind = 'event'
 WHERE trip_kind IS NULL
   AND event_id IS NOT NULL;

-- ============================================================================
-- 10. event_bus_manifest — bus check-on roll (§12.4.2)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.event_bus_manifest (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_day_session_id    uuid NOT NULL REFERENCES public.event_day_sessions(id) ON DELETE CASCADE,
  transport_trip_id       uuid NOT NULL REFERENCES public.transport_trips(id) ON DELETE CASCADE,
  participant_id          uuid REFERENCES public.participants(id) ON DELETE CASCADE,
  carer_id                uuid REFERENCES public.carers_registry(id) ON DELETE CASCADE,
  expected_on_bus         boolean NOT NULL DEFAULT true,
  status                  text NOT NULL DEFAULT 'expected'
                          CHECK (status IN ('expected', 'on_bus', 'not_travelling')),
  checked_on_at           timestamptz,
  checked_on_by           uuid REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (
    participant_id IS NOT NULL OR carer_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS event_bus_manifest_trip_participant_uidx
  ON public.event_bus_manifest (transport_trip_id, participant_id)
  WHERE participant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS event_bus_manifest_trip_carer_uidx
  ON public.event_bus_manifest (transport_trip_id, carer_id)
  WHERE carer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS event_bus_manifest_session_idx
  ON public.event_bus_manifest (event_day_session_id);
CREATE INDEX IF NOT EXISTS event_bus_manifest_trip_status_idx
  ON public.event_bus_manifest (transport_trip_id, status);

COMMENT ON TABLE public.event_bus_manifest IS
  'Live bus check-on roll per hop. Check on to bus before depart — not venue check-in (§12.4.2).';

-- ============================================================================
-- 11. event_curfew_log + event_morning_log (§12.5)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.event_curfew_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_day_session_id  uuid NOT NULL REFERENCES public.event_day_sessions(id) ON DELETE CASCADE,
  participant_id        uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  expected_accounted_at timestamptz NOT NULL,
  accounted_at          timestamptz,
  accounted_by          uuid REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  status                text NOT NULL DEFAULT 'expected'
                        CHECK (status IN ('expected', 'accounted', 'absent')),
  escalation_issue_id   uuid REFERENCES public.site_issues_register(id) ON DELETE SET NULL,
  escalation_severity   text CHECK (escalation_severity IN ('yellow', 'red')),
  escalation_raised_at  timestamptz,
  red_sms_dispatched_at timestamptz,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_day_session_id, participant_id)
);

CREATE INDEX IF NOT EXISTS event_curfew_log_session_idx
  ON public.event_curfew_log (event_day_session_id);
CREATE INDEX IF NOT EXISTS event_curfew_log_status_idx
  ON public.event_curfew_log (status);
CREATE INDEX IF NOT EXISTS event_curfew_log_expected_idx
  ON public.event_curfew_log (expected_accounted_at);

CREATE TABLE IF NOT EXISTS public.event_morning_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_day_session_id  uuid NOT NULL REFERENCES public.event_day_sessions(id) ON DELETE CASCADE,
  participant_id        uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  expected_accounted_at timestamptz NOT NULL,
  accounted_at          timestamptz,
  accounted_by          uuid REFERENCES public.staff_registry(id) ON DELETE SET NULL,
  status                text NOT NULL DEFAULT 'expected'
                        CHECK (status IN ('expected', 'accounted', 'absent')),
  escalation_issue_id   uuid REFERENCES public.site_issues_register(id) ON DELETE SET NULL,
  escalation_severity   text CHECK (escalation_severity IN ('yellow', 'red')),
  escalation_raised_at  timestamptz,
  red_sms_dispatched_at timestamptz,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_day_session_id, participant_id)
);

CREATE INDEX IF NOT EXISTS event_morning_log_session_idx
  ON public.event_morning_log (event_day_session_id);
CREATE INDEX IF NOT EXISTS event_morning_log_status_idx
  ON public.event_morning_log (status);
CREATE INDEX IF NOT EXISTS event_morning_log_expected_idx
  ON public.event_morning_log (expected_accounted_at);

COMMENT ON TABLE public.event_curfew_log IS
  'Multi-day curfew accountability — YELLOW→RED single-rail escalator (§12.5, mirrors client_attendance_log).';
COMMENT ON TABLE public.event_morning_log IS
  'Multi-day morning roll — same escalation semantics as event_curfew_log (§12.5).';

-- ============================================================================
-- 12. Helper — seed mandatory core safety fields for a new venue (§12.2.2)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seed_venue_mandatory_safety_fields(p_venue_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_venue_id IS NULL THEN
    RAISE EXCEPTION 'seed_venue_mandatory_safety_fields: venue_id is required';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.venue_template_fields WHERE venue_id = p_venue_id LIMIT 1
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.venue_template_fields (venue_id, prompt, answer_type, is_mandatory, is_system_core, sort_order)
  VALUES
    (p_venue_id, 'Wheelchair / access ramps available and usable?', 'yes_no', true, true, 10),
    (p_venue_id, 'Accessible toilet available?', 'yes_no', true, true, 20),
    (p_venue_id, 'Emergency exits identified and unobstructed?', 'yes_no', true, true, 30),
    (p_venue_id, 'Evacuation muster point location', 'text', true, true, 40),
    (p_venue_id, 'Maximum safe group size at this venue', 'number', true, true, 50),
    (p_venue_id, 'Site contact briefed on our group requirements?', 'yes_no', true, true, 60),
    (p_venue_id, 'First-aid / emergency contact on site confirmed?', 'yes_no', true, true, 70);
END;
$$;

COMMENT ON FUNCTION public.seed_venue_mandatory_safety_fields(uuid) IS
  'Inserts §12.2.2 system mandatory core fields for a venue. Called by Phase 1 Venues UI on create/clone.';

-- ============================================================================
-- 13. system_parameters — curfew / morning sweep thresholds (§12.5)
-- ============================================================================

INSERT INTO public.system_parameters (key, value, description)
VALUES
  (
    'event_curfew_yellow_mins_before',
    '15'::jsonb,
    'Minutes before curfew_time when a YELLOW curfew row is logged for an unaccounted participant.'
  ),
  (
    'event_curfew_red_mins_after',
    '30'::jsonb,
    'Minutes after curfew_time when the same site_issues_register row promotes to RED and SMS fires.'
  ),
  (
    'event_curfew_red_sms_recipients',
    'null'::jsonb,
    'Comma-separated E.164 numbers for curfew RED SMS. Null = all active managers in staff_registry.'
  ),
  (
    'event_morning_yellow_mins_before',
    '15'::jsonb,
    'Minutes before morning_roll_time when YELLOW is logged for an unaccounted participant.'
  ),
  (
    'event_morning_red_mins_after',
    '30'::jsonb,
    'Minutes after morning_roll_time when the row promotes to RED and SMS fires.'
  ),
  (
    'event_morning_red_sms_recipients',
    'null'::jsonb,
    'Comma-separated E.164 numbers for morning-roll RED SMS. Null = all active managers.'
  ),
  (
    'venue_baseline_reconfirm_days',
    '365'::jsonb,
    'Days after baseline sign-off before per-event venue reconfirmation is required before Confirmed status.'
  )
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 14. updated_at triggers
-- ============================================================================

CREATE OR REPLACE FUNCTION public.touch_row_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'venues',
    'venue_template_fields',
    'event_venue_stops',
    'event_day_sessions',
    'event_bus_manifest',
    'event_curfew_log',
    'event_morning_log'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_touch_%I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_row_updated_at()',
      t, t
    );
  END LOOP;
END;
$$;

-- ============================================================================
-- 15. Grants + RLS (mirror client_attendance_log — PIN session writes)
-- ============================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'venues',
    'venue_template_fields',
    'venue_safety_baseline_signoffs',
    'venue_safety_answers',
    'event_venue_reconfirmations',
    'event_venue_stops',
    'event_day_sessions',
    'event_bus_manifest',
    'event_curfew_log',
    'event_morning_log'
  ]
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated',
      t
    );
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS "%I readable" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "%I readable" ON public.%I FOR SELECT TO anon, authenticated USING (true)',
      t, t
    );

    EXECUTE format('DROP POLICY IF EXISTS "%I writable" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "%I writable" ON public.%I FOR INSERT TO anon, authenticated WITH CHECK (true)',
      t, t
    );

    EXECUTE format('DROP POLICY IF EXISTS "%I updatable" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "%I updatable" ON public.%I FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true)',
      t, t
    );
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
