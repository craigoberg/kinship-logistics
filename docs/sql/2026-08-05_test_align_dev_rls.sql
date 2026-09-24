-- ============================================================================
-- 2026-08-05 — TEST: align RLS policies to DEV
--
-- SOURCE: docs/architecture/dev-schema-dumps/policies.csv
-- Drops ALL public policies then recreates DEV set.
-- Also ensures RLS enabled + table GRANTs for anon/authenticated.
-- ============================================================================

-- 1) Drop every existing public policy
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- 2) Enable RLS + grants
ALTER TABLE public.asset_checkpoints ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.asset_checkpoints TO anon, authenticated, service_role;
ALTER TABLE public.asset_clearance_items ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.asset_clearance_items TO anon, authenticated, service_role;
ALTER TABLE public.asset_daily_clearance ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.asset_daily_clearance TO anon, authenticated, service_role;
ALTER TABLE public.asset_maintenance_logs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.asset_maintenance_logs TO anon, authenticated, service_role;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.assets TO anon, authenticated, service_role;
ALTER TABLE public.attendance_roster_logs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.attendance_roster_logs TO anon, authenticated, service_role;
ALTER TABLE public.carers_registry ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.carers_registry TO anon, authenticated, service_role;
ALTER TABLE public.centre_operating_hours ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.centre_operating_hours TO anon, authenticated, service_role;
ALTER TABLE public.charge_codes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.charge_codes TO anon, authenticated, service_role;
ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.checklist_items TO anon, authenticated, service_role;
ALTER TABLE public.checklist_responses ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.checklist_responses TO anon, authenticated, service_role;
ALTER TABLE public.client_attendance_log ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.client_attendance_log TO anon, authenticated, service_role;
ALTER TABLE public.compliance_assets ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.compliance_assets TO anon, authenticated, service_role;
ALTER TABLE public.compliance_audit_logs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.compliance_audit_logs TO anon, authenticated, service_role;
ALTER TABLE public.event_activity_rolls ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.event_activity_rolls TO anon, authenticated, service_role;
ALTER TABLE public.event_attendance_log ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.event_attendance_log TO anon, authenticated, service_role;
ALTER TABLE public.event_bus_manifest ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.event_bus_manifest TO anon, authenticated, service_role;
ALTER TABLE public.event_curfew_log ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.event_curfew_log TO anon, authenticated, service_role;
ALTER TABLE public.event_day_med_alternate_plans ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.event_day_med_alternate_plans TO anon, authenticated, service_role;
ALTER TABLE public.event_day_sessions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.event_day_sessions TO anon, authenticated, service_role;
ALTER TABLE public.event_financial_ledger ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.event_financial_ledger TO anon, authenticated, service_role;
ALTER TABLE public.event_manifest ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.event_manifest TO anon, authenticated, service_role;
ALTER TABLE public.event_meal_service_rolls ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.event_meal_service_rolls TO anon, authenticated, service_role;
ALTER TABLE public.event_morning_log ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.event_morning_log TO anon, authenticated, service_role;
ALTER TABLE public.event_roster_bookings ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.event_roster_bookings TO anon, authenticated, service_role;
ALTER TABLE public.event_venue_reconfirmations ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.event_venue_reconfirmations TO anon, authenticated, service_role;
ALTER TABLE public.event_venue_stops ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.event_venue_stops TO anon, authenticated, service_role;
ALTER TABLE public.hub_issue_notes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.hub_issue_notes TO anon, authenticated, service_role;
ALTER TABLE public.maintenance_items ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.maintenance_items TO anon, authenticated, service_role;
ALTER TABLE public.maintenance_notes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.maintenance_notes TO anon, authenticated, service_role;
ALTER TABLE public.medication_administration_log ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.medication_administration_log TO anon, authenticated, service_role;
ALTER TABLE public.offline_sync_logs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.offline_sync_logs TO anon, authenticated, service_role;
ALTER TABLE public.operational_emergencies ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.operational_emergencies TO anon, authenticated, service_role;
ALTER TABLE public.operational_emergency_muster ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.operational_emergency_muster TO anon, authenticated, service_role;
ALTER TABLE public.operational_escalations ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.operational_escalations TO anon, authenticated, service_role;
ALTER TABLE public.operational_incidents ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.operational_incidents TO anon, authenticated, service_role;
ALTER TABLE public.operational_ledger ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.operational_ledger TO anon, authenticated, service_role;
ALTER TABLE public.participant_attendance_schedules ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.participant_attendance_schedules TO anon, authenticated, service_role;
ALTER TABLE public.participant_compliance_and_alerts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.participant_compliance_and_alerts TO anon, authenticated, service_role;
ALTER TABLE public.participant_financial_ledger ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.participant_financial_ledger TO anon, authenticated, service_role;
ALTER TABLE public.participant_infectious_exclusions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.participant_infectious_exclusions TO anon, authenticated, service_role;
ALTER TABLE public.participant_medication_schedules ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.participant_medication_schedules TO anon, authenticated, service_role;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.participants TO anon, authenticated, service_role;
ALTER TABLE public.site_day_activities ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.site_day_activities TO anon, authenticated, service_role;
ALTER TABLE public.site_day_meal_service_rolls ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.site_day_meal_service_rolls TO anon, authenticated, service_role;
ALTER TABLE public.site_day_sessions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.site_day_sessions TO anon, authenticated, service_role;
ALTER TABLE public.site_day_visitors ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.site_day_visitors TO anon, authenticated, service_role;
ALTER TABLE public.site_issues_register ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.site_issues_register TO anon, authenticated, service_role;
ALTER TABLE public.staff_compliance_and_certs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.staff_compliance_and_certs TO anon, authenticated, service_role;
ALTER TABLE public.staff_registry ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.staff_registry TO anon, authenticated, service_role;
ALTER TABLE public.system_lookup_parameters ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.system_lookup_parameters TO anon, authenticated, service_role;
ALTER TABLE public.system_operational_settings ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.system_operational_settings TO anon, authenticated, service_role;
ALTER TABLE public.system_parameters ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.system_parameters TO anon, authenticated, service_role;
ALTER TABLE public.transport_assets ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.transport_assets TO anon, authenticated, service_role;
ALTER TABLE public.transport_requests ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.transport_requests TO anon, authenticated, service_role;
ALTER TABLE public.transport_trips ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.transport_trips TO anon, authenticated, service_role;
ALTER TABLE public.trip_legs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.trip_legs TO anon, authenticated, service_role;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.vendors TO anon, authenticated, service_role;
ALTER TABLE public.venue_safety_answers ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.venue_safety_answers TO anon, authenticated, service_role;
ALTER TABLE public.venue_safety_baseline_signoffs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.venue_safety_baseline_signoffs TO anon, authenticated, service_role;
ALTER TABLE public.venue_template_fields ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.venue_template_fields TO anon, authenticated, service_role;
ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.venues TO anon, authenticated, service_role;

-- 3) DEV policies
CREATE POLICY "Allow authenticated select checkpoints" ON public.asset_checkpoints
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "Allow all access to clearance items" ON public.asset_clearance_items
  AS PERMISSIVE
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "asset_daily_clearance readable" ON public.asset_daily_clearance
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "asset_daily_clearance updatable" ON public.asset_daily_clearance
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "asset_daily_clearance writable" ON public.asset_daily_clearance
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "asset_maintenance_logs readable" ON public.asset_maintenance_logs
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "asset_maintenance_logs updatable" ON public.asset_maintenance_logs
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "asset_maintenance_logs writable" ON public.asset_maintenance_logs
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "assets readable" ON public.assets
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "assets updatable" ON public.assets
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "assets writable" ON public.assets
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "attendance_roster_logs readable" ON public.attendance_roster_logs
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "attendance_roster_logs updatable" ON public.attendance_roster_logs
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "attendance_roster_logs writable" ON public.attendance_roster_logs
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "carers_registry readable" ON public.carers_registry
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "carers_registry updatable" ON public.carers_registry
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "carers_registry writable" ON public.carers_registry
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "centre_operating_hours readable" ON public.centre_operating_hours
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "centre_operating_hours updatable" ON public.centre_operating_hours
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "centre_operating_hours writable" ON public.centre_operating_hours
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (true)
;

CREATE POLICY "charge_codes readable" ON public.charge_codes
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "charge_codes updatable" ON public.charge_codes
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "charge_codes writable" ON public.charge_codes
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "checklist_items_read" ON public.checklist_items
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "checklist_responses_insert" ON public.checklist_responses
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "checklist_responses_read" ON public.checklist_responses
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "client_attendance_log readable" ON public.client_attendance_log
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "client_attendance_log updatable" ON public.client_attendance_log
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "client_attendance_log writable" ON public.client_attendance_log
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "compliance_assets readable by all" ON public.compliance_assets
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "compliance_assets writable" ON public.compliance_assets
  AS PERMISSIVE
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "compliance_audit_logs readable" ON public.compliance_audit_logs
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "compliance_audit_logs updatable" ON public.compliance_audit_logs
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "compliance_audit_logs writable" ON public.compliance_audit_logs
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "anon_delete_event_activity_rolls" ON public.event_activity_rolls
  AS PERMISSIVE
  FOR DELETE
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "anon_insert_event_activity_rolls" ON public.event_activity_rolls
  AS PERMISSIVE
  FOR INSERT
  TO anon
  WITH CHECK (true)
;

CREATE POLICY "anon_read_event_activity_rolls" ON public.event_activity_rolls
  AS PERMISSIVE
  FOR SELECT
  TO anon
  USING (true)
;

CREATE POLICY "anon_update_event_activity_rolls" ON public.event_activity_rolls
  AS PERMISSIVE
  FOR UPDATE
  TO anon
  USING (true)
;

CREATE POLICY "event_attendance_log deletable" ON public.event_attendance_log
  AS PERMISSIVE
  FOR DELETE
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "event_attendance_log readable" ON public.event_attendance_log
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "event_attendance_log updatable" ON public.event_attendance_log
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "event_attendance_log writable" ON public.event_attendance_log
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "event_bus_manifest deletable" ON public.event_bus_manifest
  AS PERMISSIVE
  FOR DELETE
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "event_bus_manifest readable" ON public.event_bus_manifest
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "event_bus_manifest updatable" ON public.event_bus_manifest
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "event_bus_manifest writable" ON public.event_bus_manifest
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "event_curfew_log deletable" ON public.event_curfew_log
  AS PERMISSIVE
  FOR DELETE
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "event_curfew_log readable" ON public.event_curfew_log
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "event_curfew_log updatable" ON public.event_curfew_log
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "event_curfew_log writable" ON public.event_curfew_log
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "anon_all_event_day_med_alternate_plans" ON public.event_day_med_alternate_plans
  AS PERMISSIVE
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "anon_update_event_day_sessions" ON public.event_day_sessions
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "event_day_sessions deletable" ON public.event_day_sessions
  AS PERMISSIVE
  FOR DELETE
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "event_day_sessions readable" ON public.event_day_sessions
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "event_day_sessions updatable" ON public.event_day_sessions
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "event_day_sessions writable" ON public.event_day_sessions
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "event_financial_ledger readable" ON public.event_financial_ledger
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "event_financial_ledger updatable" ON public.event_financial_ledger
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "event_financial_ledger writable" ON public.event_financial_ledger
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "event_manifest readable" ON public.event_manifest
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "event_manifest updatable" ON public.event_manifest
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "event_manifest writable" ON public.event_manifest
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "anon_all_event_meal_service_rolls" ON public.event_meal_service_rolls
  AS PERMISSIVE
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "event_morning_log deletable" ON public.event_morning_log
  AS PERMISSIVE
  FOR DELETE
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "event_morning_log readable" ON public.event_morning_log
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "event_morning_log updatable" ON public.event_morning_log
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "event_morning_log writable" ON public.event_morning_log
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "event_roster_bookings readable" ON public.event_roster_bookings
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "event_roster_bookings updatable" ON public.event_roster_bookings
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "event_roster_bookings writable" ON public.event_roster_bookings
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "event_venue_reconfirmations deletable" ON public.event_venue_reconfirmations
  AS PERMISSIVE
  FOR DELETE
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "event_venue_reconfirmations readable" ON public.event_venue_reconfirmations
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "event_venue_reconfirmations updatable" ON public.event_venue_reconfirmations
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "event_venue_reconfirmations writable" ON public.event_venue_reconfirmations
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "event_venue_stops deletable" ON public.event_venue_stops
  AS PERMISSIVE
  FOR DELETE
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "event_venue_stops readable" ON public.event_venue_stops
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "event_venue_stops updatable" ON public.event_venue_stops
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "event_venue_stops writable" ON public.event_venue_stops
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "hub_issue_notes_insert" ON public.hub_issue_notes
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "hub_issue_notes_select" ON public.hub_issue_notes
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "anon_maintenance_items_all" ON public.maintenance_items
  AS PERMISSIVE
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "authenticated_maintenance_items_all" ON public.maintenance_items
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "anon_maintenance_notes_all" ON public.maintenance_notes
  AS PERMISSIVE
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "authenticated_maintenance_notes_all" ON public.maintenance_notes
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "medication_administration_log readable" ON public.medication_administration_log
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "medication_administration_log updatable" ON public.medication_administration_log
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "medication_administration_log writable" ON public.medication_administration_log
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "offline_sync_logs readable" ON public.offline_sync_logs
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "offline_sync_logs updatable" ON public.offline_sync_logs
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "offline_sync_logs writable" ON public.offline_sync_logs
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "op_emergencies_anon_all" ON public.operational_emergencies
  AS PERMISSIVE
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "op_emergency_muster_anon_all" ON public.operational_emergency_muster
  AS PERMISSIVE
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "global_public_policy" ON public.operational_escalations
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "incidents_insert_all" ON public.operational_incidents
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "incidents_read_all" ON public.operational_incidents
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "incidents_update_all" ON public.operational_incidents
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "ledger_insert_all" ON public.operational_ledger
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "ledger_read_all" ON public.operational_ledger
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "participant_attendance_schedules readable" ON public.participant_attendance_schedules
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "participant_attendance_schedules updatable" ON public.participant_attendance_schedules
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "participant_attendance_schedules writable" ON public.participant_attendance_schedules
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "participant_compliance_and_alerts readable" ON public.participant_compliance_and_alerts
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "participant_compliance_and_alerts updatable" ON public.participant_compliance_and_alerts
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "participant_compliance_and_alerts writable" ON public.participant_compliance_and_alerts
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "participant_financial_ledger readable" ON public.participant_financial_ledger
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "participant_financial_ledger updatable" ON public.participant_financial_ledger
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "participant_financial_ledger writable" ON public.participant_financial_ledger
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "infectious_exclusions_anon_all" ON public.participant_infectious_exclusions
  AS PERMISSIVE
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "participant_medication_schedules readable" ON public.participant_medication_schedules
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "participant_medication_schedules updatable" ON public.participant_medication_schedules
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "participant_medication_schedules writable" ON public.participant_medication_schedules
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "participants readable" ON public.participants
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "participants updatable" ON public.participants
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "participants writable" ON public.participants
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "kinship_anon_all_site_day_activities" ON public.site_day_activities
  AS PERMISSIVE
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "kinship_anon_all_site_day_meal_service_rolls" ON public.site_day_meal_service_rolls
  AS PERMISSIVE
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "Allow authenticated changes" ON public.site_day_sessions
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (true)
;

CREATE POLICY "Allow authenticated read access" ON public.site_day_sessions
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true)
;

CREATE POLICY "Universal access policy" ON public.site_day_sessions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "site_day_visitors deletable" ON public.site_day_visitors
  AS PERMISSIVE
  FOR DELETE
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "site_day_visitors readable" ON public.site_day_visitors
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "site_day_visitors updatable" ON public.site_day_visitors
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "site_day_visitors writable" ON public.site_day_visitors
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "sir_delete_all" ON public.site_issues_register
  AS PERMISSIVE
  FOR DELETE
  TO anon, authenticated, service_role
  USING (true)
;

CREATE POLICY "sir_insert_all" ON public.site_issues_register
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated, service_role
  WITH CHECK (true)
;

CREATE POLICY "sir_select_all" ON public.site_issues_register
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated, service_role
  USING (true)
;

CREATE POLICY "sir_update_all" ON public.site_issues_register
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated, service_role
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "staff_compliance_and_certs readable" ON public.staff_compliance_and_certs
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "staff_compliance_and_certs updatable" ON public.staff_compliance_and_certs
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "staff_compliance_and_certs writable" ON public.staff_compliance_and_certs
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "Universal access policy" ON public.staff_registry
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "system_lookup_parameters readable" ON public.system_lookup_parameters
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "system_lookup_parameters updatable" ON public.system_lookup_parameters
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "system_lookup_parameters writable" ON public.system_lookup_parameters
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "Enable all operations for settings" ON public.system_operational_settings
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "system_parameters readable by all" ON public.system_parameters
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "system_parameters updatable" ON public.system_parameters
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "transport_assets readable" ON public.transport_assets
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "transport_assets updatable" ON public.transport_assets
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "transport_assets writable" ON public.transport_assets
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "transport_requests authenticated all" ON public.transport_requests
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "transport_trips deletable" ON public.transport_trips
  AS PERMISSIVE
  FOR DELETE
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "transport_trips readable" ON public.transport_trips
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "transport_trips updatable" ON public.transport_trips
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "transport_trips writable" ON public.transport_trips
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "trip_legs readable" ON public.trip_legs
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "trip_legs updatable" ON public.trip_legs
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "trip_legs writable" ON public.trip_legs
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "vendors readable" ON public.vendors
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "vendors updatable" ON public.vendors
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "vendors writable" ON public.vendors
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "venue_safety_answers deletable" ON public.venue_safety_answers
  AS PERMISSIVE
  FOR DELETE
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "venue_safety_answers readable" ON public.venue_safety_answers
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "venue_safety_answers updatable" ON public.venue_safety_answers
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "venue_safety_answers writable" ON public.venue_safety_answers
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "venue_safety_baseline_signoffs deletable" ON public.venue_safety_baseline_signoffs
  AS PERMISSIVE
  FOR DELETE
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "venue_safety_baseline_signoffs readable" ON public.venue_safety_baseline_signoffs
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "venue_safety_baseline_signoffs updatable" ON public.venue_safety_baseline_signoffs
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "venue_safety_baseline_signoffs writable" ON public.venue_safety_baseline_signoffs
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "venue_template_fields deletable" ON public.venue_template_fields
  AS PERMISSIVE
  FOR DELETE
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "venue_template_fields readable" ON public.venue_template_fields
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "venue_template_fields updatable" ON public.venue_template_fields
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "venue_template_fields writable" ON public.venue_template_fields
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

CREATE POLICY "venues deletable" ON public.venues
  AS PERMISSIVE
  FOR DELETE
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "venues readable" ON public.venues
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true)
;

CREATE POLICY "venues updatable" ON public.venues
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true)
;

CREATE POLICY "venues writable" ON public.venues
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true)
;

-- VALIDATION
-- SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
-- DEV baseline: 167
--
-- Spot-check PIN-critical:
-- SELECT tablename, policyname, roles, cmd FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('staff_registry','site_day_sessions','transport_trips','verify' )
-- ORDER BY 1,2;
