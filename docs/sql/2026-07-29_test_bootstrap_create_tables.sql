-- ============================================================================
-- 2026-07-29 — TEST bootstrap: CREATE TABLE from live DEV OpenAPI
--
-- PURPOSE: empty TEST needs table shells so Admin JSON restore can load data.
-- INCLUDES: CREATE TABLE IF NOT EXISTS + permissive anon/authenticated RLS + GRANTs.
-- LIMITS: no foreign keys, indexes, triggers, or app RPCs — apply those from docs/sql/ next.
-- SOURCE: PostgREST OpenAPI from live DEV (list_backup_tables ∩ definitions).
-- Safe to re-run: IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- asset_checkpoints
CREATE TABLE IF NOT EXISTS public.asset_checkpoints (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  checkpoint_text text NOT NULL,
  vehicle_category text NOT NULL,
  asset_id uuid NULL,
  impact_level text NOT NULL,
  is_mandatory boolean NULL,
  PRIMARY KEY (id)
);

-- asset_clearance_items
CREATE TABLE IF NOT EXISTS public.asset_clearance_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clearance_id uuid NULL,
  checkpoint_id uuid NULL,
  is_passed boolean NOT NULL,
  notes text NULL,
  severity text NULL,
  workaround_text text NULL,
  PRIMARY KEY (id)
);

-- asset_daily_clearance
CREATE TABLE IF NOT EXISTS public.asset_daily_clearance (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  asset_id uuid NULL,
  clearance_date date NOT NULL,
  driver_staff_id uuid NOT NULL,
  start_odometer integer NOT NULL,
  status text NOT NULL,
  accumulated_issues text NULL,
  driver_comfort_declared boolean NOT NULL,
  requires_manager_review boolean NOT NULL,
  driver_auth_staff_id uuid NULL,
  driver_auth_pin_verified_at timestamptz NULL,
  manager_auth_staff_id uuid NULL,
  manager_auth_pin_verified_at timestamptz NULL,
  PRIMARY KEY (id)
);

-- asset_maintenance_logs
CREATE TABLE IF NOT EXISTS public.asset_maintenance_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL,
  logged_by_id uuid NULL,
  log_type text NOT NULL,
  log_date date NOT NULL,
  description text NOT NULL,
  cost numeric NULL,
  current_odometer_reading numeric NULL,
  is_resolved boolean NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- assets
CREATE TABLE IF NOT EXISTS public.assets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  asset_name text NOT NULL,
  asset_type text NOT NULL,
  status text NOT NULL,
  identifier_string text NULL,
  insurance_policy_number text NULL,
  insurance_expiry date NULL,
  next_compliance_review_date date NULL,
  custom_specifications jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- attendance_roster_logs
CREATE TABLE IF NOT EXISTS public.attendance_roster_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  participant_id uuid NULL,
  roster_date date NOT NULL,
  expected_service text NOT NULL,
  actual_status text NOT NULL,
  driver_notes text NULL,
  recorded_by_uuid uuid NULL,
  device_uuid text NULL,
  created_at timestamptz NULL DEFAULT now(),
  billing_state text NULL,
  ndis_cancellation_reason text NULL,
  exported_at timestamptz NULL,
  exported_batch_id uuid NULL,
  PRIMARY KEY (id)
);

-- carers_registry
CREATE TABLE IF NOT EXISTS public.carers_registry (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  participant_id uuid NULL,
  full_name text NOT NULL,
  relationship text NULL,
  phone text NULL,
  email text NULL,
  street_address text NULL,
  is_primary_contact boolean NOT NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- centre_operating_hours
CREATE TABLE IF NOT EXISTS public.centre_operating_hours (
  day_of_week text NOT NULL,
  open_time text NOT NULL,
  close_time text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_staff_id uuid NULL
);

-- charge_codes
CREATE TABLE IF NOT EXISTS public.charge_codes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  standard_rate numeric NOT NULL,
  unit_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- checklist_items
CREATE TABLE IF NOT EXISTS public.checklist_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  label text NOT NULL,
  category text NOT NULL,
  sort_order integer NOT NULL,
  is_active boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- checklist_responses
CREATE TABLE IF NOT EXISTS public.checklist_responses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ledger_id uuid NOT NULL,
  item_id uuid NOT NULL,
  status text NOT NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- client_attendance_log
CREATE TABLE IF NOT EXISTS public.client_attendance_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  expected_arrival_at timestamptz NOT NULL,
  arrival_method text NOT NULL,
  checked_in_at timestamptz NULL,
  checked_in_by uuid NULL,
  checked_out_at timestamptz NULL,
  checked_out_by uuid NULL,
  status text NOT NULL,
  escalation_issue_id uuid NULL,
  escalation_severity text NULL,
  escalation_raised_at timestamptz NULL,
  red_sms_dispatched_at timestamptz NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expected_departure_at timestamptz NULL,
  departure_issue_id uuid NULL,
  departure_severity text NULL,
  departure_raised_at timestamptz NULL,
  departure_red_sms_dispatched_at timestamptz NULL,
  arrival_bus_run_code text NULL,
  PRIMARY KEY (id)
);

-- compliance_assets
CREATE TABLE IF NOT EXISTS public.compliance_assets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  category text NOT NULL,
  type text NOT NULL,
  name text NOT NULL,
  description text NULL,
  subject_table text NULL,
  subject_id uuid NULL,
  expiry_date date NULL,
  next_action_at timestamptz NULL,
  action_module text NOT NULL,
  config jsonb NOT NULL,
  status text NOT NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- compliance_audit_logs
CREATE TABLE IF NOT EXISTS public.compliance_audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  participant_id uuid NULL,
  action_performed text NOT NULL,
  witness_1_identity text NOT NULL,
  witness_2_identity text NOT NULL,
  timestamp timestamptz NULL,
  metadata jsonb NULL,
  PRIMARY KEY (id)
);

-- event_activity_rolls
CREATE TABLE IF NOT EXISTS public.event_activity_rolls (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  venue_stop_id uuid NOT NULL,
  event_day_session_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  status text NOT NULL,
  checked_in_at timestamptz NULL,
  checked_in_by_id uuid NULL,
  marked_absent_at timestamptz NULL,
  marked_absent_by_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- event_attendance_log
CREATE TABLE IF NOT EXISTS public.event_attendance_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_day_session_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  expected_arrival_at timestamptz NOT NULL,
  arrival_method text NOT NULL,
  checked_in_at timestamptz NULL,
  checked_in_by uuid NULL,
  checked_out_at timestamptz NULL,
  checked_out_by uuid NULL,
  status text NOT NULL,
  return_transport text NULL,
  escalation_issue_id uuid NULL,
  escalation_severity text NULL,
  escalation_raised_at timestamptz NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  arrival_bus_run_code text NULL,
  return_bus_run_code text NULL,
  PRIMARY KEY (id)
);

-- event_bus_manifest
CREATE TABLE IF NOT EXISTS public.event_bus_manifest (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_day_session_id uuid NOT NULL,
  transport_trip_id uuid NOT NULL,
  participant_id uuid NULL,
  carer_id uuid NULL,
  expected_on_bus boolean NOT NULL,
  status text NOT NULL,
  checked_on_at timestamptz NULL,
  checked_on_by uuid NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- event_curfew_log
CREATE TABLE IF NOT EXISTS public.event_curfew_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_day_session_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  expected_accounted_at timestamptz NOT NULL,
  accounted_at timestamptz NULL,
  accounted_by uuid NULL,
  status text NOT NULL,
  escalation_issue_id uuid NULL,
  escalation_severity text NULL,
  escalation_raised_at timestamptz NULL,
  red_sms_dispatched_at timestamptz NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- event_day_med_alternate_plans
CREATE TABLE IF NOT EXISTS public.event_day_med_alternate_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_day_session_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  plan_note text NOT NULL,
  attested_by_staff_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- event_day_sessions
CREATE TABLE IF NOT EXISTS public.event_day_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  session_date date NOT NULL,
  phase text NOT NULL,
  manager_staff_id uuid NULL,
  curfew_time text NULL,
  morning_roll_time text NULL,
  opened_by_id uuid NULL,
  open_declared_at timestamptz NULL,
  open_leader_notes text NULL,
  closed_by_id uuid NULL,
  close_declared_at timestamptz NULL,
  close_leader_notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expected_arrival_by timestamptz NULL,
  PRIMARY KEY (id)
);

-- event_financial_ledger
CREATE TABLE IF NOT EXISTS public.event_financial_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_id uuid NULL,
  transaction_date date NOT NULL,
  financial_code text NOT NULL,
  description text NOT NULL,
  amount numeric NOT NULL,
  created_at timestamptz NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- event_manifest
CREATE TABLE IF NOT EXISTS public.event_manifest (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  event_type text NOT NULL,
  venue_name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  ticket_price numeric NOT NULL,
  created_at timestamptz NULL DEFAULT now(),
  description text NULL,
  status text NOT NULL,
  closed_at timestamptz NULL,
  closed_by_id uuid NULL,
  billing_locked boolean NULL,
  reconciliation_notes text NULL,
  default_charge_code_id uuid NULL,
  standard_price numeric NULL,
  event_kind text NOT NULL,
  primary_venue_id uuid NULL,
  base_hotel_venue_id uuid NULL,
  curfew_time text NULL,
  morning_roll_time text NULL,
  PRIMARY KEY (id)
);

-- event_meal_service_rolls
CREATE TABLE IF NOT EXISTS public.event_meal_service_rolls (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  venue_stop_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  status text NOT NULL,
  notes text NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_id uuid NULL,
  PRIMARY KEY (id)
);

-- event_morning_log
CREATE TABLE IF NOT EXISTS public.event_morning_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_day_session_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  expected_accounted_at timestamptz NOT NULL,
  accounted_at timestamptz NULL,
  accounted_by uuid NULL,
  status text NOT NULL,
  escalation_issue_id uuid NULL,
  escalation_severity text NULL,
  escalation_raised_at timestamptz NULL,
  red_sms_dispatched_at timestamptz NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- event_roster_bookings
CREATE TABLE IF NOT EXISTS public.event_roster_bookings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_id uuid NULL,
  participant_id uuid NULL,
  booking_status text NOT NULL,
  amount_paid numeric NOT NULL,
  is_fully_paid boolean NULL,
  created_at timestamptz NULL DEFAULT now(),
  notes text NULL,
  custom_price numeric NULL,
  brings_carer boolean NULL,
  carer_transport_required boolean NULL,
  companion_carer_id uuid NULL,
  carer_id uuid NULL,
  participant_transport_required boolean NULL,
  finance_verified_at timestamptz NULL,
  funding_claim_type text NULL,
  charge_code_id uuid NULL,
  quantity_delivered numeric NULL,
  rate_per_unit_applied numeric NULL,
  total_amount_billed numeric NULL,
  billing_status text NULL,
  trip_pickup_address_override text NULL,
  dynamic_medical_notes_snapshot text NULL,
  outbound_transport_mode text NOT NULL,
  return_transport_mode text NOT NULL,
  transport_med_bag_required text NOT NULL,
  transport_med_notes text NULL,
  pickup_order integer NOT NULL,
  outbound_bus_run_code text NULL,
  return_bus_run_code text NULL,
  is_guest_booking boolean NOT NULL,
  host_participant_id uuid NULL,
  guest_ops_note text NULL,
  PRIMARY KEY (id)
);

-- event_venue_reconfirmations
CREATE TABLE IF NOT EXISTS public.event_venue_reconfirmations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  venue_id uuid NOT NULL,
  reconfirmed_by_staff_id uuid NULL,
  reconfirmed_at timestamptz NOT NULL,
  still_valid boolean NOT NULL,
  notes text NULL,
  evidence_ref text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- event_venue_stops
CREATE TABLE IF NOT EXISTS public.event_venue_stops (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  session_date date NOT NULL,
  venue_id uuid NULL,
  stop_order integer NOT NULL,
  label_override text NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  phase text NOT NULL,
  movement_method text NOT NULL,
  opened_at timestamptz NULL,
  closed_at timestamptz NULL,
  opened_by_id uuid NULL,
  activity_kind text NOT NULL,
  meal_slot text NULL,
  meal_source text NULL,
  menu_notes text NULL,
  prepared_by_staff_id uuid NULL,
  preparer_cert_status text NULL,
  preparer_ack_note text NULL,
  prep_checks_completed jsonb NULL,
  prep_attestation_mode text NULL,
  prep_attested_by_staff_id uuid NULL,
  guest_preparer_name text NULL,
  prep_attestation_note text NULL,
  sfh_approved_by_staff_id uuid NULL,
  PRIMARY KEY (id)
);

-- hub_issue_notes
CREATE TABLE IF NOT EXISTS public.hub_issue_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source text NOT NULL,
  source_row_id text NOT NULL,
  note text NOT NULL,
  kind text NOT NULL,
  stamped_at timestamptz NOT NULL,
  staff_id text NULL,
  metadata jsonb NULL,
  PRIMARY KEY (id)
);

-- maintenance_items
CREATE TABLE IF NOT EXISTS public.maintenance_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  severity text NOT NULL,
  status text NOT NULL,
  source text NOT NULL,
  source_ref_id uuid NULL,
  venue_id uuid NULL,
  event_id uuid NULL,
  location_label text NULL,
  reported_by text NULL,
  assigned_to text NULL,
  resolution_notes text NULL,
  resolved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deferred_until date NULL,
  deferred_reason text NULL,
  defer_count integer NOT NULL,
  last_note_at timestamptz NULL,
  PRIMARY KEY (id)
);

-- maintenance_notes
CREATE TABLE IF NOT EXISTS public.maintenance_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  note_text text NOT NULL,
  author text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- medication_administration_log
CREATE TABLE IF NOT EXISTS public.medication_administration_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  schedule_id uuid NULL,
  participant_id uuid NULL,
  administered_at timestamptz NOT NULL,
  administered_by_id uuid NULL,
  witnessed_by_id uuid NULL,
  status text NOT NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- myob_export_batches
CREATE TABLE IF NOT EXISTS public.myob_export_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  exported_at timestamptz NULL,
  exported_by uuid NULL,
  range_start date NULL,
  range_end date NULL,
  row_count integer NULL,
  PRIMARY KEY (id)
);

-- offline_sync_logs
CREATE TABLE IF NOT EXISTS public.offline_sync_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  driver_or_staff_id uuid NOT NULL,
  device_uuid text NOT NULL,
  action_type text NOT NULL,
  payload jsonb NOT NULL,
  synced_at timestamptz NULL,
  created_at timestamptz NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- operational_escalations
CREATE TABLE IF NOT EXISTS public.operational_escalations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clearance_id uuid NULL,
  driver_name text NOT NULL,
  vehicle_info text NOT NULL,
  gate_id text NOT NULL,
  status text NOT NULL,
  claimed_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolution_notes text NULL,
  resolved_by uuid NULL,
  resolved_at timestamptz NULL,
  source_kind text NULL,
  source_issue_id uuid NULL,
  claimed_at timestamptz NULL,
  raised_by uuid NULL,
  operator_acknowledged_at timestamptz NULL,
  operator_acknowledged_by uuid NULL,
  PRIMARY KEY (id)
);

-- operational_incidents
CREATE TABLE IF NOT EXISTS public.operational_incidents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  incident_type text NOT NULL,
  severity text NOT NULL,
  description text NOT NULL,
  vehicle_id uuid NULL,
  event_id uuid NULL,
  reported_by text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- operational_ledger
CREATE TABLE IF NOT EXISTS public.operational_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  staff_id uuid NOT NULL,
  category text NOT NULL,
  severity text NOT NULL,
  action_type text NOT NULL,
  gps_lat numeric NULL,
  gps_lng numeric NULL,
  metadata jsonb NULL,
  PRIMARY KEY (id)
);

-- participant_attendance_schedules
CREATE TABLE IF NOT EXISTS public.participant_attendance_schedules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  participant_id uuid NULL,
  day_of_week text NOT NULL,
  service_type text NOT NULL,
  transport_required text NOT NULL,
  active boolean NULL,
  created_at timestamptz NULL DEFAULT now(),
  archived_at timestamptz NULL,
  archived_by_id uuid NULL,
  archive_witnessed_by_id uuid NULL,
  archive_reason text NULL,
  archive_reference_type text NULL,
  expected_arrival_time text NOT NULL,
  expected_departure_time text NOT NULL,
  inbound_transport text NULL,
  outbound_transport text NULL,
  PRIMARY KEY (id)
);

-- participant_compliance_and_alerts
CREATE TABLE IF NOT EXISTS public.participant_compliance_and_alerts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL,
  record_type text NOT NULL,
  reference_data text NULL,
  expiry_date date NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- participant_financial_ledger
CREATE TABLE IF NOT EXISTS public.participant_financial_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  participant_id uuid NULL,
  transaction_date date NOT NULL,
  financial_code text NOT NULL,
  description text NOT NULL,
  amount numeric NOT NULL,
  is_reconciled boolean NULL,
  created_at timestamptz NULL DEFAULT now(),
  event_id uuid NULL,
  PRIMARY KEY (id)
);

-- participant_infectious_exclusions
CREATE TABLE IF NOT EXISTS public.participant_infectious_exclusions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL,
  category text NOT NULL,
  notes text NULL,
  exclude_centre boolean NOT NULL,
  exclude_trips boolean NOT NULL,
  excluded_from date NOT NULL,
  status text NOT NULL,
  hub_issue_id uuid NULL,
  site_day_session_id uuid NULL,
  declared_by_staff_id uuid NOT NULL,
  declared_at timestamptz NOT NULL,
  clearance_method text NULL,
  clearance_note text NULL,
  evidence_ref text NULL,
  cleared_by_staff_id uuid NULL,
  cleared_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  event_id uuid NULL,
  event_day_session_id uuid NULL,
  home_safe_disposition text NULL,
  home_safe_handover_to text NULL,
  home_safe_note text NULL,
  home_safe_at timestamptz NULL,
  home_safe_by_staff_id uuid NULL,
  PRIMARY KEY (id)
);

-- participant_medication_schedules
CREATE TABLE IF NOT EXISTS public.participant_medication_schedules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  participant_id uuid NULL,
  medication_name text NOT NULL,
  dosage text NOT NULL,
  expected_time text NOT NULL,
  frequency text NOT NULL,
  active boolean NULL,
  created_at timestamptz NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- participants
CREATE TABLE IF NOT EXISTS public.participants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  ndis_number text NOT NULL,
  iddsi_level_liquids integer NULL,
  iddsi_level_solids integer NULL,
  dual_witness_pin_hash text NOT NULL,
  created_at timestamptz NULL DEFAULT now(),
  updated_at timestamptz NULL DEFAULT now(),
  street_address text NULL,
  notes text NULL,
  emergency_contact_name text NULL,
  emergency_contact_phone text NULL,
  emergency_contact_relationship text NULL,
  regular_pickup_address text NULL,
  participant_kind text NOT NULL,
  archived_at timestamptz NULL,
  date_of_birth date NULL,
  allergies_notes text NULL,
  PRIMARY KEY (id)
);

-- site_day_activities
CREATE TABLE IF NOT EXISTS public.site_day_activities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  activity_kind text NOT NULL,
  meal_slot text NULL,
  title text NOT NULL,
  meal_source text NULL,
  menu_notes text NULL,
  phase text NOT NULL,
  sort_order integer NOT NULL,
  opened_at timestamptz NULL,
  opened_by_id uuid NULL,
  closed_at timestamptz NULL,
  closed_by_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  prepared_by_staff_id uuid NULL,
  preparer_cert_status text NULL,
  preparer_ack_note text NULL,
  prep_checks_completed jsonb NULL,
  prep_attestation_mode text NULL,
  prep_attested_by_staff_id uuid NULL,
  guest_preparer_name text NULL,
  prep_attestation_note text NULL,
  sfh_approved_by_staff_id uuid NULL,
  PRIMARY KEY (id)
);

-- site_day_meal_service_rolls
CREATE TABLE IF NOT EXISTS public.site_day_meal_service_rolls (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  status text NOT NULL,
  notes text NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_id uuid NULL,
  PRIMARY KEY (id)
);

-- site_day_sessions
CREATE TABLE IF NOT EXISTS public.site_day_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_date date NOT NULL,
  phase text NOT NULL,
  opened_by_id uuid NULL,
  open_declared_at timestamptz NULL,
  open_leader_notes text NULL,
  closed_by_id uuid NULL,
  close_declared_at timestamptz NULL,
  close_leader_notes text NULL,
  manager_plan_text text NULL,
  manager_decision text NULL,
  manager_auth_staff_id uuid NULL,
  manager_auth_at timestamptz NULL,
  leader_decision text NULL,
  leader_auth_staff_id uuid NULL,
  leader_auth_at timestamptz NULL,
  created_at timestamptz NULL DEFAULT now(),
  updated_at timestamptz NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- site_day_visitors
CREATE TABLE IF NOT EXISTS public.site_day_visitors (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  display_name text NOT NULL,
  kind text NOT NULL,
  linked_participant_id uuid NULL,
  note text NULL,
  arrived_at timestamptz NOT NULL,
  arrived_by uuid NULL,
  left_at timestamptz NULL,
  left_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- site_issues_register
CREATE TABLE IF NOT EXISTS public.site_issues_register (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NULL,
  reported_by text NULL,
  severity text NOT NULL,
  issue_description text NOT NULL,
  workaround_plan text NULL,
  owner text NULL,
  council_sla_category text NULL,
  council_sla_deadline timestamptz NULL,
  email_dispatched_to_council boolean NULL,
  email_dispatched_at timestamptz NULL,
  status text NULL,
  resolved_at timestamptz NULL,
  created_at timestamptz NULL DEFAULT now(),
  workaround_accepted_at timestamptz NULL,
  update_log text NOT NULL,
  deferred_until timestamptz NULL,
  council_severity text NULL,
  event_id uuid NULL,
  event_day_session_id uuid NULL,
  issue_area text NULL,
  PRIMARY KEY (id)
);

-- staff_compliance_and_certs
CREATE TABLE IF NOT EXISTS public.staff_compliance_and_certs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL,
  cert_type text NOT NULL,
  reference_number text NULL,
  expiry_date date NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- staff_registry
CREATE TABLE IF NOT EXISTS public.staff_registry (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  role text NOT NULL,
  pin_hash text NOT NULL,
  active boolean NULL,
  created_at timestamptz NULL DEFAULT now(),
  phone text NULL,
  email text NULL,
  street_address text NULL,
  personnel_type text NULL,
  certifications jsonb NULL,
  notes text NULL,
  auth_user_id uuid NULL,
  PRIMARY KEY (id)
);

-- system_lookup_parameters
CREATE TABLE IF NOT EXISTS public.system_lookup_parameters (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  category text NOT NULL,
  code text NOT NULL,
  display_name text NOT NULL,
  active boolean NULL,
  created_at timestamptz NULL DEFAULT now(),
  sort_order integer NULL,
  badge_color text NULL,
  PRIMARY KEY (id)
);

-- system_operational_settings
CREATE TABLE IF NOT EXISTS public.system_operational_settings (
  key text NOT NULL,
  value_uuid uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL
);

-- system_parameters
CREATE TABLE IF NOT EXISTS public.system_parameters (
  key text NOT NULL,
  value jsonb NOT NULL,
  description text NOT NULL,
  updated_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- transport_assets
CREATE TABLE IF NOT EXISTS public.transport_assets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  make_model text NULL,
  rego_plate text NOT NULL,
  passenger_capacity integer NULL,
  is_active boolean NULL,
  vehicle_category text NULL,
  vin text NULL,
  registration_expiry date NULL,
  service_interval_km integer NULL,
  last_service_odo integer NULL,
  last_service_date date NULL,
  deferred_until date NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  has_wheelchair_hoist boolean NOT NULL,
  current_odometer_km numeric NULL,
  current_odometer_updated_at timestamptz NULL,
  PRIMARY KEY (id)
);

-- transport_requests
CREATE TABLE IF NOT EXISTS public.transport_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL,
  request_date date NOT NULL,
  scheduled_time text NULL,
  pickup_address text NULL,
  destination_label text NOT NULL,
  reason text NULL,
  hoist_required boolean NOT NULL,
  status text NOT NULL,
  assigned_driver_staff_id uuid NULL,
  assigned_asset_id uuid NULL,
  notes text NULL,
  completed_sync_log_id uuid NULL,
  completed_at timestamptz NULL,
  created_by_staff_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- transport_trips
CREATE TABLE IF NOT EXISTS public.transport_trips (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_id uuid NULL,
  driver_id uuid NULL,
  vehicle_id text NULL,
  start_odometer numeric NOT NULL,
  end_odometer numeric NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  driver_staff_id uuid NULL,
  trip_date date NOT NULL,
  start_odometer_km numeric NULL,
  end_odometer_km numeric NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  start_odometer_variance_reason text NULL,
  bus_run_code text NULL,
  trip_origin text NOT NULL,
  trip_return text NOT NULL,
  origin_address text NULL,
  trip_kind text NULL,
  event_day_session_id uuid NULL,
  venue_stop_from_id uuid NULL,
  venue_stop_to_id uuid NULL,
  hop_index integer NULL,
  asset_id uuid NULL,
  PRIMARY KEY (id)
);

-- trip_legs
CREATE TABLE IF NOT EXISTS public.trip_legs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  trip_id uuid NULL,
  participant_id uuid NULL,
  leg_type text NULL,
  sequence_order integer NULL,
  status text NOT NULL,
  start_lat numeric NULL,
  start_lng numeric NULL,
  end_lat numeric NULL,
  end_lng numeric NULL,
  calculated_gps_km numeric NULL,
  override_km numeric NULL,
  medication_bag_collected boolean NULL,
  medication_bag_unexpected boolean NULL,
  medication_bag_notes text NULL,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  leg_index integer NULL,
  leg_kind text NULL,
  from_label text NULL,
  to_label text NULL,
  from_participant_id uuid NULL,
  to_participant_id uuid NULL,
  start_at timestamptz NULL,
  end_at timestamptz NULL,
  gps_distance_km numeric NULL,
  logged_distance_km numeric NULL,
  passenger_present boolean NULL,
  no_show_triggered_at timestamptz NULL,
  medication_expected boolean NOT NULL,
  medication_handover_confirmed boolean NOT NULL,
  unexpected_medication_logged boolean NOT NULL,
  unexpected_medication_notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  target_address text NULL,
  medication_handover_status text NULL,
  PRIMARY KEY (id)
);

-- vendors
CREATE TABLE IF NOT EXISTS public.vendors (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- venue_safety_answers
CREATE TABLE IF NOT EXISTS public.venue_safety_answers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  signoff_id uuid NOT NULL,
  field_id uuid NOT NULL,
  answer_text text NULL,
  answer_json jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- venue_safety_baseline_signoffs
CREATE TABLE IF NOT EXISTS public.venue_safety_baseline_signoffs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL,
  signed_off_by_staff_id uuid NULL,
  signed_off_at timestamptz NOT NULL,
  evidence_ref text NOT NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- venue_template_fields
CREATE TABLE IF NOT EXISTS public.venue_template_fields (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL,
  prompt text NOT NULL,
  answer_type text NOT NULL,
  options_json jsonb NULL,
  is_mandatory boolean NOT NULL,
  is_system_core boolean NOT NULL,
  sort_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- venues
CREATE TABLE IF NOT EXISTS public.venues (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  venue_type text NOT NULL,
  status text NOT NULL,
  street_address text NULL,
  gps_lat numeric NULL,
  gps_lng numeric NULL,
  access_notes text NULL,
  site_contact_name text NULL,
  site_contact_phone text NULL,
  max_safe_group_size integer NULL,
  risk_tier text NOT NULL,
  cloned_from_venue_id uuid NULL,
  created_by_staff_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- ========== permissive anon RLS bootstrap (PIN terminal) ==========
-- Restore uses service_role; day-to-day app needs anon. Tighten at BL-002.
ALTER TABLE public.asset_checkpoints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_asset_checkpoints ON public.asset_checkpoints;
CREATE POLICY kinship_anon_all_asset_checkpoints ON public.asset_checkpoints
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.asset_checkpoints TO anon, authenticated, service_role;

ALTER TABLE public.asset_clearance_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_asset_clearance_items ON public.asset_clearance_items;
CREATE POLICY kinship_anon_all_asset_clearance_items ON public.asset_clearance_items
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.asset_clearance_items TO anon, authenticated, service_role;

ALTER TABLE public.asset_daily_clearance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_asset_daily_clearance ON public.asset_daily_clearance;
CREATE POLICY kinship_anon_all_asset_daily_clearance ON public.asset_daily_clearance
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.asset_daily_clearance TO anon, authenticated, service_role;

ALTER TABLE public.asset_maintenance_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_asset_maintenance_logs ON public.asset_maintenance_logs;
CREATE POLICY kinship_anon_all_asset_maintenance_logs ON public.asset_maintenance_logs
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.asset_maintenance_logs TO anon, authenticated, service_role;

ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_assets ON public.assets;
CREATE POLICY kinship_anon_all_assets ON public.assets
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.assets TO anon, authenticated, service_role;

ALTER TABLE public.attendance_roster_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_attendance_roster_logs ON public.attendance_roster_logs;
CREATE POLICY kinship_anon_all_attendance_roster_logs ON public.attendance_roster_logs
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.attendance_roster_logs TO anon, authenticated, service_role;

ALTER TABLE public.carers_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_carers_registry ON public.carers_registry;
CREATE POLICY kinship_anon_all_carers_registry ON public.carers_registry
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.carers_registry TO anon, authenticated, service_role;

ALTER TABLE public.centre_operating_hours ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_centre_operating_hours ON public.centre_operating_hours;
CREATE POLICY kinship_anon_all_centre_operating_hours ON public.centre_operating_hours
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.centre_operating_hours TO anon, authenticated, service_role;

ALTER TABLE public.charge_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_charge_codes ON public.charge_codes;
CREATE POLICY kinship_anon_all_charge_codes ON public.charge_codes
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.charge_codes TO anon, authenticated, service_role;

ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_checklist_items ON public.checklist_items;
CREATE POLICY kinship_anon_all_checklist_items ON public.checklist_items
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.checklist_items TO anon, authenticated, service_role;

ALTER TABLE public.checklist_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_checklist_responses ON public.checklist_responses;
CREATE POLICY kinship_anon_all_checklist_responses ON public.checklist_responses
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.checklist_responses TO anon, authenticated, service_role;

ALTER TABLE public.client_attendance_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_client_attendance_log ON public.client_attendance_log;
CREATE POLICY kinship_anon_all_client_attendance_log ON public.client_attendance_log
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.client_attendance_log TO anon, authenticated, service_role;

ALTER TABLE public.compliance_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_compliance_assets ON public.compliance_assets;
CREATE POLICY kinship_anon_all_compliance_assets ON public.compliance_assets
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.compliance_assets TO anon, authenticated, service_role;

ALTER TABLE public.compliance_audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_compliance_audit_logs ON public.compliance_audit_logs;
CREATE POLICY kinship_anon_all_compliance_audit_logs ON public.compliance_audit_logs
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.compliance_audit_logs TO anon, authenticated, service_role;

ALTER TABLE public.event_activity_rolls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_event_activity_rolls ON public.event_activity_rolls;
CREATE POLICY kinship_anon_all_event_activity_rolls ON public.event_activity_rolls
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.event_activity_rolls TO anon, authenticated, service_role;

ALTER TABLE public.event_attendance_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_event_attendance_log ON public.event_attendance_log;
CREATE POLICY kinship_anon_all_event_attendance_log ON public.event_attendance_log
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.event_attendance_log TO anon, authenticated, service_role;

ALTER TABLE public.event_bus_manifest ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_event_bus_manifest ON public.event_bus_manifest;
CREATE POLICY kinship_anon_all_event_bus_manifest ON public.event_bus_manifest
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.event_bus_manifest TO anon, authenticated, service_role;

ALTER TABLE public.event_curfew_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_event_curfew_log ON public.event_curfew_log;
CREATE POLICY kinship_anon_all_event_curfew_log ON public.event_curfew_log
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.event_curfew_log TO anon, authenticated, service_role;

ALTER TABLE public.event_day_med_alternate_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_event_day_med_alternate_plans ON public.event_day_med_alternate_plans;
CREATE POLICY kinship_anon_all_event_day_med_alternate_plans ON public.event_day_med_alternate_plans
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.event_day_med_alternate_plans TO anon, authenticated, service_role;

ALTER TABLE public.event_day_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_event_day_sessions ON public.event_day_sessions;
CREATE POLICY kinship_anon_all_event_day_sessions ON public.event_day_sessions
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.event_day_sessions TO anon, authenticated, service_role;

ALTER TABLE public.event_financial_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_event_financial_ledger ON public.event_financial_ledger;
CREATE POLICY kinship_anon_all_event_financial_ledger ON public.event_financial_ledger
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.event_financial_ledger TO anon, authenticated, service_role;

ALTER TABLE public.event_manifest ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_event_manifest ON public.event_manifest;
CREATE POLICY kinship_anon_all_event_manifest ON public.event_manifest
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.event_manifest TO anon, authenticated, service_role;

ALTER TABLE public.event_meal_service_rolls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_event_meal_service_rolls ON public.event_meal_service_rolls;
CREATE POLICY kinship_anon_all_event_meal_service_rolls ON public.event_meal_service_rolls
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.event_meal_service_rolls TO anon, authenticated, service_role;

ALTER TABLE public.event_morning_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_event_morning_log ON public.event_morning_log;
CREATE POLICY kinship_anon_all_event_morning_log ON public.event_morning_log
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.event_morning_log TO anon, authenticated, service_role;

ALTER TABLE public.event_roster_bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_event_roster_bookings ON public.event_roster_bookings;
CREATE POLICY kinship_anon_all_event_roster_bookings ON public.event_roster_bookings
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.event_roster_bookings TO anon, authenticated, service_role;

ALTER TABLE public.event_venue_reconfirmations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_event_venue_reconfirmations ON public.event_venue_reconfirmations;
CREATE POLICY kinship_anon_all_event_venue_reconfirmations ON public.event_venue_reconfirmations
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.event_venue_reconfirmations TO anon, authenticated, service_role;

ALTER TABLE public.event_venue_stops ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_event_venue_stops ON public.event_venue_stops;
CREATE POLICY kinship_anon_all_event_venue_stops ON public.event_venue_stops
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.event_venue_stops TO anon, authenticated, service_role;

ALTER TABLE public.hub_issue_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_hub_issue_notes ON public.hub_issue_notes;
CREATE POLICY kinship_anon_all_hub_issue_notes ON public.hub_issue_notes
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.hub_issue_notes TO anon, authenticated, service_role;

ALTER TABLE public.maintenance_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_maintenance_items ON public.maintenance_items;
CREATE POLICY kinship_anon_all_maintenance_items ON public.maintenance_items
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.maintenance_items TO anon, authenticated, service_role;

ALTER TABLE public.maintenance_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_maintenance_notes ON public.maintenance_notes;
CREATE POLICY kinship_anon_all_maintenance_notes ON public.maintenance_notes
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.maintenance_notes TO anon, authenticated, service_role;

ALTER TABLE public.medication_administration_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_medication_administration_log ON public.medication_administration_log;
CREATE POLICY kinship_anon_all_medication_administration_log ON public.medication_administration_log
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.medication_administration_log TO anon, authenticated, service_role;

ALTER TABLE public.myob_export_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_myob_export_batches ON public.myob_export_batches;
CREATE POLICY kinship_anon_all_myob_export_batches ON public.myob_export_batches
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.myob_export_batches TO anon, authenticated, service_role;

ALTER TABLE public.offline_sync_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_offline_sync_logs ON public.offline_sync_logs;
CREATE POLICY kinship_anon_all_offline_sync_logs ON public.offline_sync_logs
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.offline_sync_logs TO anon, authenticated, service_role;

ALTER TABLE public.operational_escalations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_operational_escalations ON public.operational_escalations;
CREATE POLICY kinship_anon_all_operational_escalations ON public.operational_escalations
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.operational_escalations TO anon, authenticated, service_role;

ALTER TABLE public.operational_incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_operational_incidents ON public.operational_incidents;
CREATE POLICY kinship_anon_all_operational_incidents ON public.operational_incidents
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.operational_incidents TO anon, authenticated, service_role;

ALTER TABLE public.operational_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_operational_ledger ON public.operational_ledger;
CREATE POLICY kinship_anon_all_operational_ledger ON public.operational_ledger
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.operational_ledger TO anon, authenticated, service_role;

ALTER TABLE public.participant_attendance_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_participant_attendance_schedules ON public.participant_attendance_schedules;
CREATE POLICY kinship_anon_all_participant_attendance_schedules ON public.participant_attendance_schedules
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.participant_attendance_schedules TO anon, authenticated, service_role;

ALTER TABLE public.participant_compliance_and_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_participant_compliance_and_alerts ON public.participant_compliance_and_alerts;
CREATE POLICY kinship_anon_all_participant_compliance_and_alerts ON public.participant_compliance_and_alerts
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.participant_compliance_and_alerts TO anon, authenticated, service_role;

ALTER TABLE public.participant_financial_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_participant_financial_ledger ON public.participant_financial_ledger;
CREATE POLICY kinship_anon_all_participant_financial_ledger ON public.participant_financial_ledger
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.participant_financial_ledger TO anon, authenticated, service_role;

ALTER TABLE public.participant_infectious_exclusions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_participant_infectious_exclusions ON public.participant_infectious_exclusions;
CREATE POLICY kinship_anon_all_participant_infectious_exclusions ON public.participant_infectious_exclusions
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.participant_infectious_exclusions TO anon, authenticated, service_role;

ALTER TABLE public.participant_medication_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_participant_medication_schedules ON public.participant_medication_schedules;
CREATE POLICY kinship_anon_all_participant_medication_schedules ON public.participant_medication_schedules
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.participant_medication_schedules TO anon, authenticated, service_role;

ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_participants ON public.participants;
CREATE POLICY kinship_anon_all_participants ON public.participants
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.participants TO anon, authenticated, service_role;

ALTER TABLE public.site_day_activities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_site_day_activities ON public.site_day_activities;
CREATE POLICY kinship_anon_all_site_day_activities ON public.site_day_activities
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.site_day_activities TO anon, authenticated, service_role;

ALTER TABLE public.site_day_meal_service_rolls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_site_day_meal_service_rolls ON public.site_day_meal_service_rolls;
CREATE POLICY kinship_anon_all_site_day_meal_service_rolls ON public.site_day_meal_service_rolls
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.site_day_meal_service_rolls TO anon, authenticated, service_role;

ALTER TABLE public.site_day_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_site_day_sessions ON public.site_day_sessions;
CREATE POLICY kinship_anon_all_site_day_sessions ON public.site_day_sessions
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.site_day_sessions TO anon, authenticated, service_role;

ALTER TABLE public.site_day_visitors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_site_day_visitors ON public.site_day_visitors;
CREATE POLICY kinship_anon_all_site_day_visitors ON public.site_day_visitors
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.site_day_visitors TO anon, authenticated, service_role;

ALTER TABLE public.site_issues_register ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_site_issues_register ON public.site_issues_register;
CREATE POLICY kinship_anon_all_site_issues_register ON public.site_issues_register
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.site_issues_register TO anon, authenticated, service_role;

ALTER TABLE public.staff_compliance_and_certs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_staff_compliance_and_certs ON public.staff_compliance_and_certs;
CREATE POLICY kinship_anon_all_staff_compliance_and_certs ON public.staff_compliance_and_certs
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.staff_compliance_and_certs TO anon, authenticated, service_role;

ALTER TABLE public.staff_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_staff_registry ON public.staff_registry;
CREATE POLICY kinship_anon_all_staff_registry ON public.staff_registry
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.staff_registry TO anon, authenticated, service_role;

ALTER TABLE public.system_lookup_parameters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_system_lookup_parameters ON public.system_lookup_parameters;
CREATE POLICY kinship_anon_all_system_lookup_parameters ON public.system_lookup_parameters
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.system_lookup_parameters TO anon, authenticated, service_role;

ALTER TABLE public.system_operational_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_system_operational_settings ON public.system_operational_settings;
CREATE POLICY kinship_anon_all_system_operational_settings ON public.system_operational_settings
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.system_operational_settings TO anon, authenticated, service_role;

ALTER TABLE public.system_parameters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_system_parameters ON public.system_parameters;
CREATE POLICY kinship_anon_all_system_parameters ON public.system_parameters
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.system_parameters TO anon, authenticated, service_role;

ALTER TABLE public.transport_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_transport_assets ON public.transport_assets;
CREATE POLICY kinship_anon_all_transport_assets ON public.transport_assets
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.transport_assets TO anon, authenticated, service_role;

ALTER TABLE public.transport_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_transport_requests ON public.transport_requests;
CREATE POLICY kinship_anon_all_transport_requests ON public.transport_requests
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.transport_requests TO anon, authenticated, service_role;

ALTER TABLE public.transport_trips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_transport_trips ON public.transport_trips;
CREATE POLICY kinship_anon_all_transport_trips ON public.transport_trips
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.transport_trips TO anon, authenticated, service_role;

ALTER TABLE public.trip_legs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_trip_legs ON public.trip_legs;
CREATE POLICY kinship_anon_all_trip_legs ON public.trip_legs
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.trip_legs TO anon, authenticated, service_role;

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_vendors ON public.vendors;
CREATE POLICY kinship_anon_all_vendors ON public.vendors
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.vendors TO anon, authenticated, service_role;

ALTER TABLE public.venue_safety_answers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_venue_safety_answers ON public.venue_safety_answers;
CREATE POLICY kinship_anon_all_venue_safety_answers ON public.venue_safety_answers
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.venue_safety_answers TO anon, authenticated, service_role;

ALTER TABLE public.venue_safety_baseline_signoffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_venue_safety_baseline_signoffs ON public.venue_safety_baseline_signoffs;
CREATE POLICY kinship_anon_all_venue_safety_baseline_signoffs ON public.venue_safety_baseline_signoffs
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.venue_safety_baseline_signoffs TO anon, authenticated, service_role;

ALTER TABLE public.venue_template_fields ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_venue_template_fields ON public.venue_template_fields;
CREATE POLICY kinship_anon_all_venue_template_fields ON public.venue_template_fields
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.venue_template_fields TO anon, authenticated, service_role;

ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kinship_anon_all_venues ON public.venues;
CREATE POLICY kinship_anon_all_venues ON public.venues
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.venues TO anon, authenticated, service_role;

-- skipped (no OpenAPI definition):

