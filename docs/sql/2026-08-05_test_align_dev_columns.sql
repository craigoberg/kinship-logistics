-- ============================================================================
-- 2026-08-05 — TEST: align public columns (tables / ADD / DEFAULT / NULL) to DEV
--
-- SOURCE: docs/architecture/dev-schema-dumps/columns.json (817 cols)
-- GENERATOR: scripts/generate-test-align-dev-columns.mjs
--
-- Creates tables missing from bootstrap: operational_emergencies, operational_emergency_muster
-- Then ADD COLUMN / DEFAULT / NOT NULL to match DEV.
--
-- After this file, re-run:
--   docs/sql/2026-08-05_test_align_dev_constraints.sql
-- (so FKs on newly created tables are applied).
--
-- Safe: idempotent. NOT NULL failures → NOTICE (do not abort).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- 0) Enums required by known USER-DEFINED columns
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.site_session_status AS ENUM (
    'open_pending', 'active_day', 'escalated_lock', 'closed_orderly', 'closed_no_go'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.responsibility_owner AS ENUM ('internal', 'council');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.ryge_severity AS ENUM ('green', 'yellow', 'red');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Promote bootstrap text columns to DEV enums when safe
-- (full promote also in 2026-08-05_test_align_dev_enums_funcs_triggers.sql)
DO $$ BEGIN
  ALTER TABLE public.site_day_sessions
    ALTER COLUMN phase TYPE public.site_session_status
    USING phase::text::public.site_session_status;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP type promote site_day_sessions.phase: %', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.site_issues_register
    ALTER COLUMN severity TYPE public.ryge_severity
    USING severity::text::public.ryge_severity;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP type promote site_issues_register.severity: %', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.site_issues_register
    ALTER COLUMN owner TYPE public.responsibility_owner
    USING NULLIF(owner::text, '')::public.responsibility_owner;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP type promote site_issues_register.owner: %', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- 1) CREATE TABLE for DEV tables missing from OpenAPI bootstrap
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.operational_emergencies (
  id uuid DEFAULT gen_random_uuid(),
  mode text,
  severity text,
  situation_text text,
  status text DEFAULT 'active',
  site_day_session_id uuid,
  event_id uuid,
  event_day_session_id uuid,
  surface text DEFAULT 'centre',
  activated_by_staff_id uuid,
  activated_at timestamptz DEFAULT now(),
  stood_down_by_staff_id uuid,
  stood_down_at timestamptz,
  debrief_text text,
  hub_issue_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id)
);

ALTER TABLE public.operational_emergencies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_operational_emergencies ON public.operational_emergencies;
CREATE POLICY kinship_anon_all_operational_emergencies ON public.operational_emergencies
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.operational_emergencies TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.operational_emergency_muster (
  id uuid DEFAULT gen_random_uuid(),
  emergency_id uuid,
  participant_id uuid,
  participant_name text,
  state text DEFAULT 'expected',
  updated_by_staff_id uuid,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id)
);

ALTER TABLE public.operational_emergency_muster ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_operational_emergency_muster ON public.operational_emergency_muster;
CREATE POLICY kinship_anon_all_operational_emergency_muster ON public.operational_emergency_muster
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.operational_emergency_muster TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) ADD COLUMN IF NOT EXISTS
-- ---------------------------------------------------------------------------

-- asset_checkpoints
ALTER TABLE public.asset_checkpoints ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.asset_checkpoints ADD COLUMN IF NOT EXISTS checkpoint_text text;
ALTER TABLE public.asset_checkpoints ADD COLUMN IF NOT EXISTS vehicle_category text;
ALTER TABLE public.asset_checkpoints ADD COLUMN IF NOT EXISTS asset_id uuid;
ALTER TABLE public.asset_checkpoints ADD COLUMN IF NOT EXISTS impact_level text DEFAULT 'minor_log_only';
ALTER TABLE public.asset_checkpoints ADD COLUMN IF NOT EXISTS is_mandatory boolean DEFAULT true;

-- asset_clearance_items
ALTER TABLE public.asset_clearance_items ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.asset_clearance_items ADD COLUMN IF NOT EXISTS clearance_id uuid;
ALTER TABLE public.asset_clearance_items ADD COLUMN IF NOT EXISTS checkpoint_id uuid;
ALTER TABLE public.asset_clearance_items ADD COLUMN IF NOT EXISTS is_passed boolean;
ALTER TABLE public.asset_clearance_items ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.asset_clearance_items ADD COLUMN IF NOT EXISTS severity text;
ALTER TABLE public.asset_clearance_items ADD COLUMN IF NOT EXISTS workaround_text text;

-- asset_daily_clearance
ALTER TABLE public.asset_daily_clearance ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.asset_daily_clearance ADD COLUMN IF NOT EXISTS asset_id uuid;
ALTER TABLE public.asset_daily_clearance ADD COLUMN IF NOT EXISTS clearance_date date DEFAULT CURRENT_DATE;
ALTER TABLE public.asset_daily_clearance ADD COLUMN IF NOT EXISTS driver_staff_id uuid;
ALTER TABLE public.asset_daily_clearance ADD COLUMN IF NOT EXISTS start_odometer integer;
ALTER TABLE public.asset_daily_clearance ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.asset_daily_clearance ADD COLUMN IF NOT EXISTS accumulated_issues text;
ALTER TABLE public.asset_daily_clearance ADD COLUMN IF NOT EXISTS driver_comfort_declared boolean DEFAULT false;
ALTER TABLE public.asset_daily_clearance ADD COLUMN IF NOT EXISTS requires_manager_review boolean DEFAULT false;
ALTER TABLE public.asset_daily_clearance ADD COLUMN IF NOT EXISTS driver_auth_staff_id uuid;
ALTER TABLE public.asset_daily_clearance ADD COLUMN IF NOT EXISTS driver_auth_pin_verified_at timestamptz;
ALTER TABLE public.asset_daily_clearance ADD COLUMN IF NOT EXISTS manager_auth_staff_id uuid;
ALTER TABLE public.asset_daily_clearance ADD COLUMN IF NOT EXISTS manager_auth_pin_verified_at timestamptz;

-- asset_maintenance_logs
ALTER TABLE public.asset_maintenance_logs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.asset_maintenance_logs ADD COLUMN IF NOT EXISTS asset_id uuid;
ALTER TABLE public.asset_maintenance_logs ADD COLUMN IF NOT EXISTS logged_by_id uuid;
ALTER TABLE public.asset_maintenance_logs ADD COLUMN IF NOT EXISTS log_type text;
ALTER TABLE public.asset_maintenance_logs ADD COLUMN IF NOT EXISTS log_date date DEFAULT CURRENT_DATE;
ALTER TABLE public.asset_maintenance_logs ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.asset_maintenance_logs ADD COLUMN IF NOT EXISTS cost numeric DEFAULT 0.00;
ALTER TABLE public.asset_maintenance_logs ADD COLUMN IF NOT EXISTS current_odometer_reading numeric;
ALTER TABLE public.asset_maintenance_logs ADD COLUMN IF NOT EXISTS is_resolved boolean DEFAULT true;
ALTER TABLE public.asset_maintenance_logs ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.asset_maintenance_logs ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT timezone('utc'::text, now());

-- assets
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS asset_name text;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS asset_type text;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS status text DEFAULT 'Active';
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS identifier_string text;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS insurance_policy_number text;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS insurance_expiry date;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS next_compliance_review_date date;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS custom_specifications jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT timezone('utc'::text, now());
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT timezone('utc'::text, now());

-- attendance_roster_logs
ALTER TABLE public.attendance_roster_logs ADD COLUMN IF NOT EXISTS id uuid DEFAULT uuid_generate_v4();
ALTER TABLE public.attendance_roster_logs ADD COLUMN IF NOT EXISTS participant_id uuid;
ALTER TABLE public.attendance_roster_logs ADD COLUMN IF NOT EXISTS roster_date date;
ALTER TABLE public.attendance_roster_logs ADD COLUMN IF NOT EXISTS expected_service text;
ALTER TABLE public.attendance_roster_logs ADD COLUMN IF NOT EXISTS actual_status text;
ALTER TABLE public.attendance_roster_logs ADD COLUMN IF NOT EXISTS driver_notes text;
ALTER TABLE public.attendance_roster_logs ADD COLUMN IF NOT EXISTS recorded_by_uuid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;
ALTER TABLE public.attendance_roster_logs ADD COLUMN IF NOT EXISTS device_uuid text DEFAULT 'browser-client';
ALTER TABLE public.attendance_roster_logs ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.attendance_roster_logs ADD COLUMN IF NOT EXISTS billing_state text DEFAULT 'pending';
ALTER TABLE public.attendance_roster_logs ADD COLUMN IF NOT EXISTS ndis_cancellation_reason text;
ALTER TABLE public.attendance_roster_logs ADD COLUMN IF NOT EXISTS exported_at timestamptz;
ALTER TABLE public.attendance_roster_logs ADD COLUMN IF NOT EXISTS exported_batch_id uuid;

-- carers_registry
ALTER TABLE public.carers_registry ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.carers_registry ADD COLUMN IF NOT EXISTS participant_id uuid;
ALTER TABLE public.carers_registry ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE public.carers_registry ADD COLUMN IF NOT EXISTS relationship text;
ALTER TABLE public.carers_registry ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.carers_registry ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.carers_registry ADD COLUMN IF NOT EXISTS street_address text;
ALTER TABLE public.carers_registry ADD COLUMN IF NOT EXISTS is_primary_contact boolean DEFAULT false;
ALTER TABLE public.carers_registry ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.carers_registry ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT timezone('utc'::text, now());

-- centre_operating_hours
ALTER TABLE public.centre_operating_hours ADD COLUMN IF NOT EXISTS day_of_week text;
ALTER TABLE public.centre_operating_hours ADD COLUMN IF NOT EXISTS open_time time without time zone DEFAULT '09:00:00'::time without time zone;
ALTER TABLE public.centre_operating_hours ADD COLUMN IF NOT EXISTS close_time time without time zone DEFAULT '15:00:00'::time without time zone;
ALTER TABLE public.centre_operating_hours ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.centre_operating_hours ADD COLUMN IF NOT EXISTS updated_by_staff_id uuid;

-- charge_codes
ALTER TABLE public.charge_codes ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.charge_codes ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE public.charge_codes ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.charge_codes ADD COLUMN IF NOT EXISTS standard_rate numeric;
ALTER TABLE public.charge_codes ADD COLUMN IF NOT EXISTS unit_type text DEFAULT 'Hourly';
ALTER TABLE public.charge_codes ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT timezone('utc'::text, now());

-- checklist_items
ALTER TABLE public.checklist_items ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.checklist_items ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE public.checklist_items ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.checklist_items ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 100;
ALTER TABLE public.checklist_items ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
ALTER TABLE public.checklist_items ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- checklist_responses
ALTER TABLE public.checklist_responses ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.checklist_responses ADD COLUMN IF NOT EXISTS ledger_id uuid;
ALTER TABLE public.checklist_responses ADD COLUMN IF NOT EXISTS item_id uuid;
ALTER TABLE public.checklist_responses ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.checklist_responses ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.checklist_responses ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- client_attendance_log
ALTER TABLE public.client_attendance_log ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.client_attendance_log ADD COLUMN IF NOT EXISTS session_id uuid;
ALTER TABLE public.client_attendance_log ADD COLUMN IF NOT EXISTS participant_id uuid;
ALTER TABLE public.client_attendance_log ADD COLUMN IF NOT EXISTS expected_arrival_at timestamptz;
ALTER TABLE public.client_attendance_log ADD COLUMN IF NOT EXISTS arrival_method text DEFAULT 'bus';
ALTER TABLE public.client_attendance_log ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;
ALTER TABLE public.client_attendance_log ADD COLUMN IF NOT EXISTS checked_in_by uuid;
ALTER TABLE public.client_attendance_log ADD COLUMN IF NOT EXISTS checked_out_at timestamptz;
ALTER TABLE public.client_attendance_log ADD COLUMN IF NOT EXISTS checked_out_by uuid;
ALTER TABLE public.client_attendance_log ADD COLUMN IF NOT EXISTS status text DEFAULT 'expected';
ALTER TABLE public.client_attendance_log ADD COLUMN IF NOT EXISTS escalation_issue_id uuid;
ALTER TABLE public.client_attendance_log ADD COLUMN IF NOT EXISTS escalation_severity text;
ALTER TABLE public.client_attendance_log ADD COLUMN IF NOT EXISTS escalation_raised_at timestamptz;
ALTER TABLE public.client_attendance_log ADD COLUMN IF NOT EXISTS red_sms_dispatched_at timestamptz;
ALTER TABLE public.client_attendance_log ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.client_attendance_log ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.client_attendance_log ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.client_attendance_log ADD COLUMN IF NOT EXISTS expected_departure_at timestamptz;
ALTER TABLE public.client_attendance_log ADD COLUMN IF NOT EXISTS departure_issue_id uuid;
ALTER TABLE public.client_attendance_log ADD COLUMN IF NOT EXISTS departure_severity text;
ALTER TABLE public.client_attendance_log ADD COLUMN IF NOT EXISTS departure_raised_at timestamptz;
ALTER TABLE public.client_attendance_log ADD COLUMN IF NOT EXISTS departure_red_sms_dispatched_at timestamptz;
ALTER TABLE public.client_attendance_log ADD COLUMN IF NOT EXISTS arrival_bus_run_code text;

-- compliance_assets
ALTER TABLE public.compliance_assets ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.compliance_assets ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.compliance_assets ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE public.compliance_assets ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.compliance_assets ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.compliance_assets ADD COLUMN IF NOT EXISTS subject_table text;
ALTER TABLE public.compliance_assets ADD COLUMN IF NOT EXISTS subject_id uuid;
ALTER TABLE public.compliance_assets ADD COLUMN IF NOT EXISTS expiry_date date;
ALTER TABLE public.compliance_assets ADD COLUMN IF NOT EXISTS next_action_at timestamptz;
ALTER TABLE public.compliance_assets ADD COLUMN IF NOT EXISTS action_module text DEFAULT 'generic_resolve';
ALTER TABLE public.compliance_assets ADD COLUMN IF NOT EXISTS config jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.compliance_assets ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
ALTER TABLE public.compliance_assets ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.compliance_assets ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.compliance_assets ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- compliance_audit_logs
ALTER TABLE public.compliance_audit_logs ADD COLUMN IF NOT EXISTS id uuid DEFAULT uuid_generate_v4();
ALTER TABLE public.compliance_audit_logs ADD COLUMN IF NOT EXISTS participant_id uuid;
ALTER TABLE public.compliance_audit_logs ADD COLUMN IF NOT EXISTS action_performed text;
ALTER TABLE public.compliance_audit_logs ADD COLUMN IF NOT EXISTS witness_1_identity text;
ALTER TABLE public.compliance_audit_logs ADD COLUMN IF NOT EXISTS witness_2_identity text;
ALTER TABLE public.compliance_audit_logs ADD COLUMN IF NOT EXISTS timestamp timestamptz DEFAULT now();
ALTER TABLE public.compliance_audit_logs ADD COLUMN IF NOT EXISTS metadata jsonb;

-- event_activity_rolls
ALTER TABLE public.event_activity_rolls ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.event_activity_rolls ADD COLUMN IF NOT EXISTS venue_stop_id uuid;
ALTER TABLE public.event_activity_rolls ADD COLUMN IF NOT EXISTS event_day_session_id uuid;
ALTER TABLE public.event_activity_rolls ADD COLUMN IF NOT EXISTS participant_id uuid;
ALTER TABLE public.event_activity_rolls ADD COLUMN IF NOT EXISTS status text DEFAULT 'expected';
ALTER TABLE public.event_activity_rolls ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;
ALTER TABLE public.event_activity_rolls ADD COLUMN IF NOT EXISTS checked_in_by_id uuid;
ALTER TABLE public.event_activity_rolls ADD COLUMN IF NOT EXISTS marked_absent_at timestamptz;
ALTER TABLE public.event_activity_rolls ADD COLUMN IF NOT EXISTS marked_absent_by_id uuid;
ALTER TABLE public.event_activity_rolls ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.event_activity_rolls ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- event_attendance_log
ALTER TABLE public.event_attendance_log ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.event_attendance_log ADD COLUMN IF NOT EXISTS event_day_session_id uuid;
ALTER TABLE public.event_attendance_log ADD COLUMN IF NOT EXISTS participant_id uuid;
ALTER TABLE public.event_attendance_log ADD COLUMN IF NOT EXISTS expected_arrival_at timestamptz;
ALTER TABLE public.event_attendance_log ADD COLUMN IF NOT EXISTS arrival_method text DEFAULT 'bus';
ALTER TABLE public.event_attendance_log ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;
ALTER TABLE public.event_attendance_log ADD COLUMN IF NOT EXISTS checked_in_by uuid;
ALTER TABLE public.event_attendance_log ADD COLUMN IF NOT EXISTS checked_out_at timestamptz;
ALTER TABLE public.event_attendance_log ADD COLUMN IF NOT EXISTS checked_out_by uuid;
ALTER TABLE public.event_attendance_log ADD COLUMN IF NOT EXISTS status text DEFAULT 'expected';
ALTER TABLE public.event_attendance_log ADD COLUMN IF NOT EXISTS return_transport text;
ALTER TABLE public.event_attendance_log ADD COLUMN IF NOT EXISTS escalation_issue_id uuid;
ALTER TABLE public.event_attendance_log ADD COLUMN IF NOT EXISTS escalation_severity text;
ALTER TABLE public.event_attendance_log ADD COLUMN IF NOT EXISTS escalation_raised_at timestamptz;
ALTER TABLE public.event_attendance_log ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.event_attendance_log ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.event_attendance_log ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.event_attendance_log ADD COLUMN IF NOT EXISTS arrival_bus_run_code text;
ALTER TABLE public.event_attendance_log ADD COLUMN IF NOT EXISTS return_bus_run_code text;

-- event_bus_manifest
ALTER TABLE public.event_bus_manifest ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.event_bus_manifest ADD COLUMN IF NOT EXISTS event_day_session_id uuid;
ALTER TABLE public.event_bus_manifest ADD COLUMN IF NOT EXISTS transport_trip_id uuid;
ALTER TABLE public.event_bus_manifest ADD COLUMN IF NOT EXISTS participant_id uuid;
ALTER TABLE public.event_bus_manifest ADD COLUMN IF NOT EXISTS carer_id uuid;
ALTER TABLE public.event_bus_manifest ADD COLUMN IF NOT EXISTS expected_on_bus boolean DEFAULT true;
ALTER TABLE public.event_bus_manifest ADD COLUMN IF NOT EXISTS status text DEFAULT 'expected';
ALTER TABLE public.event_bus_manifest ADD COLUMN IF NOT EXISTS checked_on_at timestamptz;
ALTER TABLE public.event_bus_manifest ADD COLUMN IF NOT EXISTS checked_on_by uuid;
ALTER TABLE public.event_bus_manifest ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.event_bus_manifest ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.event_bus_manifest ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- event_curfew_log
ALTER TABLE public.event_curfew_log ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.event_curfew_log ADD COLUMN IF NOT EXISTS event_day_session_id uuid;
ALTER TABLE public.event_curfew_log ADD COLUMN IF NOT EXISTS participant_id uuid;
ALTER TABLE public.event_curfew_log ADD COLUMN IF NOT EXISTS expected_accounted_at timestamptz;
ALTER TABLE public.event_curfew_log ADD COLUMN IF NOT EXISTS accounted_at timestamptz;
ALTER TABLE public.event_curfew_log ADD COLUMN IF NOT EXISTS accounted_by uuid;
ALTER TABLE public.event_curfew_log ADD COLUMN IF NOT EXISTS status text DEFAULT 'expected';
ALTER TABLE public.event_curfew_log ADD COLUMN IF NOT EXISTS escalation_issue_id uuid;
ALTER TABLE public.event_curfew_log ADD COLUMN IF NOT EXISTS escalation_severity text;
ALTER TABLE public.event_curfew_log ADD COLUMN IF NOT EXISTS escalation_raised_at timestamptz;
ALTER TABLE public.event_curfew_log ADD COLUMN IF NOT EXISTS red_sms_dispatched_at timestamptz;
ALTER TABLE public.event_curfew_log ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.event_curfew_log ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.event_curfew_log ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- event_day_med_alternate_plans
ALTER TABLE public.event_day_med_alternate_plans ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.event_day_med_alternate_plans ADD COLUMN IF NOT EXISTS event_day_session_id uuid;
ALTER TABLE public.event_day_med_alternate_plans ADD COLUMN IF NOT EXISTS participant_id uuid;
ALTER TABLE public.event_day_med_alternate_plans ADD COLUMN IF NOT EXISTS plan_note text;
ALTER TABLE public.event_day_med_alternate_plans ADD COLUMN IF NOT EXISTS attested_by_staff_id uuid;
ALTER TABLE public.event_day_med_alternate_plans ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- event_day_sessions
ALTER TABLE public.event_day_sessions ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.event_day_sessions ADD COLUMN IF NOT EXISTS event_id uuid;
ALTER TABLE public.event_day_sessions ADD COLUMN IF NOT EXISTS session_date date;
ALTER TABLE public.event_day_sessions ADD COLUMN IF NOT EXISTS phase text DEFAULT 'planning';
ALTER TABLE public.event_day_sessions ADD COLUMN IF NOT EXISTS manager_staff_id uuid;
ALTER TABLE public.event_day_sessions ADD COLUMN IF NOT EXISTS curfew_time time without time zone;
ALTER TABLE public.event_day_sessions ADD COLUMN IF NOT EXISTS morning_roll_time time without time zone;
ALTER TABLE public.event_day_sessions ADD COLUMN IF NOT EXISTS opened_by_id uuid;
ALTER TABLE public.event_day_sessions ADD COLUMN IF NOT EXISTS open_declared_at timestamptz;
ALTER TABLE public.event_day_sessions ADD COLUMN IF NOT EXISTS open_leader_notes text;
ALTER TABLE public.event_day_sessions ADD COLUMN IF NOT EXISTS closed_by_id uuid;
ALTER TABLE public.event_day_sessions ADD COLUMN IF NOT EXISTS close_declared_at timestamptz;
ALTER TABLE public.event_day_sessions ADD COLUMN IF NOT EXISTS close_leader_notes text;
ALTER TABLE public.event_day_sessions ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.event_day_sessions ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.event_day_sessions ADD COLUMN IF NOT EXISTS expected_arrival_by timestamptz;
ALTER TABLE public.event_day_sessions ADD COLUMN IF NOT EXISTS programme_suspended boolean DEFAULT false;
ALTER TABLE public.event_day_sessions ADD COLUMN IF NOT EXISTS programme_suspend_reason text;
ALTER TABLE public.event_day_sessions ADD COLUMN IF NOT EXISTS programme_suspend_severity text;
ALTER TABLE public.event_day_sessions ADD COLUMN IF NOT EXISTS programme_suspend_hub_issue_id uuid;
ALTER TABLE public.event_day_sessions ADD COLUMN IF NOT EXISTS programme_suspended_at timestamptz;
ALTER TABLE public.event_day_sessions ADD COLUMN IF NOT EXISTS programme_suspended_by_staff_id uuid;

-- event_financial_ledger
ALTER TABLE public.event_financial_ledger ADD COLUMN IF NOT EXISTS id uuid DEFAULT uuid_generate_v4();
ALTER TABLE public.event_financial_ledger ADD COLUMN IF NOT EXISTS event_id uuid;
ALTER TABLE public.event_financial_ledger ADD COLUMN IF NOT EXISTS transaction_date date;
ALTER TABLE public.event_financial_ledger ADD COLUMN IF NOT EXISTS financial_code text;
ALTER TABLE public.event_financial_ledger ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.event_financial_ledger ADD COLUMN IF NOT EXISTS amount numeric;
ALTER TABLE public.event_financial_ledger ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- event_manifest
ALTER TABLE public.event_manifest ADD COLUMN IF NOT EXISTS id uuid DEFAULT uuid_generate_v4();
ALTER TABLE public.event_manifest ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.event_manifest ADD COLUMN IF NOT EXISTS event_type text;
ALTER TABLE public.event_manifest ADD COLUMN IF NOT EXISTS venue_name text;
ALTER TABLE public.event_manifest ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE public.event_manifest ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE public.event_manifest ADD COLUMN IF NOT EXISTS ticket_price numeric DEFAULT 0.00;
ALTER TABLE public.event_manifest ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.event_manifest ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.event_manifest ADD COLUMN IF NOT EXISTS status text DEFAULT 'Open';
ALTER TABLE public.event_manifest ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE public.event_manifest ADD COLUMN IF NOT EXISTS closed_by_id uuid;
ALTER TABLE public.event_manifest ADD COLUMN IF NOT EXISTS billing_locked boolean DEFAULT false;
ALTER TABLE public.event_manifest ADD COLUMN IF NOT EXISTS reconciliation_notes text;
ALTER TABLE public.event_manifest ADD COLUMN IF NOT EXISTS default_charge_code_id uuid;
ALTER TABLE public.event_manifest ADD COLUMN IF NOT EXISTS standard_price numeric DEFAULT 0.00;
ALTER TABLE public.event_manifest ADD COLUMN IF NOT EXISTS event_kind text DEFAULT 'legacy';
ALTER TABLE public.event_manifest ADD COLUMN IF NOT EXISTS primary_venue_id uuid;
ALTER TABLE public.event_manifest ADD COLUMN IF NOT EXISTS base_hotel_venue_id uuid;
ALTER TABLE public.event_manifest ADD COLUMN IF NOT EXISTS curfew_time time without time zone;
ALTER TABLE public.event_manifest ADD COLUMN IF NOT EXISTS morning_roll_time time without time zone;

-- event_meal_service_rolls
ALTER TABLE public.event_meal_service_rolls ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.event_meal_service_rolls ADD COLUMN IF NOT EXISTS venue_stop_id uuid;
ALTER TABLE public.event_meal_service_rolls ADD COLUMN IF NOT EXISTS participant_id uuid;
ALTER TABLE public.event_meal_service_rolls ADD COLUMN IF NOT EXISTS status text DEFAULT 'expected';
ALTER TABLE public.event_meal_service_rolls ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.event_meal_service_rolls ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.event_meal_service_rolls ADD COLUMN IF NOT EXISTS updated_by_id uuid;

-- event_morning_log
ALTER TABLE public.event_morning_log ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.event_morning_log ADD COLUMN IF NOT EXISTS event_day_session_id uuid;
ALTER TABLE public.event_morning_log ADD COLUMN IF NOT EXISTS participant_id uuid;
ALTER TABLE public.event_morning_log ADD COLUMN IF NOT EXISTS expected_accounted_at timestamptz;
ALTER TABLE public.event_morning_log ADD COLUMN IF NOT EXISTS accounted_at timestamptz;
ALTER TABLE public.event_morning_log ADD COLUMN IF NOT EXISTS accounted_by uuid;
ALTER TABLE public.event_morning_log ADD COLUMN IF NOT EXISTS status text DEFAULT 'expected';
ALTER TABLE public.event_morning_log ADD COLUMN IF NOT EXISTS escalation_issue_id uuid;
ALTER TABLE public.event_morning_log ADD COLUMN IF NOT EXISTS escalation_severity text;
ALTER TABLE public.event_morning_log ADD COLUMN IF NOT EXISTS escalation_raised_at timestamptz;
ALTER TABLE public.event_morning_log ADD COLUMN IF NOT EXISTS red_sms_dispatched_at timestamptz;
ALTER TABLE public.event_morning_log ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.event_morning_log ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.event_morning_log ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- event_roster_bookings
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS id uuid DEFAULT uuid_generate_v4();
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS event_id uuid;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS participant_id uuid;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS booking_status text;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS amount_paid numeric DEFAULT 0.00;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS is_fully_paid boolean DEFAULT false;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS custom_price numeric;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS brings_carer boolean DEFAULT false;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS carer_transport_required boolean DEFAULT false;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS companion_carer_id uuid;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS carer_id uuid;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS participant_transport_required boolean DEFAULT false;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS finance_verified_at timestamptz;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS funding_claim_type text DEFAULT 'NDIS Plan Managed';
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS charge_code_id uuid;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS quantity_delivered numeric DEFAULT 1.00;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS rate_per_unit_applied numeric;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS total_amount_billed numeric;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS billing_status text DEFAULT 'Unbilled';
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS trip_pickup_address_override text;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS dynamic_medical_notes_snapshot text;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS outbound_transport_mode text DEFAULT 'bus';
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS return_transport_mode text DEFAULT 'bus';
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS transport_med_bag_required text DEFAULT 'not_set';
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS transport_med_notes text;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS pickup_order integer DEFAULT 0;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS outbound_bus_run_code text;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS return_bus_run_code text;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS is_guest_booking boolean DEFAULT false;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS host_participant_id uuid;
ALTER TABLE public.event_roster_bookings ADD COLUMN IF NOT EXISTS guest_ops_note text;

-- event_venue_reconfirmations
ALTER TABLE public.event_venue_reconfirmations ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.event_venue_reconfirmations ADD COLUMN IF NOT EXISTS event_id uuid;
ALTER TABLE public.event_venue_reconfirmations ADD COLUMN IF NOT EXISTS venue_id uuid;
ALTER TABLE public.event_venue_reconfirmations ADD COLUMN IF NOT EXISTS reconfirmed_by_staff_id uuid;
ALTER TABLE public.event_venue_reconfirmations ADD COLUMN IF NOT EXISTS reconfirmed_at timestamptz DEFAULT now();
ALTER TABLE public.event_venue_reconfirmations ADD COLUMN IF NOT EXISTS still_valid boolean DEFAULT true;
ALTER TABLE public.event_venue_reconfirmations ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.event_venue_reconfirmations ADD COLUMN IF NOT EXISTS evidence_ref text;
ALTER TABLE public.event_venue_reconfirmations ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- event_venue_stops
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS event_id uuid;
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS session_date date;
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS venue_id uuid;
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS stop_order integer;
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS label_override text;
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS phase text DEFAULT 'pending';
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS movement_method text DEFAULT 'bus';
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS opened_at timestamptz;
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS opened_by_id uuid;
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS activity_kind text DEFAULT 'venue';
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS meal_slot text;
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS meal_source text;
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS menu_notes text;
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS prepared_by_staff_id uuid;
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS preparer_cert_status text;
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS preparer_ack_note text;
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS prep_checks_completed jsonb;
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS prep_attestation_mode text;
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS prep_attested_by_staff_id uuid;
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS guest_preparer_name text;
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS prep_attestation_note text;
ALTER TABLE public.event_venue_stops ADD COLUMN IF NOT EXISTS sfh_approved_by_staff_id uuid;

-- hub_issue_notes
ALTER TABLE public.hub_issue_notes ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.hub_issue_notes ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.hub_issue_notes ADD COLUMN IF NOT EXISTS source_row_id text;
ALTER TABLE public.hub_issue_notes ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE public.hub_issue_notes ADD COLUMN IF NOT EXISTS kind text DEFAULT 'append';
ALTER TABLE public.hub_issue_notes ADD COLUMN IF NOT EXISTS stamped_at timestamptz DEFAULT now();
ALTER TABLE public.hub_issue_notes ADD COLUMN IF NOT EXISTS staff_id text;
ALTER TABLE public.hub_issue_notes ADD COLUMN IF NOT EXISTS metadata jsonb;

-- maintenance_items
ALTER TABLE public.maintenance_items ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.maintenance_items ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.maintenance_items ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.maintenance_items ADD COLUMN IF NOT EXISTS severity text DEFAULT 'yellow';
ALTER TABLE public.maintenance_items ADD COLUMN IF NOT EXISTS status text DEFAULT 'open';
ALTER TABLE public.maintenance_items ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';
ALTER TABLE public.maintenance_items ADD COLUMN IF NOT EXISTS source_ref_id uuid;
ALTER TABLE public.maintenance_items ADD COLUMN IF NOT EXISTS venue_id uuid;
ALTER TABLE public.maintenance_items ADD COLUMN IF NOT EXISTS event_id uuid;
ALTER TABLE public.maintenance_items ADD COLUMN IF NOT EXISTS location_label text;
ALTER TABLE public.maintenance_items ADD COLUMN IF NOT EXISTS reported_by text;
ALTER TABLE public.maintenance_items ADD COLUMN IF NOT EXISTS assigned_to text;
ALTER TABLE public.maintenance_items ADD COLUMN IF NOT EXISTS resolution_notes text;
ALTER TABLE public.maintenance_items ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE public.maintenance_items ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.maintenance_items ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.maintenance_items ADD COLUMN IF NOT EXISTS deferred_until date;
ALTER TABLE public.maintenance_items ADD COLUMN IF NOT EXISTS deferred_reason text;
ALTER TABLE public.maintenance_items ADD COLUMN IF NOT EXISTS defer_count integer DEFAULT 0;
ALTER TABLE public.maintenance_items ADD COLUMN IF NOT EXISTS last_note_at timestamptz;
ALTER TABLE public.maintenance_items ADD COLUMN IF NOT EXISTS occurred_at timestamptz;

-- maintenance_notes
ALTER TABLE public.maintenance_notes ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.maintenance_notes ADD COLUMN IF NOT EXISTS item_id uuid;
ALTER TABLE public.maintenance_notes ADD COLUMN IF NOT EXISTS note_text text;
ALTER TABLE public.maintenance_notes ADD COLUMN IF NOT EXISTS author text;
ALTER TABLE public.maintenance_notes ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- medication_administration_log
ALTER TABLE public.medication_administration_log ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.medication_administration_log ADD COLUMN IF NOT EXISTS schedule_id uuid;
ALTER TABLE public.medication_administration_log ADD COLUMN IF NOT EXISTS participant_id uuid;
ALTER TABLE public.medication_administration_log ADD COLUMN IF NOT EXISTS administered_at timestamptz DEFAULT timezone('utc'::text, now());
ALTER TABLE public.medication_administration_log ADD COLUMN IF NOT EXISTS administered_by_id uuid;
ALTER TABLE public.medication_administration_log ADD COLUMN IF NOT EXISTS witnessed_by_id uuid;
ALTER TABLE public.medication_administration_log ADD COLUMN IF NOT EXISTS status text DEFAULT 'Administered';
ALTER TABLE public.medication_administration_log ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.medication_administration_log ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT timezone('utc'::text, now());

-- myob_export_batches
ALTER TABLE public.myob_export_batches ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.myob_export_batches ADD COLUMN IF NOT EXISTS exported_at timestamptz DEFAULT now();
ALTER TABLE public.myob_export_batches ADD COLUMN IF NOT EXISTS exported_by uuid;
ALTER TABLE public.myob_export_batches ADD COLUMN IF NOT EXISTS range_start date;
ALTER TABLE public.myob_export_batches ADD COLUMN IF NOT EXISTS range_end date;
ALTER TABLE public.myob_export_batches ADD COLUMN IF NOT EXISTS row_count integer;

-- offline_sync_logs
ALTER TABLE public.offline_sync_logs ADD COLUMN IF NOT EXISTS id uuid DEFAULT uuid_generate_v4();
ALTER TABLE public.offline_sync_logs ADD COLUMN IF NOT EXISTS driver_or_staff_id uuid;
ALTER TABLE public.offline_sync_logs ADD COLUMN IF NOT EXISTS device_uuid text;
ALTER TABLE public.offline_sync_logs ADD COLUMN IF NOT EXISTS action_type text;
ALTER TABLE public.offline_sync_logs ADD COLUMN IF NOT EXISTS payload jsonb;
ALTER TABLE public.offline_sync_logs ADD COLUMN IF NOT EXISTS synced_at timestamptz;
ALTER TABLE public.offline_sync_logs ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- operational_emergencies
ALTER TABLE public.operational_emergencies ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.operational_emergencies ADD COLUMN IF NOT EXISTS mode text;
ALTER TABLE public.operational_emergencies ADD COLUMN IF NOT EXISTS severity text;
ALTER TABLE public.operational_emergencies ADD COLUMN IF NOT EXISTS situation_text text;
ALTER TABLE public.operational_emergencies ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
ALTER TABLE public.operational_emergencies ADD COLUMN IF NOT EXISTS site_day_session_id uuid;
ALTER TABLE public.operational_emergencies ADD COLUMN IF NOT EXISTS event_id uuid;
ALTER TABLE public.operational_emergencies ADD COLUMN IF NOT EXISTS event_day_session_id uuid;
ALTER TABLE public.operational_emergencies ADD COLUMN IF NOT EXISTS surface text DEFAULT 'centre';
ALTER TABLE public.operational_emergencies ADD COLUMN IF NOT EXISTS activated_by_staff_id uuid;
ALTER TABLE public.operational_emergencies ADD COLUMN IF NOT EXISTS activated_at timestamptz DEFAULT now();
ALTER TABLE public.operational_emergencies ADD COLUMN IF NOT EXISTS stood_down_by_staff_id uuid;
ALTER TABLE public.operational_emergencies ADD COLUMN IF NOT EXISTS stood_down_at timestamptz;
ALTER TABLE public.operational_emergencies ADD COLUMN IF NOT EXISTS debrief_text text;
ALTER TABLE public.operational_emergencies ADD COLUMN IF NOT EXISTS hub_issue_id uuid;
ALTER TABLE public.operational_emergencies ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.operational_emergencies ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- operational_emergency_muster
ALTER TABLE public.operational_emergency_muster ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.operational_emergency_muster ADD COLUMN IF NOT EXISTS emergency_id uuid;
ALTER TABLE public.operational_emergency_muster ADD COLUMN IF NOT EXISTS participant_id uuid;
ALTER TABLE public.operational_emergency_muster ADD COLUMN IF NOT EXISTS participant_name text;
ALTER TABLE public.operational_emergency_muster ADD COLUMN IF NOT EXISTS state text DEFAULT 'expected';
ALTER TABLE public.operational_emergency_muster ADD COLUMN IF NOT EXISTS updated_by_staff_id uuid;
ALTER TABLE public.operational_emergency_muster ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.operational_emergency_muster ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- operational_escalations
ALTER TABLE public.operational_escalations ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.operational_escalations ADD COLUMN IF NOT EXISTS clearance_id uuid;
ALTER TABLE public.operational_escalations ADD COLUMN IF NOT EXISTS driver_name text;
ALTER TABLE public.operational_escalations ADD COLUMN IF NOT EXISTS vehicle_info text;
ALTER TABLE public.operational_escalations ADD COLUMN IF NOT EXISTS gate_id text;
ALTER TABLE public.operational_escalations ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';
ALTER TABLE public.operational_escalations ADD COLUMN IF NOT EXISTS claimed_by uuid;
ALTER TABLE public.operational_escalations ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.operational_escalations ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.operational_escalations ADD COLUMN IF NOT EXISTS resolution_notes text;
ALTER TABLE public.operational_escalations ADD COLUMN IF NOT EXISTS resolved_by uuid;
ALTER TABLE public.operational_escalations ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE public.operational_escalations ADD COLUMN IF NOT EXISTS source_kind text;
ALTER TABLE public.operational_escalations ADD COLUMN IF NOT EXISTS source_issue_id uuid;
ALTER TABLE public.operational_escalations ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE public.operational_escalations ADD COLUMN IF NOT EXISTS raised_by uuid;
ALTER TABLE public.operational_escalations ADD COLUMN IF NOT EXISTS operator_acknowledged_at timestamptz;
ALTER TABLE public.operational_escalations ADD COLUMN IF NOT EXISTS operator_acknowledged_by uuid;

-- operational_incidents
ALTER TABLE public.operational_incidents ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.operational_incidents ADD COLUMN IF NOT EXISTS incident_type text;
ALTER TABLE public.operational_incidents ADD COLUMN IF NOT EXISTS severity text;
ALTER TABLE public.operational_incidents ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.operational_incidents ADD COLUMN IF NOT EXISTS vehicle_id uuid;
ALTER TABLE public.operational_incidents ADD COLUMN IF NOT EXISTS event_id uuid;
ALTER TABLE public.operational_incidents ADD COLUMN IF NOT EXISTS reported_by text;
ALTER TABLE public.operational_incidents ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';
ALTER TABLE public.operational_incidents ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.operational_incidents ADD COLUMN IF NOT EXISTS occurred_at timestamptz;
ALTER TABLE public.operational_incidents ADD COLUMN IF NOT EXISTS affected_participant_ids uuid[] DEFAULT '{}'::uuid[];
ALTER TABLE public.operational_incidents ADD COLUMN IF NOT EXISTS assisting_staff_id uuid;
ALTER TABLE public.operational_incidents ADD COLUMN IF NOT EXISTS no_participant_involved boolean DEFAULT false;
ALTER TABLE public.operational_incidents ADD COLUMN IF NOT EXISTS assisting_staff_ids uuid[] DEFAULT '{}'::uuid[];

-- operational_ledger
ALTER TABLE public.operational_ledger ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.operational_ledger ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.operational_ledger ADD COLUMN IF NOT EXISTS staff_id uuid;
ALTER TABLE public.operational_ledger ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.operational_ledger ADD COLUMN IF NOT EXISTS severity text;
ALTER TABLE public.operational_ledger ADD COLUMN IF NOT EXISTS action_type text;
ALTER TABLE public.operational_ledger ADD COLUMN IF NOT EXISTS gps_lat numeric;
ALTER TABLE public.operational_ledger ADD COLUMN IF NOT EXISTS gps_lng numeric;
ALTER TABLE public.operational_ledger ADD COLUMN IF NOT EXISTS metadata jsonb;

-- participant_attendance_schedules
ALTER TABLE public.participant_attendance_schedules ADD COLUMN IF NOT EXISTS id uuid DEFAULT uuid_generate_v4();
ALTER TABLE public.participant_attendance_schedules ADD COLUMN IF NOT EXISTS participant_id uuid;
ALTER TABLE public.participant_attendance_schedules ADD COLUMN IF NOT EXISTS day_of_week text;
ALTER TABLE public.participant_attendance_schedules ADD COLUMN IF NOT EXISTS service_type text;
ALTER TABLE public.participant_attendance_schedules ADD COLUMN IF NOT EXISTS transport_required text;
ALTER TABLE public.participant_attendance_schedules ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;
ALTER TABLE public.participant_attendance_schedules ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.participant_attendance_schedules ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.participant_attendance_schedules ADD COLUMN IF NOT EXISTS archived_by_id uuid;
ALTER TABLE public.participant_attendance_schedules ADD COLUMN IF NOT EXISTS archive_witnessed_by_id uuid;
ALTER TABLE public.participant_attendance_schedules ADD COLUMN IF NOT EXISTS archive_reason text;
ALTER TABLE public.participant_attendance_schedules ADD COLUMN IF NOT EXISTS archive_reference_type text;
ALTER TABLE public.participant_attendance_schedules ADD COLUMN IF NOT EXISTS expected_arrival_time time without time zone DEFAULT '09:00:00'::time without time zone;
ALTER TABLE public.participant_attendance_schedules ADD COLUMN IF NOT EXISTS expected_departure_time time without time zone DEFAULT '15:00:00'::time without time zone;
ALTER TABLE public.participant_attendance_schedules ADD COLUMN IF NOT EXISTS inbound_transport text;
ALTER TABLE public.participant_attendance_schedules ADD COLUMN IF NOT EXISTS outbound_transport text;

-- participant_compliance_and_alerts
ALTER TABLE public.participant_compliance_and_alerts ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.participant_compliance_and_alerts ADD COLUMN IF NOT EXISTS participant_id uuid;
ALTER TABLE public.participant_compliance_and_alerts ADD COLUMN IF NOT EXISTS record_type text;
ALTER TABLE public.participant_compliance_and_alerts ADD COLUMN IF NOT EXISTS reference_data text;
ALTER TABLE public.participant_compliance_and_alerts ADD COLUMN IF NOT EXISTS expiry_date date;
ALTER TABLE public.participant_compliance_and_alerts ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.participant_compliance_and_alerts ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT timezone('utc'::text, now());
ALTER TABLE public.participant_compliance_and_alerts ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT timezone('utc'::text, now());

-- participant_financial_ledger
ALTER TABLE public.participant_financial_ledger ADD COLUMN IF NOT EXISTS id uuid DEFAULT uuid_generate_v4();
ALTER TABLE public.participant_financial_ledger ADD COLUMN IF NOT EXISTS participant_id uuid;
ALTER TABLE public.participant_financial_ledger ADD COLUMN IF NOT EXISTS transaction_date date;
ALTER TABLE public.participant_financial_ledger ADD COLUMN IF NOT EXISTS financial_code text;
ALTER TABLE public.participant_financial_ledger ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.participant_financial_ledger ADD COLUMN IF NOT EXISTS amount numeric;
ALTER TABLE public.participant_financial_ledger ADD COLUMN IF NOT EXISTS is_reconciled boolean DEFAULT false;
ALTER TABLE public.participant_financial_ledger ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.participant_financial_ledger ADD COLUMN IF NOT EXISTS event_id uuid;

-- participant_infectious_exclusions
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS participant_id uuid;
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS exclude_centre boolean DEFAULT true;
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS exclude_trips boolean DEFAULT true;
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS excluded_from date DEFAULT (timezone('Australia/Sydney'::text, now()))::date;
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS hub_issue_id uuid;
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS site_day_session_id uuid;
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS declared_by_staff_id uuid;
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS declared_at timestamptz DEFAULT now();
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS clearance_method text;
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS clearance_note text;
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS evidence_ref text;
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS cleared_by_staff_id uuid;
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS cleared_at timestamptz;
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS event_id uuid;
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS event_day_session_id uuid;
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS home_safe_disposition text;
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS home_safe_handover_to text;
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS home_safe_note text;
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS home_safe_at timestamptz;
ALTER TABLE public.participant_infectious_exclusions ADD COLUMN IF NOT EXISTS home_safe_by_staff_id uuid;

-- participant_medication_schedules
ALTER TABLE public.participant_medication_schedules ADD COLUMN IF NOT EXISTS id uuid DEFAULT uuid_generate_v4();
ALTER TABLE public.participant_medication_schedules ADD COLUMN IF NOT EXISTS participant_id uuid;
ALTER TABLE public.participant_medication_schedules ADD COLUMN IF NOT EXISTS medication_name text;
ALTER TABLE public.participant_medication_schedules ADD COLUMN IF NOT EXISTS dosage text;
ALTER TABLE public.participant_medication_schedules ADD COLUMN IF NOT EXISTS expected_time time without time zone;
ALTER TABLE public.participant_medication_schedules ADD COLUMN IF NOT EXISTS frequency text DEFAULT 'Daily';
ALTER TABLE public.participant_medication_schedules ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;
ALTER TABLE public.participant_medication_schedules ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- participants
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS id uuid DEFAULT uuid_generate_v4();
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS ndis_number text;
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS iddsi_level_liquids integer;
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS iddsi_level_solids integer;
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS dual_witness_pin_hash text;
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS street_address text;
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS emergency_contact_name text;
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS emergency_contact_phone text;
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS emergency_contact_relationship text;
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS regular_pickup_address text;
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS participant_kind text DEFAULT 'client';
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS allergies_notes text;

-- site_day_activities
ALTER TABLE public.site_day_activities ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.site_day_activities ADD COLUMN IF NOT EXISTS session_id uuid;
ALTER TABLE public.site_day_activities ADD COLUMN IF NOT EXISTS activity_kind text DEFAULT 'meal';
ALTER TABLE public.site_day_activities ADD COLUMN IF NOT EXISTS meal_slot text;
ALTER TABLE public.site_day_activities ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.site_day_activities ADD COLUMN IF NOT EXISTS meal_source text;
ALTER TABLE public.site_day_activities ADD COLUMN IF NOT EXISTS menu_notes text;
ALTER TABLE public.site_day_activities ADD COLUMN IF NOT EXISTS phase text DEFAULT 'pending';
ALTER TABLE public.site_day_activities ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;
ALTER TABLE public.site_day_activities ADD COLUMN IF NOT EXISTS opened_at timestamptz;
ALTER TABLE public.site_day_activities ADD COLUMN IF NOT EXISTS opened_by_id uuid;
ALTER TABLE public.site_day_activities ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE public.site_day_activities ADD COLUMN IF NOT EXISTS closed_by_id uuid;
ALTER TABLE public.site_day_activities ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.site_day_activities ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.site_day_activities ADD COLUMN IF NOT EXISTS prepared_by_staff_id uuid;
ALTER TABLE public.site_day_activities ADD COLUMN IF NOT EXISTS preparer_cert_status text;
ALTER TABLE public.site_day_activities ADD COLUMN IF NOT EXISTS preparer_ack_note text;
ALTER TABLE public.site_day_activities ADD COLUMN IF NOT EXISTS prep_checks_completed jsonb;
ALTER TABLE public.site_day_activities ADD COLUMN IF NOT EXISTS prep_attestation_mode text;
ALTER TABLE public.site_day_activities ADD COLUMN IF NOT EXISTS prep_attested_by_staff_id uuid;
ALTER TABLE public.site_day_activities ADD COLUMN IF NOT EXISTS guest_preparer_name text;
ALTER TABLE public.site_day_activities ADD COLUMN IF NOT EXISTS prep_attestation_note text;
ALTER TABLE public.site_day_activities ADD COLUMN IF NOT EXISTS sfh_approved_by_staff_id uuid;

-- site_day_meal_service_rolls
ALTER TABLE public.site_day_meal_service_rolls ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.site_day_meal_service_rolls ADD COLUMN IF NOT EXISTS activity_id uuid;
ALTER TABLE public.site_day_meal_service_rolls ADD COLUMN IF NOT EXISTS participant_id uuid;
ALTER TABLE public.site_day_meal_service_rolls ADD COLUMN IF NOT EXISTS status text DEFAULT 'expected';
ALTER TABLE public.site_day_meal_service_rolls ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.site_day_meal_service_rolls ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.site_day_meal_service_rolls ADD COLUMN IF NOT EXISTS updated_by_id uuid;

-- site_day_sessions
ALTER TABLE public.site_day_sessions ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.site_day_sessions ADD COLUMN IF NOT EXISTS session_date date DEFAULT CURRENT_DATE;
ALTER TABLE public.site_day_sessions ADD COLUMN IF NOT EXISTS phase site_session_status DEFAULT 'open_pending'::site_session_status;
ALTER TABLE public.site_day_sessions ADD COLUMN IF NOT EXISTS opened_by_id uuid;
ALTER TABLE public.site_day_sessions ADD COLUMN IF NOT EXISTS open_declared_at timestamptz;
ALTER TABLE public.site_day_sessions ADD COLUMN IF NOT EXISTS open_leader_notes text;
ALTER TABLE public.site_day_sessions ADD COLUMN IF NOT EXISTS closed_by_id uuid;
ALTER TABLE public.site_day_sessions ADD COLUMN IF NOT EXISTS close_declared_at timestamptz;
ALTER TABLE public.site_day_sessions ADD COLUMN IF NOT EXISTS close_leader_notes text;
ALTER TABLE public.site_day_sessions ADD COLUMN IF NOT EXISTS manager_plan_text text;
ALTER TABLE public.site_day_sessions ADD COLUMN IF NOT EXISTS manager_decision text;
ALTER TABLE public.site_day_sessions ADD COLUMN IF NOT EXISTS manager_auth_staff_id uuid;
ALTER TABLE public.site_day_sessions ADD COLUMN IF NOT EXISTS manager_auth_at timestamptz;
ALTER TABLE public.site_day_sessions ADD COLUMN IF NOT EXISTS leader_decision text;
ALTER TABLE public.site_day_sessions ADD COLUMN IF NOT EXISTS leader_auth_staff_id uuid;
ALTER TABLE public.site_day_sessions ADD COLUMN IF NOT EXISTS leader_auth_at timestamptz;
ALTER TABLE public.site_day_sessions ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.site_day_sessions ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.site_day_sessions ADD COLUMN IF NOT EXISTS lockdown_active boolean DEFAULT false;
ALTER TABLE public.site_day_sessions ADD COLUMN IF NOT EXISTS lockdown_reason text;
ALTER TABLE public.site_day_sessions ADD COLUMN IF NOT EXISTS lockdown_severity text;
ALTER TABLE public.site_day_sessions ADD COLUMN IF NOT EXISTS lockdown_hub_issue_id uuid;
ALTER TABLE public.site_day_sessions ADD COLUMN IF NOT EXISTS lockdown_at timestamptz;
ALTER TABLE public.site_day_sessions ADD COLUMN IF NOT EXISTS lockdown_by_staff_id uuid;

-- site_day_visitors
ALTER TABLE public.site_day_visitors ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.site_day_visitors ADD COLUMN IF NOT EXISTS session_id uuid;
ALTER TABLE public.site_day_visitors ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.site_day_visitors ADD COLUMN IF NOT EXISTS kind text;
ALTER TABLE public.site_day_visitors ADD COLUMN IF NOT EXISTS linked_participant_id uuid;
ALTER TABLE public.site_day_visitors ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE public.site_day_visitors ADD COLUMN IF NOT EXISTS arrived_at timestamptz DEFAULT now();
ALTER TABLE public.site_day_visitors ADD COLUMN IF NOT EXISTS arrived_by uuid;
ALTER TABLE public.site_day_visitors ADD COLUMN IF NOT EXISTS left_at timestamptz;
ALTER TABLE public.site_day_visitors ADD COLUMN IF NOT EXISTS left_by uuid;
ALTER TABLE public.site_day_visitors ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.site_day_visitors ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- site_issues_register
ALTER TABLE public.site_issues_register ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.site_issues_register ADD COLUMN IF NOT EXISTS session_id uuid;
ALTER TABLE public.site_issues_register ADD COLUMN IF NOT EXISTS reported_by text;
ALTER TABLE public.site_issues_register ADD COLUMN IF NOT EXISTS severity text;
ALTER TABLE public.site_issues_register ADD COLUMN IF NOT EXISTS issue_description text;
ALTER TABLE public.site_issues_register ADD COLUMN IF NOT EXISTS workaround_plan text;
ALTER TABLE public.site_issues_register ADD COLUMN IF NOT EXISTS owner responsibility_owner DEFAULT 'internal'::responsibility_owner;
ALTER TABLE public.site_issues_register ADD COLUMN IF NOT EXISTS council_sla_category character varying;
ALTER TABLE public.site_issues_register ADD COLUMN IF NOT EXISTS council_sla_deadline timestamptz;
ALTER TABLE public.site_issues_register ADD COLUMN IF NOT EXISTS email_dispatched_to_council boolean DEFAULT false;
ALTER TABLE public.site_issues_register ADD COLUMN IF NOT EXISTS email_dispatched_at timestamptz;
ALTER TABLE public.site_issues_register ADD COLUMN IF NOT EXISTS status character varying DEFAULT 'open'::character varying;
ALTER TABLE public.site_issues_register ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE public.site_issues_register ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.site_issues_register ADD COLUMN IF NOT EXISTS workaround_accepted_at timestamptz;
ALTER TABLE public.site_issues_register ADD COLUMN IF NOT EXISTS update_log text DEFAULT '';
ALTER TABLE public.site_issues_register ADD COLUMN IF NOT EXISTS deferred_until timestamptz;
ALTER TABLE public.site_issues_register ADD COLUMN IF NOT EXISTS council_severity text;
ALTER TABLE public.site_issues_register ADD COLUMN IF NOT EXISTS event_id uuid;
ALTER TABLE public.site_issues_register ADD COLUMN IF NOT EXISTS event_day_session_id uuid;
ALTER TABLE public.site_issues_register ADD COLUMN IF NOT EXISTS issue_area text;
ALTER TABLE public.site_issues_register ADD COLUMN IF NOT EXISTS occurred_at timestamptz;

-- staff_compliance_and_certs
ALTER TABLE public.staff_compliance_and_certs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.staff_compliance_and_certs ADD COLUMN IF NOT EXISTS staff_id uuid;
ALTER TABLE public.staff_compliance_and_certs ADD COLUMN IF NOT EXISTS cert_type text;
ALTER TABLE public.staff_compliance_and_certs ADD COLUMN IF NOT EXISTS reference_number text;
ALTER TABLE public.staff_compliance_and_certs ADD COLUMN IF NOT EXISTS expiry_date date;
ALTER TABLE public.staff_compliance_and_certs ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.staff_compliance_and_certs ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT timezone('utc'::text, now());
ALTER TABLE public.staff_compliance_and_certs ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT timezone('utc'::text, now());

-- staff_registry
ALTER TABLE public.staff_registry ADD COLUMN IF NOT EXISTS id uuid DEFAULT uuid_generate_v4();
ALTER TABLE public.staff_registry ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE public.staff_registry ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE public.staff_registry ADD COLUMN IF NOT EXISTS pin_hash text;
ALTER TABLE public.staff_registry ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;
ALTER TABLE public.staff_registry ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.staff_registry ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.staff_registry ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.staff_registry ADD COLUMN IF NOT EXISTS street_address text;
ALTER TABLE public.staff_registry ADD COLUMN IF NOT EXISTS personnel_type text DEFAULT 'Volunteer';
ALTER TABLE public.staff_registry ADD COLUMN IF NOT EXISTS certifications jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.staff_registry ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.staff_registry ADD COLUMN IF NOT EXISTS auth_user_id uuid;

-- system_lookup_parameters
ALTER TABLE public.system_lookup_parameters ADD COLUMN IF NOT EXISTS id uuid DEFAULT uuid_generate_v4();
ALTER TABLE public.system_lookup_parameters ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.system_lookup_parameters ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE public.system_lookup_parameters ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.system_lookup_parameters ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;
ALTER TABLE public.system_lookup_parameters ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.system_lookup_parameters ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;
ALTER TABLE public.system_lookup_parameters ADD COLUMN IF NOT EXISTS badge_color text;

-- system_operational_settings
ALTER TABLE public.system_operational_settings ADD COLUMN IF NOT EXISTS key text;
ALTER TABLE public.system_operational_settings ADD COLUMN IF NOT EXISTS value_uuid uuid;
ALTER TABLE public.system_operational_settings ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.system_operational_settings ADD COLUMN IF NOT EXISTS updated_by uuid;

-- system_parameters
ALTER TABLE public.system_parameters ADD COLUMN IF NOT EXISTS key text;
ALTER TABLE public.system_parameters ADD COLUMN IF NOT EXISTS value jsonb;
ALTER TABLE public.system_parameters ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.system_parameters ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE public.system_parameters ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- transport_assets
ALTER TABLE public.transport_assets ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.transport_assets ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.transport_assets ADD COLUMN IF NOT EXISTS make_model text;
ALTER TABLE public.transport_assets ADD COLUMN IF NOT EXISTS rego_plate text;
ALTER TABLE public.transport_assets ADD COLUMN IF NOT EXISTS passenger_capacity integer DEFAULT 12;
ALTER TABLE public.transport_assets ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
ALTER TABLE public.transport_assets ADD COLUMN IF NOT EXISTS vehicle_category text DEFAULT 'bus';
ALTER TABLE public.transport_assets ADD COLUMN IF NOT EXISTS vin text;
ALTER TABLE public.transport_assets ADD COLUMN IF NOT EXISTS registration_expiry date;
ALTER TABLE public.transport_assets ADD COLUMN IF NOT EXISTS service_interval_km integer;
ALTER TABLE public.transport_assets ADD COLUMN IF NOT EXISTS last_service_odo integer;
ALTER TABLE public.transport_assets ADD COLUMN IF NOT EXISTS last_service_date date;
ALTER TABLE public.transport_assets ADD COLUMN IF NOT EXISTS deferred_until date;
ALTER TABLE public.transport_assets ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.transport_assets ADD COLUMN IF NOT EXISTS has_wheelchair_hoist boolean DEFAULT false;
ALTER TABLE public.transport_assets ADD COLUMN IF NOT EXISTS current_odometer_km numeric;
ALTER TABLE public.transport_assets ADD COLUMN IF NOT EXISTS current_odometer_updated_at timestamptz;

-- transport_requests
ALTER TABLE public.transport_requests ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.transport_requests ADD COLUMN IF NOT EXISTS participant_id uuid;
ALTER TABLE public.transport_requests ADD COLUMN IF NOT EXISTS request_date date DEFAULT CURRENT_DATE;
ALTER TABLE public.transport_requests ADD COLUMN IF NOT EXISTS scheduled_time time without time zone;
ALTER TABLE public.transport_requests ADD COLUMN IF NOT EXISTS pickup_address text;
ALTER TABLE public.transport_requests ADD COLUMN IF NOT EXISTS destination_label text;
ALTER TABLE public.transport_requests ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE public.transport_requests ADD COLUMN IF NOT EXISTS hoist_required boolean DEFAULT false;
ALTER TABLE public.transport_requests ADD COLUMN IF NOT EXISTS status text DEFAULT 'requested';
ALTER TABLE public.transport_requests ADD COLUMN IF NOT EXISTS assigned_driver_staff_id uuid;
ALTER TABLE public.transport_requests ADD COLUMN IF NOT EXISTS assigned_asset_id uuid;
ALTER TABLE public.transport_requests ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.transport_requests ADD COLUMN IF NOT EXISTS completed_sync_log_id uuid;
ALTER TABLE public.transport_requests ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.transport_requests ADD COLUMN IF NOT EXISTS created_by_staff_id uuid;
ALTER TABLE public.transport_requests ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.transport_requests ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- transport_trips
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS event_id uuid;
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS driver_id uuid;
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS vehicle_id text;
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS start_odometer numeric;
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS end_odometer numeric;
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS status text DEFAULT 'Not Started';
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT timezone('utc'::text, now());
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS driver_staff_id uuid;
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS trip_date date DEFAULT CURRENT_DATE;
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS start_odometer_km numeric;
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS end_odometer_km numeric;
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS started_at timestamptz DEFAULT now();
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS start_odometer_variance_reason text;
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS bus_run_code text;
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS trip_origin text DEFAULT 'depot';
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS trip_return text DEFAULT 'depot';
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS origin_address text;
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS trip_kind text;
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS event_day_session_id uuid;
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS venue_stop_from_id uuid;
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS venue_stop_to_id uuid;
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS hop_index integer;
ALTER TABLE public.transport_trips ADD COLUMN IF NOT EXISTS asset_id uuid;

-- trip_legs
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS trip_id uuid;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS participant_id uuid;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS leg_type text;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS sequence_order integer;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS status text DEFAULT 'Pending';
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS start_lat numeric;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS start_lng numeric;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS end_lat numeric;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS end_lng numeric;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS calculated_gps_km numeric DEFAULT 0.0;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS override_km numeric;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS medication_bag_collected boolean DEFAULT false;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS medication_bag_unexpected boolean DEFAULT false;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS medication_bag_notes text;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS leg_index integer;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS leg_kind text;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS from_label text;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS to_label text;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS from_participant_id uuid;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS to_participant_id uuid;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS start_at timestamptz;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS end_at timestamptz;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS gps_distance_km numeric;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS logged_distance_km numeric;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS passenger_present boolean;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS no_show_triggered_at timestamptz;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS medication_expected boolean DEFAULT false;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS medication_handover_confirmed boolean DEFAULT false;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS unexpected_medication_logged boolean DEFAULT false;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS unexpected_medication_notes text;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS target_address text;
ALTER TABLE public.trip_legs ADD COLUMN IF NOT EXISTS medication_handover_status text DEFAULT 'Not Required';

-- vendors
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- venue_safety_answers
ALTER TABLE public.venue_safety_answers ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.venue_safety_answers ADD COLUMN IF NOT EXISTS signoff_id uuid;
ALTER TABLE public.venue_safety_answers ADD COLUMN IF NOT EXISTS field_id uuid;
ALTER TABLE public.venue_safety_answers ADD COLUMN IF NOT EXISTS answer_text text;
ALTER TABLE public.venue_safety_answers ADD COLUMN IF NOT EXISTS answer_json jsonb;
ALTER TABLE public.venue_safety_answers ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- venue_safety_baseline_signoffs
ALTER TABLE public.venue_safety_baseline_signoffs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.venue_safety_baseline_signoffs ADD COLUMN IF NOT EXISTS venue_id uuid;
ALTER TABLE public.venue_safety_baseline_signoffs ADD COLUMN IF NOT EXISTS signed_off_by_staff_id uuid;
ALTER TABLE public.venue_safety_baseline_signoffs ADD COLUMN IF NOT EXISTS signed_off_at timestamptz DEFAULT now();
ALTER TABLE public.venue_safety_baseline_signoffs ADD COLUMN IF NOT EXISTS evidence_ref text;
ALTER TABLE public.venue_safety_baseline_signoffs ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.venue_safety_baseline_signoffs ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- venue_template_fields
ALTER TABLE public.venue_template_fields ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.venue_template_fields ADD COLUMN IF NOT EXISTS venue_id uuid;
ALTER TABLE public.venue_template_fields ADD COLUMN IF NOT EXISTS prompt text;
ALTER TABLE public.venue_template_fields ADD COLUMN IF NOT EXISTS answer_type text DEFAULT 'yes_no';
ALTER TABLE public.venue_template_fields ADD COLUMN IF NOT EXISTS options_json jsonb;
ALTER TABLE public.venue_template_fields ADD COLUMN IF NOT EXISTS is_mandatory boolean DEFAULT true;
ALTER TABLE public.venue_template_fields ADD COLUMN IF NOT EXISTS is_system_core boolean DEFAULT false;
ALTER TABLE public.venue_template_fields ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;
ALTER TABLE public.venue_template_fields ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.venue_template_fields ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- venues
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS venue_type text DEFAULT 'general';
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS street_address text;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS gps_lat numeric;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS gps_lng numeric;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS access_notes text;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS site_contact_name text;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS site_contact_phone text;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS max_safe_group_size integer;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS risk_tier text DEFAULT 'medium';
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS cloned_from_venue_id uuid;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS created_by_staff_id uuid;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- ---------------------------------------------------------------------------
-- 3) Align DEFAULTs
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  ALTER TABLE public.asset_checkpoints ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_checkpoints', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_checkpoints ALTER COLUMN checkpoint_text DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_checkpoints', 'checkpoint_text', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_checkpoints ALTER COLUMN vehicle_category DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_checkpoints', 'vehicle_category', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_checkpoints ALTER COLUMN asset_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_checkpoints', 'asset_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_checkpoints ALTER COLUMN impact_level SET DEFAULT 'minor_log_only';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_checkpoints', 'impact_level', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_checkpoints ALTER COLUMN is_mandatory SET DEFAULT true;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_checkpoints', 'is_mandatory', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.asset_clearance_items ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_clearance_items', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_clearance_items ALTER COLUMN clearance_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_clearance_items', 'clearance_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_clearance_items ALTER COLUMN checkpoint_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_clearance_items', 'checkpoint_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_clearance_items ALTER COLUMN is_passed DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_clearance_items', 'is_passed', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_clearance_items ALTER COLUMN notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_clearance_items', 'notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_clearance_items ALTER COLUMN severity DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_clearance_items', 'severity', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_clearance_items ALTER COLUMN workaround_text DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_clearance_items', 'workaround_text', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.asset_daily_clearance ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_daily_clearance', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_daily_clearance ALTER COLUMN asset_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_daily_clearance', 'asset_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_daily_clearance ALTER COLUMN clearance_date SET DEFAULT CURRENT_DATE;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_daily_clearance', 'clearance_date', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_daily_clearance ALTER COLUMN driver_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_daily_clearance', 'driver_staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_daily_clearance ALTER COLUMN start_odometer DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_daily_clearance', 'start_odometer', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_daily_clearance ALTER COLUMN status DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_daily_clearance', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_daily_clearance ALTER COLUMN accumulated_issues DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_daily_clearance', 'accumulated_issues', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_daily_clearance ALTER COLUMN driver_comfort_declared SET DEFAULT false;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_daily_clearance', 'driver_comfort_declared', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_daily_clearance ALTER COLUMN requires_manager_review SET DEFAULT false;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_daily_clearance', 'requires_manager_review', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_daily_clearance ALTER COLUMN driver_auth_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_daily_clearance', 'driver_auth_staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_daily_clearance ALTER COLUMN driver_auth_pin_verified_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_daily_clearance', 'driver_auth_pin_verified_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_daily_clearance ALTER COLUMN manager_auth_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_daily_clearance', 'manager_auth_staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_daily_clearance ALTER COLUMN manager_auth_pin_verified_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_daily_clearance', 'manager_auth_pin_verified_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.asset_maintenance_logs ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_maintenance_logs', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_maintenance_logs ALTER COLUMN asset_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_maintenance_logs', 'asset_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_maintenance_logs ALTER COLUMN logged_by_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_maintenance_logs', 'logged_by_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_maintenance_logs ALTER COLUMN log_type DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_maintenance_logs', 'log_type', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_maintenance_logs ALTER COLUMN log_date SET DEFAULT CURRENT_DATE;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_maintenance_logs', 'log_date', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_maintenance_logs ALTER COLUMN description DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_maintenance_logs', 'description', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_maintenance_logs ALTER COLUMN cost SET DEFAULT 0.00;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_maintenance_logs', 'cost', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_maintenance_logs ALTER COLUMN current_odometer_reading DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_maintenance_logs', 'current_odometer_reading', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_maintenance_logs ALTER COLUMN is_resolved SET DEFAULT true;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_maintenance_logs', 'is_resolved', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_maintenance_logs ALTER COLUMN notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_maintenance_logs', 'notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.asset_maintenance_logs ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'asset_maintenance_logs', 'created_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.assets ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'assets', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.assets ALTER COLUMN asset_name DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'assets', 'asset_name', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.assets ALTER COLUMN asset_type DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'assets', 'asset_type', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.assets ALTER COLUMN status SET DEFAULT 'Active';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'assets', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.assets ALTER COLUMN identifier_string DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'assets', 'identifier_string', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.assets ALTER COLUMN insurance_policy_number DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'assets', 'insurance_policy_number', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.assets ALTER COLUMN insurance_expiry DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'assets', 'insurance_expiry', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.assets ALTER COLUMN next_compliance_review_date DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'assets', 'next_compliance_review_date', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.assets ALTER COLUMN custom_specifications SET DEFAULT '{}'::jsonb;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'assets', 'custom_specifications', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.assets ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'assets', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.assets ALTER COLUMN updated_at SET DEFAULT timezone('utc'::text, now());
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'assets', 'updated_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.attendance_roster_logs ALTER COLUMN id SET DEFAULT uuid_generate_v4();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'attendance_roster_logs', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.attendance_roster_logs ALTER COLUMN participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'attendance_roster_logs', 'participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.attendance_roster_logs ALTER COLUMN roster_date DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'attendance_roster_logs', 'roster_date', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.attendance_roster_logs ALTER COLUMN expected_service DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'attendance_roster_logs', 'expected_service', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.attendance_roster_logs ALTER COLUMN actual_status DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'attendance_roster_logs', 'actual_status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.attendance_roster_logs ALTER COLUMN driver_notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'attendance_roster_logs', 'driver_notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.attendance_roster_logs ALTER COLUMN recorded_by_uuid SET DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'attendance_roster_logs', 'recorded_by_uuid', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.attendance_roster_logs ALTER COLUMN device_uuid SET DEFAULT 'browser-client';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'attendance_roster_logs', 'device_uuid', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.attendance_roster_logs ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'attendance_roster_logs', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.attendance_roster_logs ALTER COLUMN billing_state SET DEFAULT 'pending';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'attendance_roster_logs', 'billing_state', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.attendance_roster_logs ALTER COLUMN ndis_cancellation_reason DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'attendance_roster_logs', 'ndis_cancellation_reason', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.attendance_roster_logs ALTER COLUMN exported_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'attendance_roster_logs', 'exported_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.attendance_roster_logs ALTER COLUMN exported_batch_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'attendance_roster_logs', 'exported_batch_id', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.carers_registry ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'carers_registry', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.carers_registry ALTER COLUMN participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'carers_registry', 'participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.carers_registry ALTER COLUMN full_name DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'carers_registry', 'full_name', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.carers_registry ALTER COLUMN relationship DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'carers_registry', 'relationship', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.carers_registry ALTER COLUMN phone DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'carers_registry', 'phone', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.carers_registry ALTER COLUMN email DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'carers_registry', 'email', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.carers_registry ALTER COLUMN street_address DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'carers_registry', 'street_address', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.carers_registry ALTER COLUMN is_primary_contact SET DEFAULT false;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'carers_registry', 'is_primary_contact', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.carers_registry ALTER COLUMN notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'carers_registry', 'notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.carers_registry ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'carers_registry', 'created_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.centre_operating_hours ALTER COLUMN day_of_week DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'centre_operating_hours', 'day_of_week', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.centre_operating_hours ALTER COLUMN open_time SET DEFAULT '09:00:00'::time without time zone;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'centre_operating_hours', 'open_time', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.centre_operating_hours ALTER COLUMN close_time SET DEFAULT '15:00:00'::time without time zone;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'centre_operating_hours', 'close_time', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.centre_operating_hours ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'centre_operating_hours', 'updated_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.centre_operating_hours ALTER COLUMN updated_by_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'centre_operating_hours', 'updated_by_staff_id', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.charge_codes ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'charge_codes', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.charge_codes ALTER COLUMN code DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'charge_codes', 'code', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.charge_codes ALTER COLUMN name DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'charge_codes', 'name', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.charge_codes ALTER COLUMN standard_rate DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'charge_codes', 'standard_rate', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.charge_codes ALTER COLUMN unit_type SET DEFAULT 'Hourly';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'charge_codes', 'unit_type', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.charge_codes ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'charge_codes', 'created_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.checklist_items ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'checklist_items', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.checklist_items ALTER COLUMN label DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'checklist_items', 'label', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.checklist_items ALTER COLUMN category DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'checklist_items', 'category', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.checklist_items ALTER COLUMN sort_order SET DEFAULT 100;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'checklist_items', 'sort_order', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.checklist_items ALTER COLUMN is_active SET DEFAULT true;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'checklist_items', 'is_active', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.checklist_items ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'checklist_items', 'created_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.checklist_responses ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'checklist_responses', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.checklist_responses ALTER COLUMN ledger_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'checklist_responses', 'ledger_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.checklist_responses ALTER COLUMN item_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'checklist_responses', 'item_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.checklist_responses ALTER COLUMN status DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'checklist_responses', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.checklist_responses ALTER COLUMN notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'checklist_responses', 'notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.checklist_responses ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'checklist_responses', 'created_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.client_attendance_log ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'client_attendance_log', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.client_attendance_log ALTER COLUMN session_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'client_attendance_log', 'session_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.client_attendance_log ALTER COLUMN participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'client_attendance_log', 'participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.client_attendance_log ALTER COLUMN expected_arrival_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'client_attendance_log', 'expected_arrival_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.client_attendance_log ALTER COLUMN arrival_method SET DEFAULT 'bus';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'client_attendance_log', 'arrival_method', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.client_attendance_log ALTER COLUMN checked_in_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'client_attendance_log', 'checked_in_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.client_attendance_log ALTER COLUMN checked_in_by DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'client_attendance_log', 'checked_in_by', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.client_attendance_log ALTER COLUMN checked_out_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'client_attendance_log', 'checked_out_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.client_attendance_log ALTER COLUMN checked_out_by DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'client_attendance_log', 'checked_out_by', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.client_attendance_log ALTER COLUMN status SET DEFAULT 'expected';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'client_attendance_log', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.client_attendance_log ALTER COLUMN escalation_issue_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'client_attendance_log', 'escalation_issue_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.client_attendance_log ALTER COLUMN escalation_severity DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'client_attendance_log', 'escalation_severity', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.client_attendance_log ALTER COLUMN escalation_raised_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'client_attendance_log', 'escalation_raised_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.client_attendance_log ALTER COLUMN red_sms_dispatched_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'client_attendance_log', 'red_sms_dispatched_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.client_attendance_log ALTER COLUMN notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'client_attendance_log', 'notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.client_attendance_log ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'client_attendance_log', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.client_attendance_log ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'client_attendance_log', 'updated_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.client_attendance_log ALTER COLUMN expected_departure_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'client_attendance_log', 'expected_departure_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.client_attendance_log ALTER COLUMN departure_issue_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'client_attendance_log', 'departure_issue_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.client_attendance_log ALTER COLUMN departure_severity DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'client_attendance_log', 'departure_severity', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.client_attendance_log ALTER COLUMN departure_raised_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'client_attendance_log', 'departure_raised_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.client_attendance_log ALTER COLUMN departure_red_sms_dispatched_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'client_attendance_log', 'departure_red_sms_dispatched_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.client_attendance_log ALTER COLUMN arrival_bus_run_code DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'client_attendance_log', 'arrival_bus_run_code', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.compliance_assets ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'compliance_assets', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.compliance_assets ALTER COLUMN category DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'compliance_assets', 'category', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.compliance_assets ALTER COLUMN type DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'compliance_assets', 'type', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.compliance_assets ALTER COLUMN name DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'compliance_assets', 'name', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.compliance_assets ALTER COLUMN description DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'compliance_assets', 'description', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.compliance_assets ALTER COLUMN subject_table DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'compliance_assets', 'subject_table', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.compliance_assets ALTER COLUMN subject_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'compliance_assets', 'subject_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.compliance_assets ALTER COLUMN expiry_date DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'compliance_assets', 'expiry_date', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.compliance_assets ALTER COLUMN next_action_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'compliance_assets', 'next_action_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.compliance_assets ALTER COLUMN action_module SET DEFAULT 'generic_resolve';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'compliance_assets', 'action_module', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.compliance_assets ALTER COLUMN config SET DEFAULT '{}'::jsonb;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'compliance_assets', 'config', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.compliance_assets ALTER COLUMN status SET DEFAULT 'active';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'compliance_assets', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.compliance_assets ALTER COLUMN created_by DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'compliance_assets', 'created_by', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.compliance_assets ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'compliance_assets', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.compliance_assets ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'compliance_assets', 'updated_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.compliance_audit_logs ALTER COLUMN id SET DEFAULT uuid_generate_v4();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'compliance_audit_logs', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.compliance_audit_logs ALTER COLUMN participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'compliance_audit_logs', 'participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.compliance_audit_logs ALTER COLUMN action_performed DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'compliance_audit_logs', 'action_performed', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.compliance_audit_logs ALTER COLUMN witness_1_identity DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'compliance_audit_logs', 'witness_1_identity', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.compliance_audit_logs ALTER COLUMN witness_2_identity DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'compliance_audit_logs', 'witness_2_identity', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.compliance_audit_logs ALTER COLUMN timestamp SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'compliance_audit_logs', 'timestamp', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.compliance_audit_logs ALTER COLUMN metadata DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'compliance_audit_logs', 'metadata', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.event_activity_rolls ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_activity_rolls', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_activity_rolls ALTER COLUMN venue_stop_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_activity_rolls', 'venue_stop_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_activity_rolls ALTER COLUMN event_day_session_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_activity_rolls', 'event_day_session_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_activity_rolls ALTER COLUMN participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_activity_rolls', 'participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_activity_rolls ALTER COLUMN status SET DEFAULT 'expected';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_activity_rolls', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_activity_rolls ALTER COLUMN checked_in_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_activity_rolls', 'checked_in_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_activity_rolls ALTER COLUMN checked_in_by_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_activity_rolls', 'checked_in_by_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_activity_rolls ALTER COLUMN marked_absent_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_activity_rolls', 'marked_absent_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_activity_rolls ALTER COLUMN marked_absent_by_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_activity_rolls', 'marked_absent_by_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_activity_rolls ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_activity_rolls', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_activity_rolls ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_activity_rolls', 'updated_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.event_attendance_log ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_attendance_log', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_attendance_log ALTER COLUMN event_day_session_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_attendance_log', 'event_day_session_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_attendance_log ALTER COLUMN participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_attendance_log', 'participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_attendance_log ALTER COLUMN expected_arrival_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_attendance_log', 'expected_arrival_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_attendance_log ALTER COLUMN arrival_method SET DEFAULT 'bus';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_attendance_log', 'arrival_method', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_attendance_log ALTER COLUMN checked_in_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_attendance_log', 'checked_in_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_attendance_log ALTER COLUMN checked_in_by DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_attendance_log', 'checked_in_by', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_attendance_log ALTER COLUMN checked_out_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_attendance_log', 'checked_out_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_attendance_log ALTER COLUMN checked_out_by DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_attendance_log', 'checked_out_by', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_attendance_log ALTER COLUMN status SET DEFAULT 'expected';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_attendance_log', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_attendance_log ALTER COLUMN return_transport DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_attendance_log', 'return_transport', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_attendance_log ALTER COLUMN escalation_issue_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_attendance_log', 'escalation_issue_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_attendance_log ALTER COLUMN escalation_severity DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_attendance_log', 'escalation_severity', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_attendance_log ALTER COLUMN escalation_raised_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_attendance_log', 'escalation_raised_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_attendance_log ALTER COLUMN notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_attendance_log', 'notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_attendance_log ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_attendance_log', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_attendance_log ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_attendance_log', 'updated_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_attendance_log ALTER COLUMN arrival_bus_run_code DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_attendance_log', 'arrival_bus_run_code', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_attendance_log ALTER COLUMN return_bus_run_code DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_attendance_log', 'return_bus_run_code', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.event_bus_manifest ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_bus_manifest', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_bus_manifest ALTER COLUMN event_day_session_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_bus_manifest', 'event_day_session_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_bus_manifest ALTER COLUMN transport_trip_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_bus_manifest', 'transport_trip_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_bus_manifest ALTER COLUMN participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_bus_manifest', 'participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_bus_manifest ALTER COLUMN carer_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_bus_manifest', 'carer_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_bus_manifest ALTER COLUMN expected_on_bus SET DEFAULT true;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_bus_manifest', 'expected_on_bus', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_bus_manifest ALTER COLUMN status SET DEFAULT 'expected';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_bus_manifest', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_bus_manifest ALTER COLUMN checked_on_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_bus_manifest', 'checked_on_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_bus_manifest ALTER COLUMN checked_on_by DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_bus_manifest', 'checked_on_by', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_bus_manifest ALTER COLUMN notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_bus_manifest', 'notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_bus_manifest ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_bus_manifest', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_bus_manifest ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_bus_manifest', 'updated_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.event_curfew_log ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_curfew_log', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_curfew_log ALTER COLUMN event_day_session_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_curfew_log', 'event_day_session_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_curfew_log ALTER COLUMN participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_curfew_log', 'participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_curfew_log ALTER COLUMN expected_accounted_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_curfew_log', 'expected_accounted_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_curfew_log ALTER COLUMN accounted_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_curfew_log', 'accounted_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_curfew_log ALTER COLUMN accounted_by DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_curfew_log', 'accounted_by', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_curfew_log ALTER COLUMN status SET DEFAULT 'expected';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_curfew_log', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_curfew_log ALTER COLUMN escalation_issue_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_curfew_log', 'escalation_issue_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_curfew_log ALTER COLUMN escalation_severity DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_curfew_log', 'escalation_severity', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_curfew_log ALTER COLUMN escalation_raised_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_curfew_log', 'escalation_raised_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_curfew_log ALTER COLUMN red_sms_dispatched_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_curfew_log', 'red_sms_dispatched_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_curfew_log ALTER COLUMN notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_curfew_log', 'notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_curfew_log ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_curfew_log', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_curfew_log ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_curfew_log', 'updated_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.event_day_med_alternate_plans ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_med_alternate_plans', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_med_alternate_plans ALTER COLUMN event_day_session_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_med_alternate_plans', 'event_day_session_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_med_alternate_plans ALTER COLUMN participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_med_alternate_plans', 'participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_med_alternate_plans ALTER COLUMN plan_note DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_med_alternate_plans', 'plan_note', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_med_alternate_plans ALTER COLUMN attested_by_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_med_alternate_plans', 'attested_by_staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_med_alternate_plans ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_med_alternate_plans', 'created_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.event_day_sessions ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_sessions', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_sessions ALTER COLUMN event_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_sessions', 'event_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_sessions ALTER COLUMN session_date DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_sessions', 'session_date', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_sessions ALTER COLUMN phase SET DEFAULT 'planning';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_sessions', 'phase', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_sessions ALTER COLUMN manager_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_sessions', 'manager_staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_sessions ALTER COLUMN curfew_time DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_sessions', 'curfew_time', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_sessions ALTER COLUMN morning_roll_time DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_sessions', 'morning_roll_time', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_sessions ALTER COLUMN opened_by_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_sessions', 'opened_by_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_sessions ALTER COLUMN open_declared_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_sessions', 'open_declared_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_sessions ALTER COLUMN open_leader_notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_sessions', 'open_leader_notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_sessions ALTER COLUMN closed_by_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_sessions', 'closed_by_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_sessions ALTER COLUMN close_declared_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_sessions', 'close_declared_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_sessions ALTER COLUMN close_leader_notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_sessions', 'close_leader_notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_sessions ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_sessions', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_sessions ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_sessions', 'updated_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_sessions ALTER COLUMN expected_arrival_by DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_sessions', 'expected_arrival_by', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_sessions ALTER COLUMN programme_suspended SET DEFAULT false;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_sessions', 'programme_suspended', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_sessions ALTER COLUMN programme_suspend_reason DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_sessions', 'programme_suspend_reason', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_sessions ALTER COLUMN programme_suspend_severity DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_sessions', 'programme_suspend_severity', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_sessions ALTER COLUMN programme_suspend_hub_issue_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_sessions', 'programme_suspend_hub_issue_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_sessions ALTER COLUMN programme_suspended_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_sessions', 'programme_suspended_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_day_sessions ALTER COLUMN programme_suspended_by_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_day_sessions', 'programme_suspended_by_staff_id', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.event_financial_ledger ALTER COLUMN id SET DEFAULT uuid_generate_v4();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_financial_ledger', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_financial_ledger ALTER COLUMN event_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_financial_ledger', 'event_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_financial_ledger ALTER COLUMN transaction_date DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_financial_ledger', 'transaction_date', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_financial_ledger ALTER COLUMN financial_code DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_financial_ledger', 'financial_code', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_financial_ledger ALTER COLUMN description DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_financial_ledger', 'description', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_financial_ledger ALTER COLUMN amount DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_financial_ledger', 'amount', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_financial_ledger ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_financial_ledger', 'created_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.event_manifest ALTER COLUMN id SET DEFAULT uuid_generate_v4();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_manifest', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_manifest ALTER COLUMN title DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_manifest', 'title', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_manifest ALTER COLUMN event_type DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_manifest', 'event_type', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_manifest ALTER COLUMN venue_name DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_manifest', 'venue_name', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_manifest ALTER COLUMN start_date DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_manifest', 'start_date', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_manifest ALTER COLUMN end_date DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_manifest', 'end_date', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_manifest ALTER COLUMN ticket_price SET DEFAULT 0.00;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_manifest', 'ticket_price', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_manifest ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_manifest', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_manifest ALTER COLUMN description DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_manifest', 'description', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_manifest ALTER COLUMN status SET DEFAULT 'Open';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_manifest', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_manifest ALTER COLUMN closed_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_manifest', 'closed_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_manifest ALTER COLUMN closed_by_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_manifest', 'closed_by_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_manifest ALTER COLUMN billing_locked SET DEFAULT false;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_manifest', 'billing_locked', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_manifest ALTER COLUMN reconciliation_notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_manifest', 'reconciliation_notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_manifest ALTER COLUMN default_charge_code_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_manifest', 'default_charge_code_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_manifest ALTER COLUMN standard_price SET DEFAULT 0.00;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_manifest', 'standard_price', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_manifest ALTER COLUMN event_kind SET DEFAULT 'legacy';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_manifest', 'event_kind', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_manifest ALTER COLUMN primary_venue_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_manifest', 'primary_venue_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_manifest ALTER COLUMN base_hotel_venue_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_manifest', 'base_hotel_venue_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_manifest ALTER COLUMN curfew_time DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_manifest', 'curfew_time', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_manifest ALTER COLUMN morning_roll_time DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_manifest', 'morning_roll_time', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.event_meal_service_rolls ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_meal_service_rolls', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_meal_service_rolls ALTER COLUMN venue_stop_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_meal_service_rolls', 'venue_stop_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_meal_service_rolls ALTER COLUMN participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_meal_service_rolls', 'participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_meal_service_rolls ALTER COLUMN status SET DEFAULT 'expected';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_meal_service_rolls', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_meal_service_rolls ALTER COLUMN notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_meal_service_rolls', 'notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_meal_service_rolls ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_meal_service_rolls', 'updated_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_meal_service_rolls ALTER COLUMN updated_by_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_meal_service_rolls', 'updated_by_id', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.event_morning_log ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_morning_log', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_morning_log ALTER COLUMN event_day_session_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_morning_log', 'event_day_session_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_morning_log ALTER COLUMN participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_morning_log', 'participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_morning_log ALTER COLUMN expected_accounted_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_morning_log', 'expected_accounted_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_morning_log ALTER COLUMN accounted_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_morning_log', 'accounted_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_morning_log ALTER COLUMN accounted_by DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_morning_log', 'accounted_by', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_morning_log ALTER COLUMN status SET DEFAULT 'expected';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_morning_log', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_morning_log ALTER COLUMN escalation_issue_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_morning_log', 'escalation_issue_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_morning_log ALTER COLUMN escalation_severity DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_morning_log', 'escalation_severity', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_morning_log ALTER COLUMN escalation_raised_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_morning_log', 'escalation_raised_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_morning_log ALTER COLUMN red_sms_dispatched_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_morning_log', 'red_sms_dispatched_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_morning_log ALTER COLUMN notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_morning_log', 'notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_morning_log ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_morning_log', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_morning_log ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_morning_log', 'updated_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN id SET DEFAULT uuid_generate_v4();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN event_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'event_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN booking_status DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'booking_status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN amount_paid SET DEFAULT 0.00;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'amount_paid', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN is_fully_paid SET DEFAULT false;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'is_fully_paid', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN custom_price DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'custom_price', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN brings_carer SET DEFAULT false;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'brings_carer', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN carer_transport_required SET DEFAULT false;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'carer_transport_required', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN companion_carer_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'companion_carer_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN carer_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'carer_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN participant_transport_required SET DEFAULT false;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'participant_transport_required', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN finance_verified_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'finance_verified_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN funding_claim_type SET DEFAULT 'NDIS Plan Managed';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'funding_claim_type', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN charge_code_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'charge_code_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN quantity_delivered SET DEFAULT 1.00;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'quantity_delivered', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN rate_per_unit_applied DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'rate_per_unit_applied', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN total_amount_billed DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'total_amount_billed', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN billing_status SET DEFAULT 'Unbilled';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'billing_status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN trip_pickup_address_override DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'trip_pickup_address_override', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN dynamic_medical_notes_snapshot DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'dynamic_medical_notes_snapshot', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN outbound_transport_mode SET DEFAULT 'bus';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'outbound_transport_mode', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN return_transport_mode SET DEFAULT 'bus';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'return_transport_mode', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN transport_med_bag_required SET DEFAULT 'not_set';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'transport_med_bag_required', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN transport_med_notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'transport_med_notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN pickup_order SET DEFAULT 0;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'pickup_order', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN outbound_bus_run_code DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'outbound_bus_run_code', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN return_bus_run_code DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'return_bus_run_code', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN is_guest_booking SET DEFAULT false;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'is_guest_booking', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN host_participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'host_participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_roster_bookings ALTER COLUMN guest_ops_note DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_roster_bookings', 'guest_ops_note', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.event_venue_reconfirmations ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_reconfirmations', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_reconfirmations ALTER COLUMN event_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_reconfirmations', 'event_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_reconfirmations ALTER COLUMN venue_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_reconfirmations', 'venue_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_reconfirmations ALTER COLUMN reconfirmed_by_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_reconfirmations', 'reconfirmed_by_staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_reconfirmations ALTER COLUMN reconfirmed_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_reconfirmations', 'reconfirmed_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_reconfirmations ALTER COLUMN still_valid SET DEFAULT true;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_reconfirmations', 'still_valid', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_reconfirmations ALTER COLUMN notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_reconfirmations', 'notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_reconfirmations ALTER COLUMN evidence_ref DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_reconfirmations', 'evidence_ref', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_reconfirmations ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_reconfirmations', 'created_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN event_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'event_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN session_date DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'session_date', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN venue_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'venue_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN stop_order DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'stop_order', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN label_override DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'label_override', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'updated_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN phase SET DEFAULT 'pending';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'phase', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN movement_method SET DEFAULT 'bus';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'movement_method', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN opened_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'opened_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN closed_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'closed_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN opened_by_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'opened_by_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN activity_kind SET DEFAULT 'venue';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'activity_kind', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN meal_slot DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'meal_slot', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN meal_source DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'meal_source', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN menu_notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'menu_notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN prepared_by_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'prepared_by_staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN preparer_cert_status DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'preparer_cert_status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN preparer_ack_note DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'preparer_ack_note', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN prep_checks_completed DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'prep_checks_completed', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN prep_attestation_mode DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'prep_attestation_mode', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN prep_attested_by_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'prep_attested_by_staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN guest_preparer_name DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'guest_preparer_name', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN prep_attestation_note DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'prep_attestation_note', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.event_venue_stops ALTER COLUMN sfh_approved_by_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'event_venue_stops', 'sfh_approved_by_staff_id', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.hub_issue_notes ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'hub_issue_notes', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.hub_issue_notes ALTER COLUMN source DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'hub_issue_notes', 'source', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.hub_issue_notes ALTER COLUMN source_row_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'hub_issue_notes', 'source_row_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.hub_issue_notes ALTER COLUMN note DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'hub_issue_notes', 'note', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.hub_issue_notes ALTER COLUMN kind SET DEFAULT 'append';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'hub_issue_notes', 'kind', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.hub_issue_notes ALTER COLUMN stamped_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'hub_issue_notes', 'stamped_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.hub_issue_notes ALTER COLUMN staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'hub_issue_notes', 'staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.hub_issue_notes ALTER COLUMN metadata DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'hub_issue_notes', 'metadata', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.maintenance_items ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_items', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.maintenance_items ALTER COLUMN title DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_items', 'title', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.maintenance_items ALTER COLUMN description DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_items', 'description', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.maintenance_items ALTER COLUMN severity SET DEFAULT 'yellow';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_items', 'severity', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.maintenance_items ALTER COLUMN status SET DEFAULT 'open';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_items', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.maintenance_items ALTER COLUMN source SET DEFAULT 'manual';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_items', 'source', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.maintenance_items ALTER COLUMN source_ref_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_items', 'source_ref_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.maintenance_items ALTER COLUMN venue_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_items', 'venue_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.maintenance_items ALTER COLUMN event_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_items', 'event_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.maintenance_items ALTER COLUMN location_label DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_items', 'location_label', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.maintenance_items ALTER COLUMN reported_by DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_items', 'reported_by', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.maintenance_items ALTER COLUMN assigned_to DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_items', 'assigned_to', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.maintenance_items ALTER COLUMN resolution_notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_items', 'resolution_notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.maintenance_items ALTER COLUMN resolved_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_items', 'resolved_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.maintenance_items ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_items', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.maintenance_items ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_items', 'updated_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.maintenance_items ALTER COLUMN deferred_until DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_items', 'deferred_until', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.maintenance_items ALTER COLUMN deferred_reason DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_items', 'deferred_reason', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.maintenance_items ALTER COLUMN defer_count SET DEFAULT 0;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_items', 'defer_count', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.maintenance_items ALTER COLUMN last_note_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_items', 'last_note_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.maintenance_items ALTER COLUMN occurred_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_items', 'occurred_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.maintenance_notes ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_notes', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.maintenance_notes ALTER COLUMN item_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_notes', 'item_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.maintenance_notes ALTER COLUMN note_text DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_notes', 'note_text', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.maintenance_notes ALTER COLUMN author DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_notes', 'author', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.maintenance_notes ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'maintenance_notes', 'created_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.medication_administration_log ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'medication_administration_log', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.medication_administration_log ALTER COLUMN schedule_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'medication_administration_log', 'schedule_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.medication_administration_log ALTER COLUMN participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'medication_administration_log', 'participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.medication_administration_log ALTER COLUMN administered_at SET DEFAULT timezone('utc'::text, now());
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'medication_administration_log', 'administered_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.medication_administration_log ALTER COLUMN administered_by_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'medication_administration_log', 'administered_by_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.medication_administration_log ALTER COLUMN witnessed_by_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'medication_administration_log', 'witnessed_by_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.medication_administration_log ALTER COLUMN status SET DEFAULT 'Administered';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'medication_administration_log', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.medication_administration_log ALTER COLUMN notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'medication_administration_log', 'notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.medication_administration_log ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'medication_administration_log', 'created_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.myob_export_batches ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'myob_export_batches', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.myob_export_batches ALTER COLUMN exported_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'myob_export_batches', 'exported_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.myob_export_batches ALTER COLUMN exported_by DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'myob_export_batches', 'exported_by', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.myob_export_batches ALTER COLUMN range_start DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'myob_export_batches', 'range_start', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.myob_export_batches ALTER COLUMN range_end DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'myob_export_batches', 'range_end', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.myob_export_batches ALTER COLUMN row_count DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'myob_export_batches', 'row_count', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.offline_sync_logs ALTER COLUMN id SET DEFAULT uuid_generate_v4();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'offline_sync_logs', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.offline_sync_logs ALTER COLUMN driver_or_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'offline_sync_logs', 'driver_or_staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.offline_sync_logs ALTER COLUMN device_uuid DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'offline_sync_logs', 'device_uuid', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.offline_sync_logs ALTER COLUMN action_type DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'offline_sync_logs', 'action_type', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.offline_sync_logs ALTER COLUMN payload DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'offline_sync_logs', 'payload', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.offline_sync_logs ALTER COLUMN synced_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'offline_sync_logs', 'synced_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.offline_sync_logs ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'offline_sync_logs', 'created_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.operational_emergencies ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergencies', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_emergencies ALTER COLUMN mode DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergencies', 'mode', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_emergencies ALTER COLUMN severity DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergencies', 'severity', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_emergencies ALTER COLUMN situation_text DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergencies', 'situation_text', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_emergencies ALTER COLUMN status SET DEFAULT 'active';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergencies', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_emergencies ALTER COLUMN site_day_session_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergencies', 'site_day_session_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_emergencies ALTER COLUMN event_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergencies', 'event_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_emergencies ALTER COLUMN event_day_session_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergencies', 'event_day_session_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_emergencies ALTER COLUMN surface SET DEFAULT 'centre';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergencies', 'surface', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_emergencies ALTER COLUMN activated_by_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergencies', 'activated_by_staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_emergencies ALTER COLUMN activated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergencies', 'activated_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_emergencies ALTER COLUMN stood_down_by_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergencies', 'stood_down_by_staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_emergencies ALTER COLUMN stood_down_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergencies', 'stood_down_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_emergencies ALTER COLUMN debrief_text DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergencies', 'debrief_text', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_emergencies ALTER COLUMN hub_issue_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergencies', 'hub_issue_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_emergencies ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergencies', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_emergencies ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergencies', 'updated_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.operational_emergency_muster ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergency_muster', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_emergency_muster ALTER COLUMN emergency_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergency_muster', 'emergency_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_emergency_muster ALTER COLUMN participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergency_muster', 'participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_emergency_muster ALTER COLUMN participant_name DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergency_muster', 'participant_name', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_emergency_muster ALTER COLUMN state SET DEFAULT 'expected';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergency_muster', 'state', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_emergency_muster ALTER COLUMN updated_by_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergency_muster', 'updated_by_staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_emergency_muster ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergency_muster', 'updated_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_emergency_muster ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_emergency_muster', 'created_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.operational_escalations ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_escalations', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_escalations ALTER COLUMN clearance_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_escalations', 'clearance_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_escalations ALTER COLUMN driver_name DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_escalations', 'driver_name', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_escalations ALTER COLUMN vehicle_info DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_escalations', 'vehicle_info', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_escalations ALTER COLUMN gate_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_escalations', 'gate_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_escalations ALTER COLUMN status SET DEFAULT 'pending';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_escalations', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_escalations ALTER COLUMN claimed_by DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_escalations', 'claimed_by', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_escalations ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_escalations', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_escalations ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_escalations', 'updated_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_escalations ALTER COLUMN resolution_notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_escalations', 'resolution_notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_escalations ALTER COLUMN resolved_by DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_escalations', 'resolved_by', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_escalations ALTER COLUMN resolved_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_escalations', 'resolved_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_escalations ALTER COLUMN source_kind DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_escalations', 'source_kind', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_escalations ALTER COLUMN source_issue_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_escalations', 'source_issue_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_escalations ALTER COLUMN claimed_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_escalations', 'claimed_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_escalations ALTER COLUMN raised_by DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_escalations', 'raised_by', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_escalations ALTER COLUMN operator_acknowledged_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_escalations', 'operator_acknowledged_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_escalations ALTER COLUMN operator_acknowledged_by DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_escalations', 'operator_acknowledged_by', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.operational_incidents ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_incidents', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_incidents ALTER COLUMN incident_type DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_incidents', 'incident_type', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_incidents ALTER COLUMN severity DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_incidents', 'severity', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_incidents ALTER COLUMN description DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_incidents', 'description', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_incidents ALTER COLUMN vehicle_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_incidents', 'vehicle_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_incidents ALTER COLUMN event_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_incidents', 'event_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_incidents ALTER COLUMN reported_by DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_incidents', 'reported_by', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_incidents ALTER COLUMN status SET DEFAULT 'pending';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_incidents', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_incidents ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_incidents', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_incidents ALTER COLUMN occurred_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_incidents', 'occurred_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_incidents ALTER COLUMN affected_participant_ids SET DEFAULT '{}'::uuid[];
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_incidents', 'affected_participant_ids', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_incidents ALTER COLUMN assisting_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_incidents', 'assisting_staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_incidents ALTER COLUMN no_participant_involved SET DEFAULT false;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_incidents', 'no_participant_involved', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_incidents ALTER COLUMN assisting_staff_ids SET DEFAULT '{}'::uuid[];
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_incidents', 'assisting_staff_ids', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.operational_ledger ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_ledger', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_ledger ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_ledger', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_ledger ALTER COLUMN staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_ledger', 'staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_ledger ALTER COLUMN category DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_ledger', 'category', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_ledger ALTER COLUMN severity DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_ledger', 'severity', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_ledger ALTER COLUMN action_type DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_ledger', 'action_type', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_ledger ALTER COLUMN gps_lat DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_ledger', 'gps_lat', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_ledger ALTER COLUMN gps_lng DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_ledger', 'gps_lng', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.operational_ledger ALTER COLUMN metadata DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'operational_ledger', 'metadata', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.participant_attendance_schedules ALTER COLUMN id SET DEFAULT uuid_generate_v4();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_attendance_schedules', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_attendance_schedules ALTER COLUMN participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_attendance_schedules', 'participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_attendance_schedules ALTER COLUMN day_of_week DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_attendance_schedules', 'day_of_week', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_attendance_schedules ALTER COLUMN service_type DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_attendance_schedules', 'service_type', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_attendance_schedules ALTER COLUMN transport_required DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_attendance_schedules', 'transport_required', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_attendance_schedules ALTER COLUMN active SET DEFAULT true;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_attendance_schedules', 'active', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_attendance_schedules ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_attendance_schedules', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_attendance_schedules ALTER COLUMN archived_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_attendance_schedules', 'archived_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_attendance_schedules ALTER COLUMN archived_by_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_attendance_schedules', 'archived_by_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_attendance_schedules ALTER COLUMN archive_witnessed_by_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_attendance_schedules', 'archive_witnessed_by_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_attendance_schedules ALTER COLUMN archive_reason DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_attendance_schedules', 'archive_reason', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_attendance_schedules ALTER COLUMN archive_reference_type DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_attendance_schedules', 'archive_reference_type', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_attendance_schedules ALTER COLUMN expected_arrival_time SET DEFAULT '09:00:00'::time without time zone;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_attendance_schedules', 'expected_arrival_time', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_attendance_schedules ALTER COLUMN expected_departure_time SET DEFAULT '15:00:00'::time without time zone;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_attendance_schedules', 'expected_departure_time', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_attendance_schedules ALTER COLUMN inbound_transport DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_attendance_schedules', 'inbound_transport', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_attendance_schedules ALTER COLUMN outbound_transport DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_attendance_schedules', 'outbound_transport', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.participant_compliance_and_alerts ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_compliance_and_alerts', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_compliance_and_alerts ALTER COLUMN participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_compliance_and_alerts', 'participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_compliance_and_alerts ALTER COLUMN record_type DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_compliance_and_alerts', 'record_type', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_compliance_and_alerts ALTER COLUMN reference_data DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_compliance_and_alerts', 'reference_data', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_compliance_and_alerts ALTER COLUMN expiry_date DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_compliance_and_alerts', 'expiry_date', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_compliance_and_alerts ALTER COLUMN notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_compliance_and_alerts', 'notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_compliance_and_alerts ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_compliance_and_alerts', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_compliance_and_alerts ALTER COLUMN updated_at SET DEFAULT timezone('utc'::text, now());
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_compliance_and_alerts', 'updated_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.participant_financial_ledger ALTER COLUMN id SET DEFAULT uuid_generate_v4();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_financial_ledger', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_financial_ledger ALTER COLUMN participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_financial_ledger', 'participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_financial_ledger ALTER COLUMN transaction_date DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_financial_ledger', 'transaction_date', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_financial_ledger ALTER COLUMN financial_code DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_financial_ledger', 'financial_code', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_financial_ledger ALTER COLUMN description DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_financial_ledger', 'description', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_financial_ledger ALTER COLUMN amount DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_financial_ledger', 'amount', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_financial_ledger ALTER COLUMN is_reconciled SET DEFAULT false;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_financial_ledger', 'is_reconciled', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_financial_ledger ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_financial_ledger', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_financial_ledger ALTER COLUMN event_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_financial_ledger', 'event_id', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN category DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'category', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN exclude_centre SET DEFAULT true;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'exclude_centre', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN exclude_trips SET DEFAULT true;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'exclude_trips', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN excluded_from SET DEFAULT (timezone('Australia/Sydney'::text, now()))::date;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'excluded_from', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN status SET DEFAULT 'active';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN hub_issue_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'hub_issue_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN site_day_session_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'site_day_session_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN declared_by_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'declared_by_staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN declared_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'declared_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN clearance_method DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'clearance_method', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN clearance_note DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'clearance_note', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN evidence_ref DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'evidence_ref', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN cleared_by_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'cleared_by_staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN cleared_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'cleared_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'updated_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN event_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'event_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN event_day_session_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'event_day_session_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN home_safe_disposition DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'home_safe_disposition', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN home_safe_handover_to DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'home_safe_handover_to', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN home_safe_note DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'home_safe_note', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN home_safe_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'home_safe_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN home_safe_by_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_infectious_exclusions', 'home_safe_by_staff_id', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.participant_medication_schedules ALTER COLUMN id SET DEFAULT uuid_generate_v4();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_medication_schedules', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_medication_schedules ALTER COLUMN participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_medication_schedules', 'participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_medication_schedules ALTER COLUMN medication_name DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_medication_schedules', 'medication_name', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_medication_schedules ALTER COLUMN dosage DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_medication_schedules', 'dosage', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_medication_schedules ALTER COLUMN expected_time DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_medication_schedules', 'expected_time', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_medication_schedules ALTER COLUMN frequency SET DEFAULT 'Daily';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_medication_schedules', 'frequency', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_medication_schedules ALTER COLUMN active SET DEFAULT true;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_medication_schedules', 'active', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participant_medication_schedules ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participant_medication_schedules', 'created_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.participants ALTER COLUMN id SET DEFAULT uuid_generate_v4();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participants', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participants ALTER COLUMN first_name DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participants', 'first_name', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participants ALTER COLUMN last_name DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participants', 'last_name', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participants ALTER COLUMN ndis_number DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participants', 'ndis_number', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participants ALTER COLUMN iddsi_level_liquids DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participants', 'iddsi_level_liquids', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participants ALTER COLUMN iddsi_level_solids DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participants', 'iddsi_level_solids', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participants ALTER COLUMN dual_witness_pin_hash DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participants', 'dual_witness_pin_hash', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participants ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participants', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participants ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participants', 'updated_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participants ALTER COLUMN street_address DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participants', 'street_address', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participants ALTER COLUMN notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participants', 'notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participants ALTER COLUMN emergency_contact_name DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participants', 'emergency_contact_name', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participants ALTER COLUMN emergency_contact_phone DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participants', 'emergency_contact_phone', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participants ALTER COLUMN emergency_contact_relationship DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participants', 'emergency_contact_relationship', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participants ALTER COLUMN regular_pickup_address DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participants', 'regular_pickup_address', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participants ALTER COLUMN participant_kind SET DEFAULT 'client';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participants', 'participant_kind', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participants ALTER COLUMN archived_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participants', 'archived_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participants ALTER COLUMN date_of_birth DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participants', 'date_of_birth', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.participants ALTER COLUMN allergies_notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'participants', 'allergies_notes', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.site_day_activities ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_activities', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_activities ALTER COLUMN session_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_activities', 'session_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_activities ALTER COLUMN activity_kind SET DEFAULT 'meal';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_activities', 'activity_kind', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_activities ALTER COLUMN meal_slot DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_activities', 'meal_slot', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_activities ALTER COLUMN title DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_activities', 'title', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_activities ALTER COLUMN meal_source DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_activities', 'meal_source', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_activities ALTER COLUMN menu_notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_activities', 'menu_notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_activities ALTER COLUMN phase SET DEFAULT 'pending';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_activities', 'phase', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_activities ALTER COLUMN sort_order SET DEFAULT 0;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_activities', 'sort_order', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_activities ALTER COLUMN opened_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_activities', 'opened_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_activities ALTER COLUMN opened_by_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_activities', 'opened_by_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_activities ALTER COLUMN closed_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_activities', 'closed_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_activities ALTER COLUMN closed_by_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_activities', 'closed_by_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_activities ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_activities', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_activities ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_activities', 'updated_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_activities ALTER COLUMN prepared_by_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_activities', 'prepared_by_staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_activities ALTER COLUMN preparer_cert_status DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_activities', 'preparer_cert_status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_activities ALTER COLUMN preparer_ack_note DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_activities', 'preparer_ack_note', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_activities ALTER COLUMN prep_checks_completed DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_activities', 'prep_checks_completed', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_activities ALTER COLUMN prep_attestation_mode DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_activities', 'prep_attestation_mode', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_activities ALTER COLUMN prep_attested_by_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_activities', 'prep_attested_by_staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_activities ALTER COLUMN guest_preparer_name DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_activities', 'guest_preparer_name', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_activities ALTER COLUMN prep_attestation_note DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_activities', 'prep_attestation_note', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_activities ALTER COLUMN sfh_approved_by_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_activities', 'sfh_approved_by_staff_id', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.site_day_meal_service_rolls ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_meal_service_rolls', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_meal_service_rolls ALTER COLUMN activity_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_meal_service_rolls', 'activity_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_meal_service_rolls ALTER COLUMN participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_meal_service_rolls', 'participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_meal_service_rolls ALTER COLUMN status SET DEFAULT 'expected';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_meal_service_rolls', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_meal_service_rolls ALTER COLUMN notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_meal_service_rolls', 'notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_meal_service_rolls ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_meal_service_rolls', 'updated_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_meal_service_rolls ALTER COLUMN updated_by_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_meal_service_rolls', 'updated_by_id', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.site_day_sessions ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_sessions', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_sessions ALTER COLUMN session_date SET DEFAULT CURRENT_DATE;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_sessions', 'session_date', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_sessions ALTER COLUMN phase SET DEFAULT 'open_pending'::site_session_status;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_sessions', 'phase', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_sessions ALTER COLUMN opened_by_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_sessions', 'opened_by_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_sessions ALTER COLUMN open_declared_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_sessions', 'open_declared_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_sessions ALTER COLUMN open_leader_notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_sessions', 'open_leader_notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_sessions ALTER COLUMN closed_by_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_sessions', 'closed_by_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_sessions ALTER COLUMN close_declared_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_sessions', 'close_declared_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_sessions ALTER COLUMN close_leader_notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_sessions', 'close_leader_notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_sessions ALTER COLUMN manager_plan_text DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_sessions', 'manager_plan_text', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_sessions ALTER COLUMN manager_decision DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_sessions', 'manager_decision', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_sessions ALTER COLUMN manager_auth_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_sessions', 'manager_auth_staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_sessions ALTER COLUMN manager_auth_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_sessions', 'manager_auth_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_sessions ALTER COLUMN leader_decision DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_sessions', 'leader_decision', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_sessions ALTER COLUMN leader_auth_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_sessions', 'leader_auth_staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_sessions ALTER COLUMN leader_auth_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_sessions', 'leader_auth_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_sessions ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_sessions', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_sessions ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_sessions', 'updated_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_sessions ALTER COLUMN lockdown_active SET DEFAULT false;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_sessions', 'lockdown_active', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_sessions ALTER COLUMN lockdown_reason DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_sessions', 'lockdown_reason', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_sessions ALTER COLUMN lockdown_severity DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_sessions', 'lockdown_severity', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_sessions ALTER COLUMN lockdown_hub_issue_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_sessions', 'lockdown_hub_issue_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_sessions ALTER COLUMN lockdown_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_sessions', 'lockdown_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_sessions ALTER COLUMN lockdown_by_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_sessions', 'lockdown_by_staff_id', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.site_day_visitors ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_visitors', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_visitors ALTER COLUMN session_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_visitors', 'session_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_visitors ALTER COLUMN display_name DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_visitors', 'display_name', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_visitors ALTER COLUMN kind DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_visitors', 'kind', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_visitors ALTER COLUMN linked_participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_visitors', 'linked_participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_visitors ALTER COLUMN note DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_visitors', 'note', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_visitors ALTER COLUMN arrived_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_visitors', 'arrived_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_visitors ALTER COLUMN arrived_by DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_visitors', 'arrived_by', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_visitors ALTER COLUMN left_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_visitors', 'left_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_visitors ALTER COLUMN left_by DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_visitors', 'left_by', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_visitors ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_visitors', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_day_visitors ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_day_visitors', 'updated_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.site_issues_register ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_issues_register', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_issues_register ALTER COLUMN session_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_issues_register', 'session_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_issues_register ALTER COLUMN reported_by DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_issues_register', 'reported_by', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_issues_register ALTER COLUMN severity DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_issues_register', 'severity', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_issues_register ALTER COLUMN issue_description DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_issues_register', 'issue_description', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_issues_register ALTER COLUMN workaround_plan DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_issues_register', 'workaround_plan', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_issues_register ALTER COLUMN owner SET DEFAULT 'internal'::responsibility_owner;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_issues_register', 'owner', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_issues_register ALTER COLUMN council_sla_category DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_issues_register', 'council_sla_category', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_issues_register ALTER COLUMN council_sla_deadline DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_issues_register', 'council_sla_deadline', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_issues_register ALTER COLUMN email_dispatched_to_council SET DEFAULT false;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_issues_register', 'email_dispatched_to_council', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_issues_register ALTER COLUMN email_dispatched_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_issues_register', 'email_dispatched_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_issues_register ALTER COLUMN status SET DEFAULT 'open'::character varying;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_issues_register', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_issues_register ALTER COLUMN resolved_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_issues_register', 'resolved_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_issues_register ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_issues_register', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_issues_register ALTER COLUMN workaround_accepted_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_issues_register', 'workaround_accepted_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_issues_register ALTER COLUMN update_log SET DEFAULT '';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_issues_register', 'update_log', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_issues_register ALTER COLUMN deferred_until DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_issues_register', 'deferred_until', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_issues_register ALTER COLUMN council_severity DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_issues_register', 'council_severity', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_issues_register ALTER COLUMN event_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_issues_register', 'event_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_issues_register ALTER COLUMN event_day_session_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_issues_register', 'event_day_session_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_issues_register ALTER COLUMN issue_area DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_issues_register', 'issue_area', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.site_issues_register ALTER COLUMN occurred_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'site_issues_register', 'occurred_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.staff_compliance_and_certs ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'staff_compliance_and_certs', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.staff_compliance_and_certs ALTER COLUMN staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'staff_compliance_and_certs', 'staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.staff_compliance_and_certs ALTER COLUMN cert_type DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'staff_compliance_and_certs', 'cert_type', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.staff_compliance_and_certs ALTER COLUMN reference_number DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'staff_compliance_and_certs', 'reference_number', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.staff_compliance_and_certs ALTER COLUMN expiry_date DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'staff_compliance_and_certs', 'expiry_date', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.staff_compliance_and_certs ALTER COLUMN notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'staff_compliance_and_certs', 'notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.staff_compliance_and_certs ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'staff_compliance_and_certs', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.staff_compliance_and_certs ALTER COLUMN updated_at SET DEFAULT timezone('utc'::text, now());
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'staff_compliance_and_certs', 'updated_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.staff_registry ALTER COLUMN id SET DEFAULT uuid_generate_v4();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'staff_registry', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.staff_registry ALTER COLUMN full_name DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'staff_registry', 'full_name', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.staff_registry ALTER COLUMN role DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'staff_registry', 'role', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.staff_registry ALTER COLUMN pin_hash DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'staff_registry', 'pin_hash', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.staff_registry ALTER COLUMN active SET DEFAULT true;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'staff_registry', 'active', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.staff_registry ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'staff_registry', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.staff_registry ALTER COLUMN phone DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'staff_registry', 'phone', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.staff_registry ALTER COLUMN email DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'staff_registry', 'email', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.staff_registry ALTER COLUMN street_address DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'staff_registry', 'street_address', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.staff_registry ALTER COLUMN personnel_type SET DEFAULT 'Volunteer';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'staff_registry', 'personnel_type', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.staff_registry ALTER COLUMN certifications SET DEFAULT '[]'::jsonb;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'staff_registry', 'certifications', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.staff_registry ALTER COLUMN notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'staff_registry', 'notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.staff_registry ALTER COLUMN auth_user_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'staff_registry', 'auth_user_id', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.system_lookup_parameters ALTER COLUMN id SET DEFAULT uuid_generate_v4();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'system_lookup_parameters', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.system_lookup_parameters ALTER COLUMN category DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'system_lookup_parameters', 'category', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.system_lookup_parameters ALTER COLUMN code DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'system_lookup_parameters', 'code', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.system_lookup_parameters ALTER COLUMN display_name DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'system_lookup_parameters', 'display_name', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.system_lookup_parameters ALTER COLUMN active SET DEFAULT true;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'system_lookup_parameters', 'active', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.system_lookup_parameters ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'system_lookup_parameters', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.system_lookup_parameters ALTER COLUMN sort_order SET DEFAULT 0;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'system_lookup_parameters', 'sort_order', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.system_lookup_parameters ALTER COLUMN badge_color DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'system_lookup_parameters', 'badge_color', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.system_operational_settings ALTER COLUMN key DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'system_operational_settings', 'key', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.system_operational_settings ALTER COLUMN value_uuid DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'system_operational_settings', 'value_uuid', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.system_operational_settings ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'system_operational_settings', 'updated_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.system_operational_settings ALTER COLUMN updated_by DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'system_operational_settings', 'updated_by', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.system_parameters ALTER COLUMN key DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'system_parameters', 'key', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.system_parameters ALTER COLUMN value DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'system_parameters', 'value', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.system_parameters ALTER COLUMN description DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'system_parameters', 'description', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.system_parameters ALTER COLUMN updated_by DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'system_parameters', 'updated_by', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.system_parameters ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'system_parameters', 'updated_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.transport_assets ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_assets', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_assets ALTER COLUMN name DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_assets', 'name', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_assets ALTER COLUMN make_model DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_assets', 'make_model', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_assets ALTER COLUMN rego_plate DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_assets', 'rego_plate', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_assets ALTER COLUMN passenger_capacity SET DEFAULT 12;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_assets', 'passenger_capacity', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_assets ALTER COLUMN is_active SET DEFAULT true;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_assets', 'is_active', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_assets ALTER COLUMN vehicle_category SET DEFAULT 'bus';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_assets', 'vehicle_category', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_assets ALTER COLUMN vin DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_assets', 'vin', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_assets ALTER COLUMN registration_expiry DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_assets', 'registration_expiry', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_assets ALTER COLUMN service_interval_km DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_assets', 'service_interval_km', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_assets ALTER COLUMN last_service_odo DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_assets', 'last_service_odo', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_assets ALTER COLUMN last_service_date DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_assets', 'last_service_date', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_assets ALTER COLUMN deferred_until DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_assets', 'deferred_until', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_assets ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_assets', 'updated_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_assets ALTER COLUMN has_wheelchair_hoist SET DEFAULT false;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_assets', 'has_wheelchair_hoist', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_assets ALTER COLUMN current_odometer_km DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_assets', 'current_odometer_km', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_assets ALTER COLUMN current_odometer_updated_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_assets', 'current_odometer_updated_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.transport_requests ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_requests', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_requests ALTER COLUMN participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_requests', 'participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_requests ALTER COLUMN request_date SET DEFAULT CURRENT_DATE;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_requests', 'request_date', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_requests ALTER COLUMN scheduled_time DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_requests', 'scheduled_time', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_requests ALTER COLUMN pickup_address DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_requests', 'pickup_address', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_requests ALTER COLUMN destination_label DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_requests', 'destination_label', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_requests ALTER COLUMN reason DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_requests', 'reason', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_requests ALTER COLUMN hoist_required SET DEFAULT false;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_requests', 'hoist_required', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_requests ALTER COLUMN status SET DEFAULT 'requested';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_requests', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_requests ALTER COLUMN assigned_driver_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_requests', 'assigned_driver_staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_requests ALTER COLUMN assigned_asset_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_requests', 'assigned_asset_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_requests ALTER COLUMN notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_requests', 'notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_requests ALTER COLUMN completed_sync_log_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_requests', 'completed_sync_log_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_requests ALTER COLUMN completed_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_requests', 'completed_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_requests ALTER COLUMN created_by_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_requests', 'created_by_staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_requests ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_requests', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_requests ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_requests', 'updated_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN event_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'event_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN driver_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'driver_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN vehicle_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'vehicle_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN start_odometer DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'start_odometer', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN end_odometer DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'end_odometer', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN status SET DEFAULT 'Not Started';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN driver_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'driver_staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN trip_date SET DEFAULT CURRENT_DATE;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'trip_date', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN start_odometer_km DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'start_odometer_km', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN end_odometer_km DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'end_odometer_km', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN started_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'started_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN completed_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'completed_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'updated_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN start_odometer_variance_reason DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'start_odometer_variance_reason', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN bus_run_code DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'bus_run_code', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN trip_origin SET DEFAULT 'depot';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'trip_origin', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN trip_return SET DEFAULT 'depot';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'trip_return', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN origin_address DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'origin_address', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN trip_kind DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'trip_kind', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN event_day_session_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'event_day_session_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN venue_stop_from_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'venue_stop_from_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN venue_stop_to_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'venue_stop_to_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN hop_index DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'hop_index', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.transport_trips ALTER COLUMN asset_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'transport_trips', 'asset_id', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN trip_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'trip_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN leg_type DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'leg_type', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN sequence_order DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'sequence_order', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN status SET DEFAULT 'Pending';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN start_lat DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'start_lat', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN start_lng DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'start_lng', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN end_lat DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'end_lat', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN end_lng DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'end_lng', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN calculated_gps_km SET DEFAULT 0.0;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'calculated_gps_km', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN override_km DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'override_km', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN medication_bag_collected SET DEFAULT false;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'medication_bag_collected', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN medication_bag_unexpected SET DEFAULT false;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'medication_bag_unexpected', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN medication_bag_notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'medication_bag_notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN started_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'started_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN completed_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'completed_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN leg_index DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'leg_index', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN leg_kind DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'leg_kind', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN from_label DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'from_label', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN to_label DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'to_label', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN from_participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'from_participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN to_participant_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'to_participant_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN start_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'start_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN end_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'end_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN gps_distance_km DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'gps_distance_km', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN logged_distance_km DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'logged_distance_km', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN passenger_present DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'passenger_present', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN no_show_triggered_at DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'no_show_triggered_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN medication_expected SET DEFAULT false;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'medication_expected', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN medication_handover_confirmed SET DEFAULT false;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'medication_handover_confirmed', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN unexpected_medication_logged SET DEFAULT false;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'unexpected_medication_logged', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN unexpected_medication_notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'unexpected_medication_notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'updated_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN target_address DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'target_address', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.trip_legs ALTER COLUMN medication_handover_status SET DEFAULT 'Not Required';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'trip_legs', 'medication_handover_status', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.vendors ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'vendors', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.vendors ALTER COLUMN name DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'vendors', 'name', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.vendors ALTER COLUMN status SET DEFAULT 'active';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'vendors', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.vendors ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'vendors', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.vendors ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'vendors', 'updated_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.venue_safety_answers ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venue_safety_answers', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venue_safety_answers ALTER COLUMN signoff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venue_safety_answers', 'signoff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venue_safety_answers ALTER COLUMN field_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venue_safety_answers', 'field_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venue_safety_answers ALTER COLUMN answer_text DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venue_safety_answers', 'answer_text', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venue_safety_answers ALTER COLUMN answer_json DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venue_safety_answers', 'answer_json', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venue_safety_answers ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venue_safety_answers', 'created_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.venue_safety_baseline_signoffs ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venue_safety_baseline_signoffs', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venue_safety_baseline_signoffs ALTER COLUMN venue_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venue_safety_baseline_signoffs', 'venue_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venue_safety_baseline_signoffs ALTER COLUMN signed_off_by_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venue_safety_baseline_signoffs', 'signed_off_by_staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venue_safety_baseline_signoffs ALTER COLUMN signed_off_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venue_safety_baseline_signoffs', 'signed_off_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venue_safety_baseline_signoffs ALTER COLUMN evidence_ref DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venue_safety_baseline_signoffs', 'evidence_ref', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venue_safety_baseline_signoffs ALTER COLUMN notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venue_safety_baseline_signoffs', 'notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venue_safety_baseline_signoffs ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venue_safety_baseline_signoffs', 'created_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.venue_template_fields ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venue_template_fields', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venue_template_fields ALTER COLUMN venue_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venue_template_fields', 'venue_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venue_template_fields ALTER COLUMN prompt DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venue_template_fields', 'prompt', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venue_template_fields ALTER COLUMN answer_type SET DEFAULT 'yes_no';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venue_template_fields', 'answer_type', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venue_template_fields ALTER COLUMN options_json DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venue_template_fields', 'options_json', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venue_template_fields ALTER COLUMN is_mandatory SET DEFAULT true;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venue_template_fields', 'is_mandatory', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venue_template_fields ALTER COLUMN is_system_core SET DEFAULT false;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venue_template_fields', 'is_system_core', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venue_template_fields ALTER COLUMN sort_order SET DEFAULT 0;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venue_template_fields', 'sort_order', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venue_template_fields ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venue_template_fields', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venue_template_fields ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venue_template_fields', 'updated_at', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE public.venues ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venues', 'id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venues ALTER COLUMN name DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venues', 'name', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venues ALTER COLUMN venue_type SET DEFAULT 'general';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venues', 'venue_type', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venues ALTER COLUMN status SET DEFAULT 'active';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venues', 'status', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venues ALTER COLUMN street_address DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venues', 'street_address', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venues ALTER COLUMN gps_lat DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venues', 'gps_lat', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venues ALTER COLUMN gps_lng DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venues', 'gps_lng', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venues ALTER COLUMN access_notes DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venues', 'access_notes', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venues ALTER COLUMN site_contact_name DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venues', 'site_contact_name', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venues ALTER COLUMN site_contact_phone DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venues', 'site_contact_phone', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venues ALTER COLUMN max_safe_group_size DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venues', 'max_safe_group_size', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venues ALTER COLUMN risk_tier SET DEFAULT 'medium';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venues', 'risk_tier', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venues ALTER COLUMN cloned_from_venue_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venues', 'cloned_from_venue_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venues ALTER COLUMN created_by_staff_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venues', 'created_by_staff_id', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venues ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venues', 'created_at', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE public.venues ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SKIP DEFAULT %.%: %', 'venues', 'updated_at', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Align NULLABILITY
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  UPDATE public.asset_checkpoints SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.asset_checkpoints ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'asset_checkpoints', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.asset_checkpoints ALTER COLUMN checkpoint_text SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'asset_checkpoints', 'checkpoint_text', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.asset_checkpoints ALTER COLUMN vehicle_category SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'asset_checkpoints', 'vehicle_category', SQLERRM;
  END;
END $$;

ALTER TABLE public.asset_checkpoints ALTER COLUMN asset_id DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.asset_checkpoints SET impact_level = 'minor_log_only' WHERE impact_level IS NULL;
  BEGIN
    ALTER TABLE public.asset_checkpoints ALTER COLUMN impact_level SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'asset_checkpoints', 'impact_level', SQLERRM;
  END;
END $$;

ALTER TABLE public.asset_checkpoints ALTER COLUMN is_mandatory DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.asset_clearance_items SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.asset_clearance_items ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'asset_clearance_items', 'id', SQLERRM;
  END;
END $$;

ALTER TABLE public.asset_clearance_items ALTER COLUMN clearance_id DROP NOT NULL;
ALTER TABLE public.asset_clearance_items ALTER COLUMN checkpoint_id DROP NOT NULL;
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.asset_clearance_items ALTER COLUMN is_passed SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'asset_clearance_items', 'is_passed', SQLERRM;
  END;
END $$;

ALTER TABLE public.asset_clearance_items ALTER COLUMN notes DROP NOT NULL;
ALTER TABLE public.asset_clearance_items ALTER COLUMN severity DROP NOT NULL;
ALTER TABLE public.asset_clearance_items ALTER COLUMN workaround_text DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.asset_daily_clearance SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.asset_daily_clearance ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'asset_daily_clearance', 'id', SQLERRM;
  END;
END $$;

ALTER TABLE public.asset_daily_clearance ALTER COLUMN asset_id DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.asset_daily_clearance SET clearance_date = CURRENT_DATE WHERE clearance_date IS NULL;
  BEGIN
    ALTER TABLE public.asset_daily_clearance ALTER COLUMN clearance_date SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'asset_daily_clearance', 'clearance_date', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.asset_daily_clearance ALTER COLUMN driver_staff_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'asset_daily_clearance', 'driver_staff_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.asset_daily_clearance ALTER COLUMN start_odometer SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'asset_daily_clearance', 'start_odometer', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.asset_daily_clearance ALTER COLUMN status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'asset_daily_clearance', 'status', SQLERRM;
  END;
END $$;

ALTER TABLE public.asset_daily_clearance ALTER COLUMN accumulated_issues DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.asset_daily_clearance SET driver_comfort_declared = false WHERE driver_comfort_declared IS NULL;
  BEGIN
    ALTER TABLE public.asset_daily_clearance ALTER COLUMN driver_comfort_declared SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'asset_daily_clearance', 'driver_comfort_declared', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.asset_daily_clearance SET requires_manager_review = false WHERE requires_manager_review IS NULL;
  BEGIN
    ALTER TABLE public.asset_daily_clearance ALTER COLUMN requires_manager_review SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'asset_daily_clearance', 'requires_manager_review', SQLERRM;
  END;
END $$;

ALTER TABLE public.asset_daily_clearance ALTER COLUMN driver_auth_staff_id DROP NOT NULL;
ALTER TABLE public.asset_daily_clearance ALTER COLUMN driver_auth_pin_verified_at DROP NOT NULL;
ALTER TABLE public.asset_daily_clearance ALTER COLUMN manager_auth_staff_id DROP NOT NULL;
ALTER TABLE public.asset_daily_clearance ALTER COLUMN manager_auth_pin_verified_at DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.asset_maintenance_logs SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.asset_maintenance_logs ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'asset_maintenance_logs', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.asset_maintenance_logs ALTER COLUMN asset_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'asset_maintenance_logs', 'asset_id', SQLERRM;
  END;
END $$;

ALTER TABLE public.asset_maintenance_logs ALTER COLUMN logged_by_id DROP NOT NULL;
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.asset_maintenance_logs ALTER COLUMN log_type SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'asset_maintenance_logs', 'log_type', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.asset_maintenance_logs SET log_date = CURRENT_DATE WHERE log_date IS NULL;
  BEGIN
    ALTER TABLE public.asset_maintenance_logs ALTER COLUMN log_date SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'asset_maintenance_logs', 'log_date', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.asset_maintenance_logs ALTER COLUMN description SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'asset_maintenance_logs', 'description', SQLERRM;
  END;
END $$;

ALTER TABLE public.asset_maintenance_logs ALTER COLUMN cost DROP NOT NULL;
ALTER TABLE public.asset_maintenance_logs ALTER COLUMN current_odometer_reading DROP NOT NULL;
ALTER TABLE public.asset_maintenance_logs ALTER COLUMN is_resolved DROP NOT NULL;
ALTER TABLE public.asset_maintenance_logs ALTER COLUMN notes DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.asset_maintenance_logs SET created_at = timezone('utc'::text, now()) WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.asset_maintenance_logs ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'asset_maintenance_logs', 'created_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.assets SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.assets ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'assets', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.assets ALTER COLUMN asset_name SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'assets', 'asset_name', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.assets ALTER COLUMN asset_type SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'assets', 'asset_type', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.assets SET status = 'Active' WHERE status IS NULL;
  BEGIN
    ALTER TABLE public.assets ALTER COLUMN status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'assets', 'status', SQLERRM;
  END;
END $$;

ALTER TABLE public.assets ALTER COLUMN identifier_string DROP NOT NULL;
ALTER TABLE public.assets ALTER COLUMN insurance_policy_number DROP NOT NULL;
ALTER TABLE public.assets ALTER COLUMN insurance_expiry DROP NOT NULL;
ALTER TABLE public.assets ALTER COLUMN next_compliance_review_date DROP NOT NULL;
ALTER TABLE public.assets ALTER COLUMN custom_specifications DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.assets SET created_at = timezone('utc'::text, now()) WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.assets ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'assets', 'created_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.assets SET updated_at = timezone('utc'::text, now()) WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.assets ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'assets', 'updated_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.attendance_roster_logs SET id = uuid_generate_v4() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.attendance_roster_logs ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'attendance_roster_logs', 'id', SQLERRM;
  END;
END $$;

ALTER TABLE public.attendance_roster_logs ALTER COLUMN participant_id DROP NOT NULL;
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.attendance_roster_logs ALTER COLUMN roster_date SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'attendance_roster_logs', 'roster_date', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.attendance_roster_logs ALTER COLUMN expected_service SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'attendance_roster_logs', 'expected_service', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.attendance_roster_logs ALTER COLUMN actual_status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'attendance_roster_logs', 'actual_status', SQLERRM;
  END;
END $$;

ALTER TABLE public.attendance_roster_logs ALTER COLUMN driver_notes DROP NOT NULL;
ALTER TABLE public.attendance_roster_logs ALTER COLUMN recorded_by_uuid DROP NOT NULL;
ALTER TABLE public.attendance_roster_logs ALTER COLUMN device_uuid DROP NOT NULL;
ALTER TABLE public.attendance_roster_logs ALTER COLUMN created_at DROP NOT NULL;
ALTER TABLE public.attendance_roster_logs ALTER COLUMN billing_state DROP NOT NULL;
ALTER TABLE public.attendance_roster_logs ALTER COLUMN ndis_cancellation_reason DROP NOT NULL;
ALTER TABLE public.attendance_roster_logs ALTER COLUMN exported_at DROP NOT NULL;
ALTER TABLE public.attendance_roster_logs ALTER COLUMN exported_batch_id DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.carers_registry SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.carers_registry ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'carers_registry', 'id', SQLERRM;
  END;
END $$;

ALTER TABLE public.carers_registry ALTER COLUMN participant_id DROP NOT NULL;
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.carers_registry ALTER COLUMN full_name SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'carers_registry', 'full_name', SQLERRM;
  END;
END $$;

ALTER TABLE public.carers_registry ALTER COLUMN relationship DROP NOT NULL;
ALTER TABLE public.carers_registry ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE public.carers_registry ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public.carers_registry ALTER COLUMN street_address DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.carers_registry SET is_primary_contact = false WHERE is_primary_contact IS NULL;
  BEGIN
    ALTER TABLE public.carers_registry ALTER COLUMN is_primary_contact SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'carers_registry', 'is_primary_contact', SQLERRM;
  END;
END $$;

ALTER TABLE public.carers_registry ALTER COLUMN notes DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.carers_registry SET created_at = timezone('utc'::text, now()) WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.carers_registry ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'carers_registry', 'created_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  BEGIN
    ALTER TABLE public.centre_operating_hours ALTER COLUMN day_of_week SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'centre_operating_hours', 'day_of_week', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.centre_operating_hours SET open_time = '09:00:00'::time without time zone WHERE open_time IS NULL;
  BEGIN
    ALTER TABLE public.centre_operating_hours ALTER COLUMN open_time SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'centre_operating_hours', 'open_time', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.centre_operating_hours SET close_time = '15:00:00'::time without time zone WHERE close_time IS NULL;
  BEGIN
    ALTER TABLE public.centre_operating_hours ALTER COLUMN close_time SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'centre_operating_hours', 'close_time', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.centre_operating_hours SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.centre_operating_hours ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'centre_operating_hours', 'updated_at', SQLERRM;
  END;
END $$;

ALTER TABLE public.centre_operating_hours ALTER COLUMN updated_by_staff_id DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.charge_codes SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.charge_codes ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'charge_codes', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.charge_codes ALTER COLUMN code SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'charge_codes', 'code', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.charge_codes ALTER COLUMN name SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'charge_codes', 'name', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.charge_codes ALTER COLUMN standard_rate SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'charge_codes', 'standard_rate', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.charge_codes SET unit_type = 'Hourly' WHERE unit_type IS NULL;
  BEGIN
    ALTER TABLE public.charge_codes ALTER COLUMN unit_type SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'charge_codes', 'unit_type', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.charge_codes SET created_at = timezone('utc'::text, now()) WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.charge_codes ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'charge_codes', 'created_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.checklist_items SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.checklist_items ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'checklist_items', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.checklist_items ALTER COLUMN label SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'checklist_items', 'label', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.checklist_items ALTER COLUMN category SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'checklist_items', 'category', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.checklist_items SET sort_order = 100 WHERE sort_order IS NULL;
  BEGIN
    ALTER TABLE public.checklist_items ALTER COLUMN sort_order SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'checklist_items', 'sort_order', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.checklist_items SET is_active = true WHERE is_active IS NULL;
  BEGIN
    ALTER TABLE public.checklist_items ALTER COLUMN is_active SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'checklist_items', 'is_active', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.checklist_items SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.checklist_items ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'checklist_items', 'created_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.checklist_responses SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.checklist_responses ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'checklist_responses', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.checklist_responses ALTER COLUMN ledger_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'checklist_responses', 'ledger_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.checklist_responses ALTER COLUMN item_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'checklist_responses', 'item_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.checklist_responses ALTER COLUMN status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'checklist_responses', 'status', SQLERRM;
  END;
END $$;

ALTER TABLE public.checklist_responses ALTER COLUMN notes DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.checklist_responses SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.checklist_responses ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'checklist_responses', 'created_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.client_attendance_log SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.client_attendance_log ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'client_attendance_log', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.client_attendance_log ALTER COLUMN session_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'client_attendance_log', 'session_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.client_attendance_log ALTER COLUMN participant_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'client_attendance_log', 'participant_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.client_attendance_log ALTER COLUMN expected_arrival_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'client_attendance_log', 'expected_arrival_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.client_attendance_log SET arrival_method = 'bus' WHERE arrival_method IS NULL;
  BEGIN
    ALTER TABLE public.client_attendance_log ALTER COLUMN arrival_method SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'client_attendance_log', 'arrival_method', SQLERRM;
  END;
END $$;

ALTER TABLE public.client_attendance_log ALTER COLUMN checked_in_at DROP NOT NULL;
ALTER TABLE public.client_attendance_log ALTER COLUMN checked_in_by DROP NOT NULL;
ALTER TABLE public.client_attendance_log ALTER COLUMN checked_out_at DROP NOT NULL;
ALTER TABLE public.client_attendance_log ALTER COLUMN checked_out_by DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.client_attendance_log SET status = 'expected' WHERE status IS NULL;
  BEGIN
    ALTER TABLE public.client_attendance_log ALTER COLUMN status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'client_attendance_log', 'status', SQLERRM;
  END;
END $$;

ALTER TABLE public.client_attendance_log ALTER COLUMN escalation_issue_id DROP NOT NULL;
ALTER TABLE public.client_attendance_log ALTER COLUMN escalation_severity DROP NOT NULL;
ALTER TABLE public.client_attendance_log ALTER COLUMN escalation_raised_at DROP NOT NULL;
ALTER TABLE public.client_attendance_log ALTER COLUMN red_sms_dispatched_at DROP NOT NULL;
ALTER TABLE public.client_attendance_log ALTER COLUMN notes DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.client_attendance_log SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.client_attendance_log ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'client_attendance_log', 'created_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.client_attendance_log SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.client_attendance_log ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'client_attendance_log', 'updated_at', SQLERRM;
  END;
END $$;

ALTER TABLE public.client_attendance_log ALTER COLUMN expected_departure_at DROP NOT NULL;
ALTER TABLE public.client_attendance_log ALTER COLUMN departure_issue_id DROP NOT NULL;
ALTER TABLE public.client_attendance_log ALTER COLUMN departure_severity DROP NOT NULL;
ALTER TABLE public.client_attendance_log ALTER COLUMN departure_raised_at DROP NOT NULL;
ALTER TABLE public.client_attendance_log ALTER COLUMN departure_red_sms_dispatched_at DROP NOT NULL;
ALTER TABLE public.client_attendance_log ALTER COLUMN arrival_bus_run_code DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.compliance_assets SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.compliance_assets ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'compliance_assets', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.compliance_assets ALTER COLUMN category SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'compliance_assets', 'category', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.compliance_assets ALTER COLUMN type SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'compliance_assets', 'type', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.compliance_assets ALTER COLUMN name SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'compliance_assets', 'name', SQLERRM;
  END;
END $$;

ALTER TABLE public.compliance_assets ALTER COLUMN description DROP NOT NULL;
ALTER TABLE public.compliance_assets ALTER COLUMN subject_table DROP NOT NULL;
ALTER TABLE public.compliance_assets ALTER COLUMN subject_id DROP NOT NULL;
ALTER TABLE public.compliance_assets ALTER COLUMN expiry_date DROP NOT NULL;
ALTER TABLE public.compliance_assets ALTER COLUMN next_action_at DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.compliance_assets SET action_module = 'generic_resolve' WHERE action_module IS NULL;
  BEGIN
    ALTER TABLE public.compliance_assets ALTER COLUMN action_module SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'compliance_assets', 'action_module', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.compliance_assets SET config = '{}'::jsonb WHERE config IS NULL;
  BEGIN
    ALTER TABLE public.compliance_assets ALTER COLUMN config SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'compliance_assets', 'config', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.compliance_assets SET status = 'active' WHERE status IS NULL;
  BEGIN
    ALTER TABLE public.compliance_assets ALTER COLUMN status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'compliance_assets', 'status', SQLERRM;
  END;
END $$;

ALTER TABLE public.compliance_assets ALTER COLUMN created_by DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.compliance_assets SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.compliance_assets ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'compliance_assets', 'created_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.compliance_assets SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.compliance_assets ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'compliance_assets', 'updated_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.compliance_audit_logs SET id = uuid_generate_v4() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.compliance_audit_logs ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'compliance_audit_logs', 'id', SQLERRM;
  END;
END $$;

ALTER TABLE public.compliance_audit_logs ALTER COLUMN participant_id DROP NOT NULL;
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.compliance_audit_logs ALTER COLUMN action_performed SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'compliance_audit_logs', 'action_performed', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.compliance_audit_logs ALTER COLUMN witness_1_identity SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'compliance_audit_logs', 'witness_1_identity', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.compliance_audit_logs ALTER COLUMN witness_2_identity SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'compliance_audit_logs', 'witness_2_identity', SQLERRM;
  END;
END $$;

ALTER TABLE public.compliance_audit_logs ALTER COLUMN timestamp DROP NOT NULL;
ALTER TABLE public.compliance_audit_logs ALTER COLUMN metadata DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.event_activity_rolls SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.event_activity_rolls ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_activity_rolls', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_activity_rolls ALTER COLUMN venue_stop_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_activity_rolls', 'venue_stop_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_activity_rolls ALTER COLUMN event_day_session_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_activity_rolls', 'event_day_session_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_activity_rolls ALTER COLUMN participant_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_activity_rolls', 'participant_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.event_activity_rolls SET status = 'expected' WHERE status IS NULL;
  BEGIN
    ALTER TABLE public.event_activity_rolls ALTER COLUMN status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_activity_rolls', 'status', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_activity_rolls ALTER COLUMN checked_in_at DROP NOT NULL;
ALTER TABLE public.event_activity_rolls ALTER COLUMN checked_in_by_id DROP NOT NULL;
ALTER TABLE public.event_activity_rolls ALTER COLUMN marked_absent_at DROP NOT NULL;
ALTER TABLE public.event_activity_rolls ALTER COLUMN marked_absent_by_id DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.event_activity_rolls SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.event_activity_rolls ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_activity_rolls', 'created_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.event_activity_rolls SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.event_activity_rolls ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_activity_rolls', 'updated_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.event_attendance_log SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.event_attendance_log ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_attendance_log', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_attendance_log ALTER COLUMN event_day_session_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_attendance_log', 'event_day_session_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_attendance_log ALTER COLUMN participant_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_attendance_log', 'participant_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_attendance_log ALTER COLUMN expected_arrival_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_attendance_log', 'expected_arrival_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.event_attendance_log SET arrival_method = 'bus' WHERE arrival_method IS NULL;
  BEGIN
    ALTER TABLE public.event_attendance_log ALTER COLUMN arrival_method SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_attendance_log', 'arrival_method', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_attendance_log ALTER COLUMN checked_in_at DROP NOT NULL;
ALTER TABLE public.event_attendance_log ALTER COLUMN checked_in_by DROP NOT NULL;
ALTER TABLE public.event_attendance_log ALTER COLUMN checked_out_at DROP NOT NULL;
ALTER TABLE public.event_attendance_log ALTER COLUMN checked_out_by DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.event_attendance_log SET status = 'expected' WHERE status IS NULL;
  BEGIN
    ALTER TABLE public.event_attendance_log ALTER COLUMN status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_attendance_log', 'status', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_attendance_log ALTER COLUMN return_transport DROP NOT NULL;
ALTER TABLE public.event_attendance_log ALTER COLUMN escalation_issue_id DROP NOT NULL;
ALTER TABLE public.event_attendance_log ALTER COLUMN escalation_severity DROP NOT NULL;
ALTER TABLE public.event_attendance_log ALTER COLUMN escalation_raised_at DROP NOT NULL;
ALTER TABLE public.event_attendance_log ALTER COLUMN notes DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.event_attendance_log SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.event_attendance_log ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_attendance_log', 'created_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.event_attendance_log SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.event_attendance_log ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_attendance_log', 'updated_at', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_attendance_log ALTER COLUMN arrival_bus_run_code DROP NOT NULL;
ALTER TABLE public.event_attendance_log ALTER COLUMN return_bus_run_code DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.event_bus_manifest SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.event_bus_manifest ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_bus_manifest', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_bus_manifest ALTER COLUMN event_day_session_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_bus_manifest', 'event_day_session_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_bus_manifest ALTER COLUMN transport_trip_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_bus_manifest', 'transport_trip_id', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_bus_manifest ALTER COLUMN participant_id DROP NOT NULL;
ALTER TABLE public.event_bus_manifest ALTER COLUMN carer_id DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.event_bus_manifest SET expected_on_bus = true WHERE expected_on_bus IS NULL;
  BEGIN
    ALTER TABLE public.event_bus_manifest ALTER COLUMN expected_on_bus SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_bus_manifest', 'expected_on_bus', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.event_bus_manifest SET status = 'expected' WHERE status IS NULL;
  BEGIN
    ALTER TABLE public.event_bus_manifest ALTER COLUMN status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_bus_manifest', 'status', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_bus_manifest ALTER COLUMN checked_on_at DROP NOT NULL;
ALTER TABLE public.event_bus_manifest ALTER COLUMN checked_on_by DROP NOT NULL;
ALTER TABLE public.event_bus_manifest ALTER COLUMN notes DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.event_bus_manifest SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.event_bus_manifest ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_bus_manifest', 'created_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.event_bus_manifest SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.event_bus_manifest ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_bus_manifest', 'updated_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.event_curfew_log SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.event_curfew_log ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_curfew_log', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_curfew_log ALTER COLUMN event_day_session_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_curfew_log', 'event_day_session_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_curfew_log ALTER COLUMN participant_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_curfew_log', 'participant_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_curfew_log ALTER COLUMN expected_accounted_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_curfew_log', 'expected_accounted_at', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_curfew_log ALTER COLUMN accounted_at DROP NOT NULL;
ALTER TABLE public.event_curfew_log ALTER COLUMN accounted_by DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.event_curfew_log SET status = 'expected' WHERE status IS NULL;
  BEGIN
    ALTER TABLE public.event_curfew_log ALTER COLUMN status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_curfew_log', 'status', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_curfew_log ALTER COLUMN escalation_issue_id DROP NOT NULL;
ALTER TABLE public.event_curfew_log ALTER COLUMN escalation_severity DROP NOT NULL;
ALTER TABLE public.event_curfew_log ALTER COLUMN escalation_raised_at DROP NOT NULL;
ALTER TABLE public.event_curfew_log ALTER COLUMN red_sms_dispatched_at DROP NOT NULL;
ALTER TABLE public.event_curfew_log ALTER COLUMN notes DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.event_curfew_log SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.event_curfew_log ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_curfew_log', 'created_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.event_curfew_log SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.event_curfew_log ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_curfew_log', 'updated_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.event_day_med_alternate_plans SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.event_day_med_alternate_plans ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_day_med_alternate_plans', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_day_med_alternate_plans ALTER COLUMN event_day_session_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_day_med_alternate_plans', 'event_day_session_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_day_med_alternate_plans ALTER COLUMN participant_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_day_med_alternate_plans', 'participant_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_day_med_alternate_plans ALTER COLUMN plan_note SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_day_med_alternate_plans', 'plan_note', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_day_med_alternate_plans ALTER COLUMN attested_by_staff_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_day_med_alternate_plans', 'attested_by_staff_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.event_day_med_alternate_plans SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.event_day_med_alternate_plans ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_day_med_alternate_plans', 'created_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.event_day_sessions SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.event_day_sessions ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_day_sessions', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_day_sessions ALTER COLUMN event_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_day_sessions', 'event_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_day_sessions ALTER COLUMN session_date SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_day_sessions', 'session_date', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.event_day_sessions SET phase = 'planning' WHERE phase IS NULL;
  BEGIN
    ALTER TABLE public.event_day_sessions ALTER COLUMN phase SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_day_sessions', 'phase', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_day_sessions ALTER COLUMN manager_staff_id DROP NOT NULL;
ALTER TABLE public.event_day_sessions ALTER COLUMN curfew_time DROP NOT NULL;
ALTER TABLE public.event_day_sessions ALTER COLUMN morning_roll_time DROP NOT NULL;
ALTER TABLE public.event_day_sessions ALTER COLUMN opened_by_id DROP NOT NULL;
ALTER TABLE public.event_day_sessions ALTER COLUMN open_declared_at DROP NOT NULL;
ALTER TABLE public.event_day_sessions ALTER COLUMN open_leader_notes DROP NOT NULL;
ALTER TABLE public.event_day_sessions ALTER COLUMN closed_by_id DROP NOT NULL;
ALTER TABLE public.event_day_sessions ALTER COLUMN close_declared_at DROP NOT NULL;
ALTER TABLE public.event_day_sessions ALTER COLUMN close_leader_notes DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.event_day_sessions SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.event_day_sessions ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_day_sessions', 'created_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.event_day_sessions SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.event_day_sessions ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_day_sessions', 'updated_at', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_day_sessions ALTER COLUMN expected_arrival_by DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.event_day_sessions SET programme_suspended = false WHERE programme_suspended IS NULL;
  BEGIN
    ALTER TABLE public.event_day_sessions ALTER COLUMN programme_suspended SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_day_sessions', 'programme_suspended', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_day_sessions ALTER COLUMN programme_suspend_reason DROP NOT NULL;
ALTER TABLE public.event_day_sessions ALTER COLUMN programme_suspend_severity DROP NOT NULL;
ALTER TABLE public.event_day_sessions ALTER COLUMN programme_suspend_hub_issue_id DROP NOT NULL;
ALTER TABLE public.event_day_sessions ALTER COLUMN programme_suspended_at DROP NOT NULL;
ALTER TABLE public.event_day_sessions ALTER COLUMN programme_suspended_by_staff_id DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.event_financial_ledger SET id = uuid_generate_v4() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.event_financial_ledger ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_financial_ledger', 'id', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_financial_ledger ALTER COLUMN event_id DROP NOT NULL;
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_financial_ledger ALTER COLUMN transaction_date SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_financial_ledger', 'transaction_date', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_financial_ledger ALTER COLUMN financial_code SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_financial_ledger', 'financial_code', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_financial_ledger ALTER COLUMN description SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_financial_ledger', 'description', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_financial_ledger ALTER COLUMN amount SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_financial_ledger', 'amount', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_financial_ledger ALTER COLUMN created_at DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.event_manifest SET id = uuid_generate_v4() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.event_manifest ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_manifest', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_manifest ALTER COLUMN title SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_manifest', 'title', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_manifest ALTER COLUMN event_type SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_manifest', 'event_type', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_manifest ALTER COLUMN venue_name SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_manifest', 'venue_name', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_manifest ALTER COLUMN start_date SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_manifest', 'start_date', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_manifest ALTER COLUMN end_date SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_manifest', 'end_date', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.event_manifest SET ticket_price = 0.00 WHERE ticket_price IS NULL;
  BEGIN
    ALTER TABLE public.event_manifest ALTER COLUMN ticket_price SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_manifest', 'ticket_price', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_manifest ALTER COLUMN created_at DROP NOT NULL;
ALTER TABLE public.event_manifest ALTER COLUMN description DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.event_manifest SET status = 'Open' WHERE status IS NULL;
  BEGIN
    ALTER TABLE public.event_manifest ALTER COLUMN status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_manifest', 'status', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_manifest ALTER COLUMN closed_at DROP NOT NULL;
ALTER TABLE public.event_manifest ALTER COLUMN closed_by_id DROP NOT NULL;
ALTER TABLE public.event_manifest ALTER COLUMN billing_locked DROP NOT NULL;
ALTER TABLE public.event_manifest ALTER COLUMN reconciliation_notes DROP NOT NULL;
ALTER TABLE public.event_manifest ALTER COLUMN default_charge_code_id DROP NOT NULL;
ALTER TABLE public.event_manifest ALTER COLUMN standard_price DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.event_manifest SET event_kind = 'legacy' WHERE event_kind IS NULL;
  BEGIN
    ALTER TABLE public.event_manifest ALTER COLUMN event_kind SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_manifest', 'event_kind', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_manifest ALTER COLUMN primary_venue_id DROP NOT NULL;
ALTER TABLE public.event_manifest ALTER COLUMN base_hotel_venue_id DROP NOT NULL;
ALTER TABLE public.event_manifest ALTER COLUMN curfew_time DROP NOT NULL;
ALTER TABLE public.event_manifest ALTER COLUMN morning_roll_time DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.event_meal_service_rolls SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.event_meal_service_rolls ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_meal_service_rolls', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_meal_service_rolls ALTER COLUMN venue_stop_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_meal_service_rolls', 'venue_stop_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_meal_service_rolls ALTER COLUMN participant_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_meal_service_rolls', 'participant_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.event_meal_service_rolls SET status = 'expected' WHERE status IS NULL;
  BEGIN
    ALTER TABLE public.event_meal_service_rolls ALTER COLUMN status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_meal_service_rolls', 'status', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_meal_service_rolls ALTER COLUMN notes DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.event_meal_service_rolls SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.event_meal_service_rolls ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_meal_service_rolls', 'updated_at', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_meal_service_rolls ALTER COLUMN updated_by_id DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.event_morning_log SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.event_morning_log ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_morning_log', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_morning_log ALTER COLUMN event_day_session_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_morning_log', 'event_day_session_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_morning_log ALTER COLUMN participant_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_morning_log', 'participant_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_morning_log ALTER COLUMN expected_accounted_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_morning_log', 'expected_accounted_at', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_morning_log ALTER COLUMN accounted_at DROP NOT NULL;
ALTER TABLE public.event_morning_log ALTER COLUMN accounted_by DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.event_morning_log SET status = 'expected' WHERE status IS NULL;
  BEGIN
    ALTER TABLE public.event_morning_log ALTER COLUMN status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_morning_log', 'status', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_morning_log ALTER COLUMN escalation_issue_id DROP NOT NULL;
ALTER TABLE public.event_morning_log ALTER COLUMN escalation_severity DROP NOT NULL;
ALTER TABLE public.event_morning_log ALTER COLUMN escalation_raised_at DROP NOT NULL;
ALTER TABLE public.event_morning_log ALTER COLUMN red_sms_dispatched_at DROP NOT NULL;
ALTER TABLE public.event_morning_log ALTER COLUMN notes DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.event_morning_log SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.event_morning_log ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_morning_log', 'created_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.event_morning_log SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.event_morning_log ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_morning_log', 'updated_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.event_roster_bookings SET id = uuid_generate_v4() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.event_roster_bookings ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_roster_bookings', 'id', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_roster_bookings ALTER COLUMN event_id DROP NOT NULL;
ALTER TABLE public.event_roster_bookings ALTER COLUMN participant_id DROP NOT NULL;
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_roster_bookings ALTER COLUMN booking_status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_roster_bookings', 'booking_status', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.event_roster_bookings SET amount_paid = 0.00 WHERE amount_paid IS NULL;
  BEGIN
    ALTER TABLE public.event_roster_bookings ALTER COLUMN amount_paid SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_roster_bookings', 'amount_paid', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_roster_bookings ALTER COLUMN is_fully_paid DROP NOT NULL;
ALTER TABLE public.event_roster_bookings ALTER COLUMN created_at DROP NOT NULL;
ALTER TABLE public.event_roster_bookings ALTER COLUMN notes DROP NOT NULL;
ALTER TABLE public.event_roster_bookings ALTER COLUMN custom_price DROP NOT NULL;
ALTER TABLE public.event_roster_bookings ALTER COLUMN brings_carer DROP NOT NULL;
ALTER TABLE public.event_roster_bookings ALTER COLUMN carer_transport_required DROP NOT NULL;
ALTER TABLE public.event_roster_bookings ALTER COLUMN companion_carer_id DROP NOT NULL;
ALTER TABLE public.event_roster_bookings ALTER COLUMN carer_id DROP NOT NULL;
ALTER TABLE public.event_roster_bookings ALTER COLUMN participant_transport_required DROP NOT NULL;
ALTER TABLE public.event_roster_bookings ALTER COLUMN finance_verified_at DROP NOT NULL;
ALTER TABLE public.event_roster_bookings ALTER COLUMN funding_claim_type DROP NOT NULL;
ALTER TABLE public.event_roster_bookings ALTER COLUMN charge_code_id DROP NOT NULL;
ALTER TABLE public.event_roster_bookings ALTER COLUMN quantity_delivered DROP NOT NULL;
ALTER TABLE public.event_roster_bookings ALTER COLUMN rate_per_unit_applied DROP NOT NULL;
ALTER TABLE public.event_roster_bookings ALTER COLUMN total_amount_billed DROP NOT NULL;
ALTER TABLE public.event_roster_bookings ALTER COLUMN billing_status DROP NOT NULL;
ALTER TABLE public.event_roster_bookings ALTER COLUMN trip_pickup_address_override DROP NOT NULL;
ALTER TABLE public.event_roster_bookings ALTER COLUMN dynamic_medical_notes_snapshot DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.event_roster_bookings SET outbound_transport_mode = 'bus' WHERE outbound_transport_mode IS NULL;
  BEGIN
    ALTER TABLE public.event_roster_bookings ALTER COLUMN outbound_transport_mode SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_roster_bookings', 'outbound_transport_mode', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.event_roster_bookings SET return_transport_mode = 'bus' WHERE return_transport_mode IS NULL;
  BEGIN
    ALTER TABLE public.event_roster_bookings ALTER COLUMN return_transport_mode SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_roster_bookings', 'return_transport_mode', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.event_roster_bookings SET transport_med_bag_required = 'not_set' WHERE transport_med_bag_required IS NULL;
  BEGIN
    ALTER TABLE public.event_roster_bookings ALTER COLUMN transport_med_bag_required SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_roster_bookings', 'transport_med_bag_required', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_roster_bookings ALTER COLUMN transport_med_notes DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.event_roster_bookings SET pickup_order = 0 WHERE pickup_order IS NULL;
  BEGIN
    ALTER TABLE public.event_roster_bookings ALTER COLUMN pickup_order SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_roster_bookings', 'pickup_order', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_roster_bookings ALTER COLUMN outbound_bus_run_code DROP NOT NULL;
ALTER TABLE public.event_roster_bookings ALTER COLUMN return_bus_run_code DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.event_roster_bookings SET is_guest_booking = false WHERE is_guest_booking IS NULL;
  BEGIN
    ALTER TABLE public.event_roster_bookings ALTER COLUMN is_guest_booking SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_roster_bookings', 'is_guest_booking', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_roster_bookings ALTER COLUMN host_participant_id DROP NOT NULL;
ALTER TABLE public.event_roster_bookings ALTER COLUMN guest_ops_note DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.event_venue_reconfirmations SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.event_venue_reconfirmations ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_venue_reconfirmations', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_venue_reconfirmations ALTER COLUMN event_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_venue_reconfirmations', 'event_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_venue_reconfirmations ALTER COLUMN venue_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_venue_reconfirmations', 'venue_id', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_venue_reconfirmations ALTER COLUMN reconfirmed_by_staff_id DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.event_venue_reconfirmations SET reconfirmed_at = now() WHERE reconfirmed_at IS NULL;
  BEGIN
    ALTER TABLE public.event_venue_reconfirmations ALTER COLUMN reconfirmed_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_venue_reconfirmations', 'reconfirmed_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.event_venue_reconfirmations SET still_valid = true WHERE still_valid IS NULL;
  BEGIN
    ALTER TABLE public.event_venue_reconfirmations ALTER COLUMN still_valid SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_venue_reconfirmations', 'still_valid', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_venue_reconfirmations ALTER COLUMN notes DROP NOT NULL;
ALTER TABLE public.event_venue_reconfirmations ALTER COLUMN evidence_ref DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.event_venue_reconfirmations SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.event_venue_reconfirmations ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_venue_reconfirmations', 'created_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.event_venue_stops SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.event_venue_stops ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_venue_stops', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_venue_stops ALTER COLUMN event_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_venue_stops', 'event_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_venue_stops ALTER COLUMN session_date SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_venue_stops', 'session_date', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_venue_stops ALTER COLUMN venue_id DROP NOT NULL;
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.event_venue_stops ALTER COLUMN stop_order SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_venue_stops', 'stop_order', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_venue_stops ALTER COLUMN label_override DROP NOT NULL;
ALTER TABLE public.event_venue_stops ALTER COLUMN notes DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.event_venue_stops SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.event_venue_stops ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_venue_stops', 'created_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.event_venue_stops SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.event_venue_stops ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_venue_stops', 'updated_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.event_venue_stops SET phase = 'pending' WHERE phase IS NULL;
  BEGIN
    ALTER TABLE public.event_venue_stops ALTER COLUMN phase SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_venue_stops', 'phase', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.event_venue_stops SET movement_method = 'bus' WHERE movement_method IS NULL;
  BEGIN
    ALTER TABLE public.event_venue_stops ALTER COLUMN movement_method SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_venue_stops', 'movement_method', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_venue_stops ALTER COLUMN opened_at DROP NOT NULL;
ALTER TABLE public.event_venue_stops ALTER COLUMN closed_at DROP NOT NULL;
ALTER TABLE public.event_venue_stops ALTER COLUMN opened_by_id DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.event_venue_stops SET activity_kind = 'venue' WHERE activity_kind IS NULL;
  BEGIN
    ALTER TABLE public.event_venue_stops ALTER COLUMN activity_kind SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'event_venue_stops', 'activity_kind', SQLERRM;
  END;
END $$;

ALTER TABLE public.event_venue_stops ALTER COLUMN meal_slot DROP NOT NULL;
ALTER TABLE public.event_venue_stops ALTER COLUMN meal_source DROP NOT NULL;
ALTER TABLE public.event_venue_stops ALTER COLUMN menu_notes DROP NOT NULL;
ALTER TABLE public.event_venue_stops ALTER COLUMN prepared_by_staff_id DROP NOT NULL;
ALTER TABLE public.event_venue_stops ALTER COLUMN preparer_cert_status DROP NOT NULL;
ALTER TABLE public.event_venue_stops ALTER COLUMN preparer_ack_note DROP NOT NULL;
ALTER TABLE public.event_venue_stops ALTER COLUMN prep_checks_completed DROP NOT NULL;
ALTER TABLE public.event_venue_stops ALTER COLUMN prep_attestation_mode DROP NOT NULL;
ALTER TABLE public.event_venue_stops ALTER COLUMN prep_attested_by_staff_id DROP NOT NULL;
ALTER TABLE public.event_venue_stops ALTER COLUMN guest_preparer_name DROP NOT NULL;
ALTER TABLE public.event_venue_stops ALTER COLUMN prep_attestation_note DROP NOT NULL;
ALTER TABLE public.event_venue_stops ALTER COLUMN sfh_approved_by_staff_id DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.hub_issue_notes SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.hub_issue_notes ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'hub_issue_notes', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.hub_issue_notes ALTER COLUMN source SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'hub_issue_notes', 'source', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.hub_issue_notes ALTER COLUMN source_row_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'hub_issue_notes', 'source_row_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.hub_issue_notes ALTER COLUMN note SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'hub_issue_notes', 'note', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.hub_issue_notes SET kind = 'append' WHERE kind IS NULL;
  BEGIN
    ALTER TABLE public.hub_issue_notes ALTER COLUMN kind SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'hub_issue_notes', 'kind', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.hub_issue_notes SET stamped_at = now() WHERE stamped_at IS NULL;
  BEGIN
    ALTER TABLE public.hub_issue_notes ALTER COLUMN stamped_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'hub_issue_notes', 'stamped_at', SQLERRM;
  END;
END $$;

ALTER TABLE public.hub_issue_notes ALTER COLUMN staff_id DROP NOT NULL;
ALTER TABLE public.hub_issue_notes ALTER COLUMN metadata DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.maintenance_items SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.maintenance_items ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'maintenance_items', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.maintenance_items ALTER COLUMN title SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'maintenance_items', 'title', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.maintenance_items ALTER COLUMN description SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'maintenance_items', 'description', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.maintenance_items SET severity = 'yellow' WHERE severity IS NULL;
  BEGIN
    ALTER TABLE public.maintenance_items ALTER COLUMN severity SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'maintenance_items', 'severity', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.maintenance_items SET status = 'open' WHERE status IS NULL;
  BEGIN
    ALTER TABLE public.maintenance_items ALTER COLUMN status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'maintenance_items', 'status', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.maintenance_items SET source = 'manual' WHERE source IS NULL;
  BEGIN
    ALTER TABLE public.maintenance_items ALTER COLUMN source SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'maintenance_items', 'source', SQLERRM;
  END;
END $$;

ALTER TABLE public.maintenance_items ALTER COLUMN source_ref_id DROP NOT NULL;
ALTER TABLE public.maintenance_items ALTER COLUMN venue_id DROP NOT NULL;
ALTER TABLE public.maintenance_items ALTER COLUMN event_id DROP NOT NULL;
ALTER TABLE public.maintenance_items ALTER COLUMN location_label DROP NOT NULL;
ALTER TABLE public.maintenance_items ALTER COLUMN reported_by DROP NOT NULL;
ALTER TABLE public.maintenance_items ALTER COLUMN assigned_to DROP NOT NULL;
ALTER TABLE public.maintenance_items ALTER COLUMN resolution_notes DROP NOT NULL;
ALTER TABLE public.maintenance_items ALTER COLUMN resolved_at DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.maintenance_items SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.maintenance_items ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'maintenance_items', 'created_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.maintenance_items SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.maintenance_items ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'maintenance_items', 'updated_at', SQLERRM;
  END;
END $$;

ALTER TABLE public.maintenance_items ALTER COLUMN deferred_until DROP NOT NULL;
ALTER TABLE public.maintenance_items ALTER COLUMN deferred_reason DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.maintenance_items SET defer_count = 0 WHERE defer_count IS NULL;
  BEGIN
    ALTER TABLE public.maintenance_items ALTER COLUMN defer_count SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'maintenance_items', 'defer_count', SQLERRM;
  END;
END $$;

ALTER TABLE public.maintenance_items ALTER COLUMN last_note_at DROP NOT NULL;
ALTER TABLE public.maintenance_items ALTER COLUMN occurred_at DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.maintenance_notes SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.maintenance_notes ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'maintenance_notes', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.maintenance_notes ALTER COLUMN item_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'maintenance_notes', 'item_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.maintenance_notes ALTER COLUMN note_text SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'maintenance_notes', 'note_text', SQLERRM;
  END;
END $$;

ALTER TABLE public.maintenance_notes ALTER COLUMN author DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.maintenance_notes SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.maintenance_notes ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'maintenance_notes', 'created_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.medication_administration_log SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.medication_administration_log ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'medication_administration_log', 'id', SQLERRM;
  END;
END $$;

ALTER TABLE public.medication_administration_log ALTER COLUMN schedule_id DROP NOT NULL;
ALTER TABLE public.medication_administration_log ALTER COLUMN participant_id DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.medication_administration_log SET administered_at = timezone('utc'::text, now()) WHERE administered_at IS NULL;
  BEGIN
    ALTER TABLE public.medication_administration_log ALTER COLUMN administered_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'medication_administration_log', 'administered_at', SQLERRM;
  END;
END $$;

ALTER TABLE public.medication_administration_log ALTER COLUMN administered_by_id DROP NOT NULL;
ALTER TABLE public.medication_administration_log ALTER COLUMN witnessed_by_id DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.medication_administration_log SET status = 'Administered' WHERE status IS NULL;
  BEGIN
    ALTER TABLE public.medication_administration_log ALTER COLUMN status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'medication_administration_log', 'status', SQLERRM;
  END;
END $$;

ALTER TABLE public.medication_administration_log ALTER COLUMN notes DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.medication_administration_log SET created_at = timezone('utc'::text, now()) WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.medication_administration_log ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'medication_administration_log', 'created_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.myob_export_batches SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.myob_export_batches ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'myob_export_batches', 'id', SQLERRM;
  END;
END $$;

ALTER TABLE public.myob_export_batches ALTER COLUMN exported_at DROP NOT NULL;
ALTER TABLE public.myob_export_batches ALTER COLUMN exported_by DROP NOT NULL;
ALTER TABLE public.myob_export_batches ALTER COLUMN range_start DROP NOT NULL;
ALTER TABLE public.myob_export_batches ALTER COLUMN range_end DROP NOT NULL;
ALTER TABLE public.myob_export_batches ALTER COLUMN row_count DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.offline_sync_logs SET id = uuid_generate_v4() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.offline_sync_logs ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'offline_sync_logs', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.offline_sync_logs ALTER COLUMN driver_or_staff_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'offline_sync_logs', 'driver_or_staff_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.offline_sync_logs ALTER COLUMN device_uuid SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'offline_sync_logs', 'device_uuid', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.offline_sync_logs ALTER COLUMN action_type SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'offline_sync_logs', 'action_type', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.offline_sync_logs ALTER COLUMN payload SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'offline_sync_logs', 'payload', SQLERRM;
  END;
END $$;

ALTER TABLE public.offline_sync_logs ALTER COLUMN synced_at DROP NOT NULL;
ALTER TABLE public.offline_sync_logs ALTER COLUMN created_at DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.operational_emergencies SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.operational_emergencies ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_emergencies', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.operational_emergencies ALTER COLUMN mode SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_emergencies', 'mode', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.operational_emergencies ALTER COLUMN severity SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_emergencies', 'severity', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.operational_emergencies ALTER COLUMN situation_text SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_emergencies', 'situation_text', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.operational_emergencies SET status = 'active' WHERE status IS NULL;
  BEGIN
    ALTER TABLE public.operational_emergencies ALTER COLUMN status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_emergencies', 'status', SQLERRM;
  END;
END $$;

ALTER TABLE public.operational_emergencies ALTER COLUMN site_day_session_id DROP NOT NULL;
ALTER TABLE public.operational_emergencies ALTER COLUMN event_id DROP NOT NULL;
ALTER TABLE public.operational_emergencies ALTER COLUMN event_day_session_id DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.operational_emergencies SET surface = 'centre' WHERE surface IS NULL;
  BEGIN
    ALTER TABLE public.operational_emergencies ALTER COLUMN surface SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_emergencies', 'surface', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.operational_emergencies ALTER COLUMN activated_by_staff_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_emergencies', 'activated_by_staff_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.operational_emergencies SET activated_at = now() WHERE activated_at IS NULL;
  BEGIN
    ALTER TABLE public.operational_emergencies ALTER COLUMN activated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_emergencies', 'activated_at', SQLERRM;
  END;
END $$;

ALTER TABLE public.operational_emergencies ALTER COLUMN stood_down_by_staff_id DROP NOT NULL;
ALTER TABLE public.operational_emergencies ALTER COLUMN stood_down_at DROP NOT NULL;
ALTER TABLE public.operational_emergencies ALTER COLUMN debrief_text DROP NOT NULL;
ALTER TABLE public.operational_emergencies ALTER COLUMN hub_issue_id DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.operational_emergencies SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.operational_emergencies ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_emergencies', 'created_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.operational_emergencies SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.operational_emergencies ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_emergencies', 'updated_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.operational_emergency_muster SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.operational_emergency_muster ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_emergency_muster', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.operational_emergency_muster ALTER COLUMN emergency_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_emergency_muster', 'emergency_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.operational_emergency_muster ALTER COLUMN participant_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_emergency_muster', 'participant_id', SQLERRM;
  END;
END $$;

ALTER TABLE public.operational_emergency_muster ALTER COLUMN participant_name DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.operational_emergency_muster SET state = 'expected' WHERE state IS NULL;
  BEGIN
    ALTER TABLE public.operational_emergency_muster ALTER COLUMN state SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_emergency_muster', 'state', SQLERRM;
  END;
END $$;

ALTER TABLE public.operational_emergency_muster ALTER COLUMN updated_by_staff_id DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.operational_emergency_muster SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.operational_emergency_muster ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_emergency_muster', 'updated_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.operational_emergency_muster SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.operational_emergency_muster ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_emergency_muster', 'created_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.operational_escalations SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.operational_escalations ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_escalations', 'id', SQLERRM;
  END;
END $$;

ALTER TABLE public.operational_escalations ALTER COLUMN clearance_id DROP NOT NULL;
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.operational_escalations ALTER COLUMN driver_name SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_escalations', 'driver_name', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.operational_escalations ALTER COLUMN vehicle_info SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_escalations', 'vehicle_info', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.operational_escalations ALTER COLUMN gate_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_escalations', 'gate_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.operational_escalations SET status = 'pending' WHERE status IS NULL;
  BEGIN
    ALTER TABLE public.operational_escalations ALTER COLUMN status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_escalations', 'status', SQLERRM;
  END;
END $$;

ALTER TABLE public.operational_escalations ALTER COLUMN claimed_by DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.operational_escalations SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.operational_escalations ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_escalations', 'created_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.operational_escalations SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.operational_escalations ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_escalations', 'updated_at', SQLERRM;
  END;
END $$;

ALTER TABLE public.operational_escalations ALTER COLUMN resolution_notes DROP NOT NULL;
ALTER TABLE public.operational_escalations ALTER COLUMN resolved_by DROP NOT NULL;
ALTER TABLE public.operational_escalations ALTER COLUMN resolved_at DROP NOT NULL;
ALTER TABLE public.operational_escalations ALTER COLUMN source_kind DROP NOT NULL;
ALTER TABLE public.operational_escalations ALTER COLUMN source_issue_id DROP NOT NULL;
ALTER TABLE public.operational_escalations ALTER COLUMN claimed_at DROP NOT NULL;
ALTER TABLE public.operational_escalations ALTER COLUMN raised_by DROP NOT NULL;
ALTER TABLE public.operational_escalations ALTER COLUMN operator_acknowledged_at DROP NOT NULL;
ALTER TABLE public.operational_escalations ALTER COLUMN operator_acknowledged_by DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.operational_incidents SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.operational_incidents ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_incidents', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.operational_incidents ALTER COLUMN incident_type SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_incidents', 'incident_type', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.operational_incidents ALTER COLUMN severity SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_incidents', 'severity', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.operational_incidents ALTER COLUMN description SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_incidents', 'description', SQLERRM;
  END;
END $$;

ALTER TABLE public.operational_incidents ALTER COLUMN vehicle_id DROP NOT NULL;
ALTER TABLE public.operational_incidents ALTER COLUMN event_id DROP NOT NULL;
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.operational_incidents ALTER COLUMN reported_by SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_incidents', 'reported_by', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.operational_incidents SET status = 'pending' WHERE status IS NULL;
  BEGIN
    ALTER TABLE public.operational_incidents ALTER COLUMN status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_incidents', 'status', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.operational_incidents SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.operational_incidents ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_incidents', 'created_at', SQLERRM;
  END;
END $$;

ALTER TABLE public.operational_incidents ALTER COLUMN occurred_at DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.operational_incidents SET affected_participant_ids = '{}'::uuid[] WHERE affected_participant_ids IS NULL;
  BEGIN
    ALTER TABLE public.operational_incidents ALTER COLUMN affected_participant_ids SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_incidents', 'affected_participant_ids', SQLERRM;
  END;
END $$;

ALTER TABLE public.operational_incidents ALTER COLUMN assisting_staff_id DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.operational_incidents SET no_participant_involved = false WHERE no_participant_involved IS NULL;
  BEGIN
    ALTER TABLE public.operational_incidents ALTER COLUMN no_participant_involved SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_incidents', 'no_participant_involved', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.operational_incidents SET assisting_staff_ids = '{}'::uuid[] WHERE assisting_staff_ids IS NULL;
  BEGIN
    ALTER TABLE public.operational_incidents ALTER COLUMN assisting_staff_ids SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_incidents', 'assisting_staff_ids', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.operational_ledger SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.operational_ledger ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_ledger', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.operational_ledger SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.operational_ledger ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_ledger', 'created_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.operational_ledger ALTER COLUMN staff_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_ledger', 'staff_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.operational_ledger ALTER COLUMN category SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_ledger', 'category', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.operational_ledger ALTER COLUMN severity SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_ledger', 'severity', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.operational_ledger ALTER COLUMN action_type SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'operational_ledger', 'action_type', SQLERRM;
  END;
END $$;

ALTER TABLE public.operational_ledger ALTER COLUMN gps_lat DROP NOT NULL;
ALTER TABLE public.operational_ledger ALTER COLUMN gps_lng DROP NOT NULL;
ALTER TABLE public.operational_ledger ALTER COLUMN metadata DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.participant_attendance_schedules SET id = uuid_generate_v4() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.participant_attendance_schedules ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_attendance_schedules', 'id', SQLERRM;
  END;
END $$;

ALTER TABLE public.participant_attendance_schedules ALTER COLUMN participant_id DROP NOT NULL;
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.participant_attendance_schedules ALTER COLUMN day_of_week SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_attendance_schedules', 'day_of_week', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.participant_attendance_schedules ALTER COLUMN service_type SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_attendance_schedules', 'service_type', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.participant_attendance_schedules ALTER COLUMN transport_required SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_attendance_schedules', 'transport_required', SQLERRM;
  END;
END $$;

ALTER TABLE public.participant_attendance_schedules ALTER COLUMN active DROP NOT NULL;
ALTER TABLE public.participant_attendance_schedules ALTER COLUMN created_at DROP NOT NULL;
ALTER TABLE public.participant_attendance_schedules ALTER COLUMN archived_at DROP NOT NULL;
ALTER TABLE public.participant_attendance_schedules ALTER COLUMN archived_by_id DROP NOT NULL;
ALTER TABLE public.participant_attendance_schedules ALTER COLUMN archive_witnessed_by_id DROP NOT NULL;
ALTER TABLE public.participant_attendance_schedules ALTER COLUMN archive_reason DROP NOT NULL;
ALTER TABLE public.participant_attendance_schedules ALTER COLUMN archive_reference_type DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.participant_attendance_schedules SET expected_arrival_time = '09:00:00'::time without time zone WHERE expected_arrival_time IS NULL;
  BEGIN
    ALTER TABLE public.participant_attendance_schedules ALTER COLUMN expected_arrival_time SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_attendance_schedules', 'expected_arrival_time', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.participant_attendance_schedules SET expected_departure_time = '15:00:00'::time without time zone WHERE expected_departure_time IS NULL;
  BEGIN
    ALTER TABLE public.participant_attendance_schedules ALTER COLUMN expected_departure_time SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_attendance_schedules', 'expected_departure_time', SQLERRM;
  END;
END $$;

ALTER TABLE public.participant_attendance_schedules ALTER COLUMN inbound_transport DROP NOT NULL;
ALTER TABLE public.participant_attendance_schedules ALTER COLUMN outbound_transport DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.participant_compliance_and_alerts SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.participant_compliance_and_alerts ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_compliance_and_alerts', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.participant_compliance_and_alerts ALTER COLUMN participant_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_compliance_and_alerts', 'participant_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.participant_compliance_and_alerts ALTER COLUMN record_type SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_compliance_and_alerts', 'record_type', SQLERRM;
  END;
END $$;

ALTER TABLE public.participant_compliance_and_alerts ALTER COLUMN reference_data DROP NOT NULL;
ALTER TABLE public.participant_compliance_and_alerts ALTER COLUMN expiry_date DROP NOT NULL;
ALTER TABLE public.participant_compliance_and_alerts ALTER COLUMN notes DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.participant_compliance_and_alerts SET created_at = timezone('utc'::text, now()) WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.participant_compliance_and_alerts ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_compliance_and_alerts', 'created_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.participant_compliance_and_alerts SET updated_at = timezone('utc'::text, now()) WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.participant_compliance_and_alerts ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_compliance_and_alerts', 'updated_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.participant_financial_ledger SET id = uuid_generate_v4() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.participant_financial_ledger ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_financial_ledger', 'id', SQLERRM;
  END;
END $$;

ALTER TABLE public.participant_financial_ledger ALTER COLUMN participant_id DROP NOT NULL;
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.participant_financial_ledger ALTER COLUMN transaction_date SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_financial_ledger', 'transaction_date', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.participant_financial_ledger ALTER COLUMN financial_code SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_financial_ledger', 'financial_code', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.participant_financial_ledger ALTER COLUMN description SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_financial_ledger', 'description', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.participant_financial_ledger ALTER COLUMN amount SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_financial_ledger', 'amount', SQLERRM;
  END;
END $$;

ALTER TABLE public.participant_financial_ledger ALTER COLUMN is_reconciled DROP NOT NULL;
ALTER TABLE public.participant_financial_ledger ALTER COLUMN created_at DROP NOT NULL;
ALTER TABLE public.participant_financial_ledger ALTER COLUMN event_id DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.participant_infectious_exclusions SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_infectious_exclusions', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN participant_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_infectious_exclusions', 'participant_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN category SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_infectious_exclusions', 'category', SQLERRM;
  END;
END $$;

ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN notes DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.participant_infectious_exclusions SET exclude_centre = true WHERE exclude_centre IS NULL;
  BEGIN
    ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN exclude_centre SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_infectious_exclusions', 'exclude_centre', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.participant_infectious_exclusions SET exclude_trips = true WHERE exclude_trips IS NULL;
  BEGIN
    ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN exclude_trips SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_infectious_exclusions', 'exclude_trips', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.participant_infectious_exclusions SET excluded_from = (timezone('Australia/Sydney'::text, now()))::date WHERE excluded_from IS NULL;
  BEGIN
    ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN excluded_from SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_infectious_exclusions', 'excluded_from', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.participant_infectious_exclusions SET status = 'active' WHERE status IS NULL;
  BEGIN
    ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_infectious_exclusions', 'status', SQLERRM;
  END;
END $$;

ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN hub_issue_id DROP NOT NULL;
ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN site_day_session_id DROP NOT NULL;
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN declared_by_staff_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_infectious_exclusions', 'declared_by_staff_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.participant_infectious_exclusions SET declared_at = now() WHERE declared_at IS NULL;
  BEGIN
    ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN declared_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_infectious_exclusions', 'declared_at', SQLERRM;
  END;
END $$;

ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN clearance_method DROP NOT NULL;
ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN clearance_note DROP NOT NULL;
ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN evidence_ref DROP NOT NULL;
ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN cleared_by_staff_id DROP NOT NULL;
ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN cleared_at DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.participant_infectious_exclusions SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_infectious_exclusions', 'created_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.participant_infectious_exclusions SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_infectious_exclusions', 'updated_at', SQLERRM;
  END;
END $$;

ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN event_id DROP NOT NULL;
ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN event_day_session_id DROP NOT NULL;
ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN home_safe_disposition DROP NOT NULL;
ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN home_safe_handover_to DROP NOT NULL;
ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN home_safe_note DROP NOT NULL;
ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN home_safe_at DROP NOT NULL;
ALTER TABLE public.participant_infectious_exclusions ALTER COLUMN home_safe_by_staff_id DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.participant_medication_schedules SET id = uuid_generate_v4() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.participant_medication_schedules ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_medication_schedules', 'id', SQLERRM;
  END;
END $$;

ALTER TABLE public.participant_medication_schedules ALTER COLUMN participant_id DROP NOT NULL;
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.participant_medication_schedules ALTER COLUMN medication_name SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_medication_schedules', 'medication_name', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.participant_medication_schedules ALTER COLUMN dosage SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_medication_schedules', 'dosage', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.participant_medication_schedules ALTER COLUMN expected_time SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_medication_schedules', 'expected_time', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.participant_medication_schedules SET frequency = 'Daily' WHERE frequency IS NULL;
  BEGIN
    ALTER TABLE public.participant_medication_schedules ALTER COLUMN frequency SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participant_medication_schedules', 'frequency', SQLERRM;
  END;
END $$;

ALTER TABLE public.participant_medication_schedules ALTER COLUMN active DROP NOT NULL;
ALTER TABLE public.participant_medication_schedules ALTER COLUMN created_at DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.participants SET id = uuid_generate_v4() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.participants ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participants', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.participants ALTER COLUMN first_name SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participants', 'first_name', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.participants ALTER COLUMN last_name SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participants', 'last_name', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.participants ALTER COLUMN ndis_number SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participants', 'ndis_number', SQLERRM;
  END;
END $$;

ALTER TABLE public.participants ALTER COLUMN iddsi_level_liquids DROP NOT NULL;
ALTER TABLE public.participants ALTER COLUMN iddsi_level_solids DROP NOT NULL;
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.participants ALTER COLUMN dual_witness_pin_hash SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participants', 'dual_witness_pin_hash', SQLERRM;
  END;
END $$;

ALTER TABLE public.participants ALTER COLUMN created_at DROP NOT NULL;
ALTER TABLE public.participants ALTER COLUMN updated_at DROP NOT NULL;
ALTER TABLE public.participants ALTER COLUMN street_address DROP NOT NULL;
ALTER TABLE public.participants ALTER COLUMN notes DROP NOT NULL;
ALTER TABLE public.participants ALTER COLUMN emergency_contact_name DROP NOT NULL;
ALTER TABLE public.participants ALTER COLUMN emergency_contact_phone DROP NOT NULL;
ALTER TABLE public.participants ALTER COLUMN emergency_contact_relationship DROP NOT NULL;
ALTER TABLE public.participants ALTER COLUMN regular_pickup_address DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.participants SET participant_kind = 'client' WHERE participant_kind IS NULL;
  BEGIN
    ALTER TABLE public.participants ALTER COLUMN participant_kind SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'participants', 'participant_kind', SQLERRM;
  END;
END $$;

ALTER TABLE public.participants ALTER COLUMN archived_at DROP NOT NULL;
ALTER TABLE public.participants ALTER COLUMN date_of_birth DROP NOT NULL;
ALTER TABLE public.participants ALTER COLUMN allergies_notes DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.site_day_activities SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.site_day_activities ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_day_activities', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.site_day_activities ALTER COLUMN session_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_day_activities', 'session_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.site_day_activities SET activity_kind = 'meal' WHERE activity_kind IS NULL;
  BEGIN
    ALTER TABLE public.site_day_activities ALTER COLUMN activity_kind SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_day_activities', 'activity_kind', SQLERRM;
  END;
END $$;

ALTER TABLE public.site_day_activities ALTER COLUMN meal_slot DROP NOT NULL;
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.site_day_activities ALTER COLUMN title SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_day_activities', 'title', SQLERRM;
  END;
END $$;

ALTER TABLE public.site_day_activities ALTER COLUMN meal_source DROP NOT NULL;
ALTER TABLE public.site_day_activities ALTER COLUMN menu_notes DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.site_day_activities SET phase = 'pending' WHERE phase IS NULL;
  BEGIN
    ALTER TABLE public.site_day_activities ALTER COLUMN phase SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_day_activities', 'phase', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.site_day_activities SET sort_order = 0 WHERE sort_order IS NULL;
  BEGIN
    ALTER TABLE public.site_day_activities ALTER COLUMN sort_order SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_day_activities', 'sort_order', SQLERRM;
  END;
END $$;

ALTER TABLE public.site_day_activities ALTER COLUMN opened_at DROP NOT NULL;
ALTER TABLE public.site_day_activities ALTER COLUMN opened_by_id DROP NOT NULL;
ALTER TABLE public.site_day_activities ALTER COLUMN closed_at DROP NOT NULL;
ALTER TABLE public.site_day_activities ALTER COLUMN closed_by_id DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.site_day_activities SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.site_day_activities ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_day_activities', 'created_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.site_day_activities SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.site_day_activities ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_day_activities', 'updated_at', SQLERRM;
  END;
END $$;

ALTER TABLE public.site_day_activities ALTER COLUMN prepared_by_staff_id DROP NOT NULL;
ALTER TABLE public.site_day_activities ALTER COLUMN preparer_cert_status DROP NOT NULL;
ALTER TABLE public.site_day_activities ALTER COLUMN preparer_ack_note DROP NOT NULL;
ALTER TABLE public.site_day_activities ALTER COLUMN prep_checks_completed DROP NOT NULL;
ALTER TABLE public.site_day_activities ALTER COLUMN prep_attestation_mode DROP NOT NULL;
ALTER TABLE public.site_day_activities ALTER COLUMN prep_attested_by_staff_id DROP NOT NULL;
ALTER TABLE public.site_day_activities ALTER COLUMN guest_preparer_name DROP NOT NULL;
ALTER TABLE public.site_day_activities ALTER COLUMN prep_attestation_note DROP NOT NULL;
ALTER TABLE public.site_day_activities ALTER COLUMN sfh_approved_by_staff_id DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.site_day_meal_service_rolls SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.site_day_meal_service_rolls ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_day_meal_service_rolls', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.site_day_meal_service_rolls ALTER COLUMN activity_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_day_meal_service_rolls', 'activity_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.site_day_meal_service_rolls ALTER COLUMN participant_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_day_meal_service_rolls', 'participant_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.site_day_meal_service_rolls SET status = 'expected' WHERE status IS NULL;
  BEGIN
    ALTER TABLE public.site_day_meal_service_rolls ALTER COLUMN status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_day_meal_service_rolls', 'status', SQLERRM;
  END;
END $$;

ALTER TABLE public.site_day_meal_service_rolls ALTER COLUMN notes DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.site_day_meal_service_rolls SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.site_day_meal_service_rolls ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_day_meal_service_rolls', 'updated_at', SQLERRM;
  END;
END $$;

ALTER TABLE public.site_day_meal_service_rolls ALTER COLUMN updated_by_id DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.site_day_sessions SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.site_day_sessions ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_day_sessions', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.site_day_sessions SET session_date = CURRENT_DATE WHERE session_date IS NULL;
  BEGIN
    ALTER TABLE public.site_day_sessions ALTER COLUMN session_date SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_day_sessions', 'session_date', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.site_day_sessions SET phase = 'open_pending'::site_session_status WHERE phase IS NULL;
  BEGIN
    ALTER TABLE public.site_day_sessions ALTER COLUMN phase SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_day_sessions', 'phase', SQLERRM;
  END;
END $$;

ALTER TABLE public.site_day_sessions ALTER COLUMN opened_by_id DROP NOT NULL;
ALTER TABLE public.site_day_sessions ALTER COLUMN open_declared_at DROP NOT NULL;
ALTER TABLE public.site_day_sessions ALTER COLUMN open_leader_notes DROP NOT NULL;
ALTER TABLE public.site_day_sessions ALTER COLUMN closed_by_id DROP NOT NULL;
ALTER TABLE public.site_day_sessions ALTER COLUMN close_declared_at DROP NOT NULL;
ALTER TABLE public.site_day_sessions ALTER COLUMN close_leader_notes DROP NOT NULL;
ALTER TABLE public.site_day_sessions ALTER COLUMN manager_plan_text DROP NOT NULL;
ALTER TABLE public.site_day_sessions ALTER COLUMN manager_decision DROP NOT NULL;
ALTER TABLE public.site_day_sessions ALTER COLUMN manager_auth_staff_id DROP NOT NULL;
ALTER TABLE public.site_day_sessions ALTER COLUMN manager_auth_at DROP NOT NULL;
ALTER TABLE public.site_day_sessions ALTER COLUMN leader_decision DROP NOT NULL;
ALTER TABLE public.site_day_sessions ALTER COLUMN leader_auth_staff_id DROP NOT NULL;
ALTER TABLE public.site_day_sessions ALTER COLUMN leader_auth_at DROP NOT NULL;
ALTER TABLE public.site_day_sessions ALTER COLUMN created_at DROP NOT NULL;
ALTER TABLE public.site_day_sessions ALTER COLUMN updated_at DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.site_day_sessions SET lockdown_active = false WHERE lockdown_active IS NULL;
  BEGIN
    ALTER TABLE public.site_day_sessions ALTER COLUMN lockdown_active SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_day_sessions', 'lockdown_active', SQLERRM;
  END;
END $$;

ALTER TABLE public.site_day_sessions ALTER COLUMN lockdown_reason DROP NOT NULL;
ALTER TABLE public.site_day_sessions ALTER COLUMN lockdown_severity DROP NOT NULL;
ALTER TABLE public.site_day_sessions ALTER COLUMN lockdown_hub_issue_id DROP NOT NULL;
ALTER TABLE public.site_day_sessions ALTER COLUMN lockdown_at DROP NOT NULL;
ALTER TABLE public.site_day_sessions ALTER COLUMN lockdown_by_staff_id DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.site_day_visitors SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.site_day_visitors ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_day_visitors', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.site_day_visitors ALTER COLUMN session_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_day_visitors', 'session_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.site_day_visitors ALTER COLUMN display_name SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_day_visitors', 'display_name', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.site_day_visitors ALTER COLUMN kind SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_day_visitors', 'kind', SQLERRM;
  END;
END $$;

ALTER TABLE public.site_day_visitors ALTER COLUMN linked_participant_id DROP NOT NULL;
ALTER TABLE public.site_day_visitors ALTER COLUMN note DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.site_day_visitors SET arrived_at = now() WHERE arrived_at IS NULL;
  BEGIN
    ALTER TABLE public.site_day_visitors ALTER COLUMN arrived_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_day_visitors', 'arrived_at', SQLERRM;
  END;
END $$;

ALTER TABLE public.site_day_visitors ALTER COLUMN arrived_by DROP NOT NULL;
ALTER TABLE public.site_day_visitors ALTER COLUMN left_at DROP NOT NULL;
ALTER TABLE public.site_day_visitors ALTER COLUMN left_by DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.site_day_visitors SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.site_day_visitors ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_day_visitors', 'created_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.site_day_visitors SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.site_day_visitors ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_day_visitors', 'updated_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.site_issues_register SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.site_issues_register ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_issues_register', 'id', SQLERRM;
  END;
END $$;

ALTER TABLE public.site_issues_register ALTER COLUMN session_id DROP NOT NULL;
ALTER TABLE public.site_issues_register ALTER COLUMN reported_by DROP NOT NULL;
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.site_issues_register ALTER COLUMN severity SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_issues_register', 'severity', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.site_issues_register ALTER COLUMN issue_description SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_issues_register', 'issue_description', SQLERRM;
  END;
END $$;

ALTER TABLE public.site_issues_register ALTER COLUMN workaround_plan DROP NOT NULL;
ALTER TABLE public.site_issues_register ALTER COLUMN owner DROP NOT NULL;
ALTER TABLE public.site_issues_register ALTER COLUMN council_sla_category DROP NOT NULL;
ALTER TABLE public.site_issues_register ALTER COLUMN council_sla_deadline DROP NOT NULL;
ALTER TABLE public.site_issues_register ALTER COLUMN email_dispatched_to_council DROP NOT NULL;
ALTER TABLE public.site_issues_register ALTER COLUMN email_dispatched_at DROP NOT NULL;
ALTER TABLE public.site_issues_register ALTER COLUMN status DROP NOT NULL;
ALTER TABLE public.site_issues_register ALTER COLUMN resolved_at DROP NOT NULL;
ALTER TABLE public.site_issues_register ALTER COLUMN created_at DROP NOT NULL;
ALTER TABLE public.site_issues_register ALTER COLUMN workaround_accepted_at DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.site_issues_register SET update_log = '' WHERE update_log IS NULL;
  BEGIN
    ALTER TABLE public.site_issues_register ALTER COLUMN update_log SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'site_issues_register', 'update_log', SQLERRM;
  END;
END $$;

ALTER TABLE public.site_issues_register ALTER COLUMN deferred_until DROP NOT NULL;
ALTER TABLE public.site_issues_register ALTER COLUMN council_severity DROP NOT NULL;
ALTER TABLE public.site_issues_register ALTER COLUMN event_id DROP NOT NULL;
ALTER TABLE public.site_issues_register ALTER COLUMN event_day_session_id DROP NOT NULL;
ALTER TABLE public.site_issues_register ALTER COLUMN issue_area DROP NOT NULL;
ALTER TABLE public.site_issues_register ALTER COLUMN occurred_at DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.staff_compliance_and_certs SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.staff_compliance_and_certs ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'staff_compliance_and_certs', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.staff_compliance_and_certs ALTER COLUMN staff_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'staff_compliance_and_certs', 'staff_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.staff_compliance_and_certs ALTER COLUMN cert_type SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'staff_compliance_and_certs', 'cert_type', SQLERRM;
  END;
END $$;

ALTER TABLE public.staff_compliance_and_certs ALTER COLUMN reference_number DROP NOT NULL;
ALTER TABLE public.staff_compliance_and_certs ALTER COLUMN expiry_date DROP NOT NULL;
ALTER TABLE public.staff_compliance_and_certs ALTER COLUMN notes DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.staff_compliance_and_certs SET created_at = timezone('utc'::text, now()) WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.staff_compliance_and_certs ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'staff_compliance_and_certs', 'created_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.staff_compliance_and_certs SET updated_at = timezone('utc'::text, now()) WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.staff_compliance_and_certs ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'staff_compliance_and_certs', 'updated_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.staff_registry SET id = uuid_generate_v4() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.staff_registry ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'staff_registry', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.staff_registry ALTER COLUMN full_name SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'staff_registry', 'full_name', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.staff_registry ALTER COLUMN role SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'staff_registry', 'role', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.staff_registry ALTER COLUMN pin_hash SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'staff_registry', 'pin_hash', SQLERRM;
  END;
END $$;

ALTER TABLE public.staff_registry ALTER COLUMN active DROP NOT NULL;
ALTER TABLE public.staff_registry ALTER COLUMN created_at DROP NOT NULL;
ALTER TABLE public.staff_registry ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE public.staff_registry ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public.staff_registry ALTER COLUMN street_address DROP NOT NULL;
ALTER TABLE public.staff_registry ALTER COLUMN personnel_type DROP NOT NULL;
ALTER TABLE public.staff_registry ALTER COLUMN certifications DROP NOT NULL;
ALTER TABLE public.staff_registry ALTER COLUMN notes DROP NOT NULL;
ALTER TABLE public.staff_registry ALTER COLUMN auth_user_id DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.system_lookup_parameters SET id = uuid_generate_v4() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.system_lookup_parameters ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'system_lookup_parameters', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.system_lookup_parameters ALTER COLUMN category SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'system_lookup_parameters', 'category', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.system_lookup_parameters ALTER COLUMN code SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'system_lookup_parameters', 'code', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.system_lookup_parameters ALTER COLUMN display_name SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'system_lookup_parameters', 'display_name', SQLERRM;
  END;
END $$;

ALTER TABLE public.system_lookup_parameters ALTER COLUMN active DROP NOT NULL;
ALTER TABLE public.system_lookup_parameters ALTER COLUMN created_at DROP NOT NULL;
ALTER TABLE public.system_lookup_parameters ALTER COLUMN sort_order DROP NOT NULL;
ALTER TABLE public.system_lookup_parameters ALTER COLUMN badge_color DROP NOT NULL;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.system_operational_settings ALTER COLUMN key SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'system_operational_settings', 'key', SQLERRM;
  END;
END $$;

ALTER TABLE public.system_operational_settings ALTER COLUMN value_uuid DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.system_operational_settings SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.system_operational_settings ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'system_operational_settings', 'updated_at', SQLERRM;
  END;
END $$;

ALTER TABLE public.system_operational_settings ALTER COLUMN updated_by DROP NOT NULL;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.system_parameters ALTER COLUMN key SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'system_parameters', 'key', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.system_parameters ALTER COLUMN value SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'system_parameters', 'value', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.system_parameters ALTER COLUMN description SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'system_parameters', 'description', SQLERRM;
  END;
END $$;

ALTER TABLE public.system_parameters ALTER COLUMN updated_by DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.system_parameters SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.system_parameters ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'system_parameters', 'updated_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.transport_assets SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.transport_assets ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'transport_assets', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.transport_assets ALTER COLUMN name SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'transport_assets', 'name', SQLERRM;
  END;
END $$;

ALTER TABLE public.transport_assets ALTER COLUMN make_model DROP NOT NULL;
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.transport_assets ALTER COLUMN rego_plate SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'transport_assets', 'rego_plate', SQLERRM;
  END;
END $$;

ALTER TABLE public.transport_assets ALTER COLUMN passenger_capacity DROP NOT NULL;
ALTER TABLE public.transport_assets ALTER COLUMN is_active DROP NOT NULL;
ALTER TABLE public.transport_assets ALTER COLUMN vehicle_category DROP NOT NULL;
ALTER TABLE public.transport_assets ALTER COLUMN vin DROP NOT NULL;
ALTER TABLE public.transport_assets ALTER COLUMN registration_expiry DROP NOT NULL;
ALTER TABLE public.transport_assets ALTER COLUMN service_interval_km DROP NOT NULL;
ALTER TABLE public.transport_assets ALTER COLUMN last_service_odo DROP NOT NULL;
ALTER TABLE public.transport_assets ALTER COLUMN last_service_date DROP NOT NULL;
ALTER TABLE public.transport_assets ALTER COLUMN deferred_until DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.transport_assets SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.transport_assets ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'transport_assets', 'updated_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.transport_assets SET has_wheelchair_hoist = false WHERE has_wheelchair_hoist IS NULL;
  BEGIN
    ALTER TABLE public.transport_assets ALTER COLUMN has_wheelchair_hoist SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'transport_assets', 'has_wheelchair_hoist', SQLERRM;
  END;
END $$;

ALTER TABLE public.transport_assets ALTER COLUMN current_odometer_km DROP NOT NULL;
ALTER TABLE public.transport_assets ALTER COLUMN current_odometer_updated_at DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.transport_requests SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.transport_requests ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'transport_requests', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.transport_requests ALTER COLUMN participant_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'transport_requests', 'participant_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.transport_requests SET request_date = CURRENT_DATE WHERE request_date IS NULL;
  BEGIN
    ALTER TABLE public.transport_requests ALTER COLUMN request_date SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'transport_requests', 'request_date', SQLERRM;
  END;
END $$;

ALTER TABLE public.transport_requests ALTER COLUMN scheduled_time DROP NOT NULL;
ALTER TABLE public.transport_requests ALTER COLUMN pickup_address DROP NOT NULL;
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.transport_requests ALTER COLUMN destination_label SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'transport_requests', 'destination_label', SQLERRM;
  END;
END $$;

ALTER TABLE public.transport_requests ALTER COLUMN reason DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.transport_requests SET hoist_required = false WHERE hoist_required IS NULL;
  BEGIN
    ALTER TABLE public.transport_requests ALTER COLUMN hoist_required SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'transport_requests', 'hoist_required', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.transport_requests SET status = 'requested' WHERE status IS NULL;
  BEGIN
    ALTER TABLE public.transport_requests ALTER COLUMN status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'transport_requests', 'status', SQLERRM;
  END;
END $$;

ALTER TABLE public.transport_requests ALTER COLUMN assigned_driver_staff_id DROP NOT NULL;
ALTER TABLE public.transport_requests ALTER COLUMN assigned_asset_id DROP NOT NULL;
ALTER TABLE public.transport_requests ALTER COLUMN notes DROP NOT NULL;
ALTER TABLE public.transport_requests ALTER COLUMN completed_sync_log_id DROP NOT NULL;
ALTER TABLE public.transport_requests ALTER COLUMN completed_at DROP NOT NULL;
ALTER TABLE public.transport_requests ALTER COLUMN created_by_staff_id DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.transport_requests SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.transport_requests ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'transport_requests', 'created_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.transport_requests SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.transport_requests ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'transport_requests', 'updated_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.transport_trips SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.transport_trips ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'transport_trips', 'id', SQLERRM;
  END;
END $$;

ALTER TABLE public.transport_trips ALTER COLUMN event_id DROP NOT NULL;
ALTER TABLE public.transport_trips ALTER COLUMN driver_id DROP NOT NULL;
ALTER TABLE public.transport_trips ALTER COLUMN vehicle_id DROP NOT NULL;
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.transport_trips ALTER COLUMN start_odometer SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'transport_trips', 'start_odometer', SQLERRM;
  END;
END $$;

ALTER TABLE public.transport_trips ALTER COLUMN end_odometer DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.transport_trips SET status = 'Not Started' WHERE status IS NULL;
  BEGIN
    ALTER TABLE public.transport_trips ALTER COLUMN status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'transport_trips', 'status', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.transport_trips SET created_at = timezone('utc'::text, now()) WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.transport_trips ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'transport_trips', 'created_at', SQLERRM;
  END;
END $$;

ALTER TABLE public.transport_trips ALTER COLUMN driver_staff_id DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.transport_trips SET trip_date = CURRENT_DATE WHERE trip_date IS NULL;
  BEGIN
    ALTER TABLE public.transport_trips ALTER COLUMN trip_date SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'transport_trips', 'trip_date', SQLERRM;
  END;
END $$;

ALTER TABLE public.transport_trips ALTER COLUMN start_odometer_km DROP NOT NULL;
ALTER TABLE public.transport_trips ALTER COLUMN end_odometer_km DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.transport_trips SET started_at = now() WHERE started_at IS NULL;
  BEGIN
    ALTER TABLE public.transport_trips ALTER COLUMN started_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'transport_trips', 'started_at', SQLERRM;
  END;
END $$;

ALTER TABLE public.transport_trips ALTER COLUMN completed_at DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.transport_trips SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.transport_trips ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'transport_trips', 'updated_at', SQLERRM;
  END;
END $$;

ALTER TABLE public.transport_trips ALTER COLUMN start_odometer_variance_reason DROP NOT NULL;
ALTER TABLE public.transport_trips ALTER COLUMN bus_run_code DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.transport_trips SET trip_origin = 'depot' WHERE trip_origin IS NULL;
  BEGIN
    ALTER TABLE public.transport_trips ALTER COLUMN trip_origin SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'transport_trips', 'trip_origin', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.transport_trips SET trip_return = 'depot' WHERE trip_return IS NULL;
  BEGIN
    ALTER TABLE public.transport_trips ALTER COLUMN trip_return SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'transport_trips', 'trip_return', SQLERRM;
  END;
END $$;

ALTER TABLE public.transport_trips ALTER COLUMN origin_address DROP NOT NULL;
ALTER TABLE public.transport_trips ALTER COLUMN trip_kind DROP NOT NULL;
ALTER TABLE public.transport_trips ALTER COLUMN event_day_session_id DROP NOT NULL;
ALTER TABLE public.transport_trips ALTER COLUMN venue_stop_from_id DROP NOT NULL;
ALTER TABLE public.transport_trips ALTER COLUMN venue_stop_to_id DROP NOT NULL;
ALTER TABLE public.transport_trips ALTER COLUMN hop_index DROP NOT NULL;
ALTER TABLE public.transport_trips ALTER COLUMN asset_id DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.trip_legs SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.trip_legs ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'trip_legs', 'id', SQLERRM;
  END;
END $$;

ALTER TABLE public.trip_legs ALTER COLUMN trip_id DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN participant_id DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN leg_type DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN sequence_order DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.trip_legs SET status = 'Pending' WHERE status IS NULL;
  BEGIN
    ALTER TABLE public.trip_legs ALTER COLUMN status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'trip_legs', 'status', SQLERRM;
  END;
END $$;

ALTER TABLE public.trip_legs ALTER COLUMN start_lat DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN start_lng DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN end_lat DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN end_lng DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN calculated_gps_km DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN override_km DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN medication_bag_collected DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN medication_bag_unexpected DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN medication_bag_notes DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN started_at DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN completed_at DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN leg_index DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN leg_kind DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN from_label DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN to_label DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN from_participant_id DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN to_participant_id DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN start_at DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN end_at DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN gps_distance_km DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN logged_distance_km DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN passenger_present DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN no_show_triggered_at DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.trip_legs SET medication_expected = false WHERE medication_expected IS NULL;
  BEGIN
    ALTER TABLE public.trip_legs ALTER COLUMN medication_expected SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'trip_legs', 'medication_expected', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.trip_legs SET medication_handover_confirmed = false WHERE medication_handover_confirmed IS NULL;
  BEGIN
    ALTER TABLE public.trip_legs ALTER COLUMN medication_handover_confirmed SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'trip_legs', 'medication_handover_confirmed', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.trip_legs SET unexpected_medication_logged = false WHERE unexpected_medication_logged IS NULL;
  BEGIN
    ALTER TABLE public.trip_legs ALTER COLUMN unexpected_medication_logged SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'trip_legs', 'unexpected_medication_logged', SQLERRM;
  END;
END $$;

ALTER TABLE public.trip_legs ALTER COLUMN unexpected_medication_notes DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.trip_legs SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.trip_legs ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'trip_legs', 'created_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.trip_legs SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.trip_legs ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'trip_legs', 'updated_at', SQLERRM;
  END;
END $$;

ALTER TABLE public.trip_legs ALTER COLUMN target_address DROP NOT NULL;
ALTER TABLE public.trip_legs ALTER COLUMN medication_handover_status DROP NOT NULL;

DO $$
BEGIN
  UPDATE public.vendors SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.vendors ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'vendors', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.vendors ALTER COLUMN name SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'vendors', 'name', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.vendors SET status = 'active' WHERE status IS NULL;
  BEGIN
    ALTER TABLE public.vendors ALTER COLUMN status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'vendors', 'status', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.vendors SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.vendors ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'vendors', 'created_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.vendors SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.vendors ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'vendors', 'updated_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.venue_safety_answers SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.venue_safety_answers ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venue_safety_answers', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.venue_safety_answers ALTER COLUMN signoff_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venue_safety_answers', 'signoff_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.venue_safety_answers ALTER COLUMN field_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venue_safety_answers', 'field_id', SQLERRM;
  END;
END $$;

ALTER TABLE public.venue_safety_answers ALTER COLUMN answer_text DROP NOT NULL;
ALTER TABLE public.venue_safety_answers ALTER COLUMN answer_json DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.venue_safety_answers SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.venue_safety_answers ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venue_safety_answers', 'created_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.venue_safety_baseline_signoffs SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.venue_safety_baseline_signoffs ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venue_safety_baseline_signoffs', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.venue_safety_baseline_signoffs ALTER COLUMN venue_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venue_safety_baseline_signoffs', 'venue_id', SQLERRM;
  END;
END $$;

ALTER TABLE public.venue_safety_baseline_signoffs ALTER COLUMN signed_off_by_staff_id DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.venue_safety_baseline_signoffs SET signed_off_at = now() WHERE signed_off_at IS NULL;
  BEGIN
    ALTER TABLE public.venue_safety_baseline_signoffs ALTER COLUMN signed_off_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venue_safety_baseline_signoffs', 'signed_off_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.venue_safety_baseline_signoffs ALTER COLUMN evidence_ref SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venue_safety_baseline_signoffs', 'evidence_ref', SQLERRM;
  END;
END $$;

ALTER TABLE public.venue_safety_baseline_signoffs ALTER COLUMN notes DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.venue_safety_baseline_signoffs SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.venue_safety_baseline_signoffs ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venue_safety_baseline_signoffs', 'created_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.venue_template_fields SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.venue_template_fields ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venue_template_fields', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.venue_template_fields ALTER COLUMN venue_id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venue_template_fields', 'venue_id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.venue_template_fields ALTER COLUMN prompt SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venue_template_fields', 'prompt', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.venue_template_fields SET answer_type = 'yes_no' WHERE answer_type IS NULL;
  BEGIN
    ALTER TABLE public.venue_template_fields ALTER COLUMN answer_type SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venue_template_fields', 'answer_type', SQLERRM;
  END;
END $$;

ALTER TABLE public.venue_template_fields ALTER COLUMN options_json DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.venue_template_fields SET is_mandatory = true WHERE is_mandatory IS NULL;
  BEGIN
    ALTER TABLE public.venue_template_fields ALTER COLUMN is_mandatory SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venue_template_fields', 'is_mandatory', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.venue_template_fields SET is_system_core = false WHERE is_system_core IS NULL;
  BEGIN
    ALTER TABLE public.venue_template_fields ALTER COLUMN is_system_core SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venue_template_fields', 'is_system_core', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.venue_template_fields SET sort_order = 0 WHERE sort_order IS NULL;
  BEGIN
    ALTER TABLE public.venue_template_fields ALTER COLUMN sort_order SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venue_template_fields', 'sort_order', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.venue_template_fields SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.venue_template_fields ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venue_template_fields', 'created_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.venue_template_fields SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.venue_template_fields ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venue_template_fields', 'updated_at', SQLERRM;
  END;
END $$;


DO $$
BEGIN
  UPDATE public.venues SET id = gen_random_uuid() WHERE id IS NULL;
  BEGIN
    ALTER TABLE public.venues ALTER COLUMN id SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venues', 'id', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.venues ALTER COLUMN name SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venues', 'name', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.venues SET venue_type = 'general' WHERE venue_type IS NULL;
  BEGIN
    ALTER TABLE public.venues ALTER COLUMN venue_type SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venues', 'venue_type', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.venues SET status = 'active' WHERE status IS NULL;
  BEGIN
    ALTER TABLE public.venues ALTER COLUMN status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venues', 'status', SQLERRM;
  END;
END $$;

ALTER TABLE public.venues ALTER COLUMN street_address DROP NOT NULL;
ALTER TABLE public.venues ALTER COLUMN gps_lat DROP NOT NULL;
ALTER TABLE public.venues ALTER COLUMN gps_lng DROP NOT NULL;
ALTER TABLE public.venues ALTER COLUMN access_notes DROP NOT NULL;
ALTER TABLE public.venues ALTER COLUMN site_contact_name DROP NOT NULL;
ALTER TABLE public.venues ALTER COLUMN site_contact_phone DROP NOT NULL;
ALTER TABLE public.venues ALTER COLUMN max_safe_group_size DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.venues SET risk_tier = 'medium' WHERE risk_tier IS NULL;
  BEGIN
    ALTER TABLE public.venues ALTER COLUMN risk_tier SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venues', 'risk_tier', SQLERRM;
  END;
END $$;

ALTER TABLE public.venues ALTER COLUMN cloned_from_venue_id DROP NOT NULL;
ALTER TABLE public.venues ALTER COLUMN created_by_staff_id DROP NOT NULL;
DO $$
BEGIN
  UPDATE public.venues SET created_at = now() WHERE created_at IS NULL;
  BEGIN
    ALTER TABLE public.venues ALTER COLUMN created_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venues', 'created_at', SQLERRM;
  END;
END $$;

DO $$
BEGIN
  UPDATE public.venues SET updated_at = now() WHERE updated_at IS NULL;
  BEGIN
    ALTER TABLE public.venues ALTER COLUMN updated_at SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP NOT NULL %.%: %', 'venues', 'updated_at', SQLERRM;
  END;
END $$;


-- ---------------------------------------------------------------------------
-- VALIDATION
-- ---------------------------------------------------------------------------
-- Expect column count close to 817:
-- SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public';
--
-- Missing emergency tables should exist (expect 2):
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN ('operational_emergencies', 'operational_emergency_muster')
-- ORDER BY 1;
