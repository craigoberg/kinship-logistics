-- ============================================================================
-- 2026-08-05 - TEST: align public constraints + indexes to DEV
--
-- SOURCE: DEV catalog dumps in docs/architecture/dev-schema-dumps/
--   constraints.json  (pg_constraint + pg_get_constraintdef)
--   indexes.json      (pg_indexes)
--
-- APPLIES: CHECK / UNIQUE / FOREIGN KEY (skip PRIMARY KEY - bootstrap already has PKs)
--          + non-constraint indexes (partial uniques, btree helpers)
-- SAFE: idempotent (IF NOT EXISTS / pg_constraint name checks)
-- FKs: added NOT VALID so orphan rows do not abort the script; VALIDATE at end
--      (NOT VALID still enforces on new writes).
--
-- After run: Success / No rows returned is normal for DDL.
-- Use validation queries at bottom (expect row counts).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1) CHECK + UNIQUE constraints
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_checkpoints_impact_level_check'
      AND conrelid = 'public.asset_checkpoints'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.asset_checkpoints
        ADD CONSTRAINT asset_checkpoints_impact_level_check CHECK (impact_level = ANY (ARRAY['critical_no_go'::text, 'conditional_warning'::text, 'minor_log_only'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'asset_checkpoints_impact_level_check', 'asset_checkpoints', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_checkpoints_vehicle_category_check'
      AND conrelid = 'public.asset_checkpoints'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.asset_checkpoints
        ADD CONSTRAINT asset_checkpoints_vehicle_category_check CHECK (vehicle_category = ANY (ARRAY['all'::text, 'bus'::text, 'van'::text, 'sedan'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'asset_checkpoints_vehicle_category_check', 'asset_checkpoints', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_clearance_items_severity_check'
      AND conrelid = 'public.asset_clearance_items'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.asset_clearance_items
        ADD CONSTRAINT asset_clearance_items_severity_check CHECK (severity = ANY (ARRAY['green'::text, 'yellow'::text, 'red'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'asset_clearance_items_severity_check', 'asset_clearance_items', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_daily_clearance_status_check'
      AND conrelid = 'public.asset_daily_clearance'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.asset_daily_clearance
        ADD CONSTRAINT asset_daily_clearance_status_check CHECK (status = ANY (ARRAY['passed'::text, 'failed'::text, 'awaiting_manager_review'::text, 'authorized_override'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'asset_daily_clearance_status_check', 'asset_daily_clearance', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'unique_asset_daily_clearance'
      AND conrelid = 'public.asset_daily_clearance'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.asset_daily_clearance
        ADD CONSTRAINT unique_asset_daily_clearance UNIQUE (asset_id, clearance_date);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'unique_asset_daily_clearance', 'asset_daily_clearance', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'attendance_roster_logs_billing_state_check'
      AND conrelid = 'public.attendance_roster_logs'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.attendance_roster_logs
        ADD CONSTRAINT attendance_roster_logs_billing_state_check CHECK (billing_state = ANY (ARRAY['pending'::text, 'audited_ready_for_billing'::text, 'exported'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'attendance_roster_logs_billing_state_check', 'attendance_roster_logs', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'centre_operating_hours_day_of_week_check'
      AND conrelid = 'public.centre_operating_hours'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.centre_operating_hours
        ADD CONSTRAINT centre_operating_hours_day_of_week_check CHECK (day_of_week = ANY (ARRAY['DAY-MON'::text, 'DAY-TUE'::text, 'DAY-WED'::text, 'DAY-THU'::text, 'DAY-FRI'::text, 'DAY-SAT'::text, 'DAY-SUN'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'centre_operating_hours_day_of_week_check', 'centre_operating_hours', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'charge_codes_code_key'
      AND conrelid = 'public.charge_codes'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.charge_codes
        ADD CONSTRAINT charge_codes_code_key UNIQUE (code);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'charge_codes_code_key', 'charge_codes', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checklist_responses_status_check'
      AND conrelid = 'public.checklist_responses'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.checklist_responses
        ADD CONSTRAINT checklist_responses_status_check CHECK (status = ANY (ARRAY['pass'::text, 'fail'::text, 'na'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'checklist_responses_status_check', 'checklist_responses', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_attendance_log_arrival_method_check'
      AND conrelid = 'public.client_attendance_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.client_attendance_log
        ADD CONSTRAINT client_attendance_log_arrival_method_check CHECK (arrival_method = ANY (ARRAY['bus'::text, 'private'::text, 'walk_in'::text, 'other'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'client_attendance_log_arrival_method_check', 'client_attendance_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_attendance_log_departure_severity_check'
      AND conrelid = 'public.client_attendance_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.client_attendance_log
        ADD CONSTRAINT client_attendance_log_departure_severity_check CHECK (departure_severity = ANY (ARRAY['yellow'::text, 'red'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'client_attendance_log_departure_severity_check', 'client_attendance_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_attendance_log_escalation_severity_check'
      AND conrelid = 'public.client_attendance_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.client_attendance_log
        ADD CONSTRAINT client_attendance_log_escalation_severity_check CHECK (escalation_severity = ANY (ARRAY['yellow'::text, 'red'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'client_attendance_log_escalation_severity_check', 'client_attendance_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_attendance_log_status_check'
      AND conrelid = 'public.client_attendance_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.client_attendance_log
        ADD CONSTRAINT client_attendance_log_status_check CHECK (status = ANY (ARRAY['expected'::text, 'checked_in'::text, 'checked_out'::text, 'absent'::text, 'accounted'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'client_attendance_log_status_check', 'client_attendance_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_attendance_log_session_id_participant_id_key'
      AND conrelid = 'public.client_attendance_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.client_attendance_log
        ADD CONSTRAINT client_attendance_log_session_id_participant_id_key UNIQUE (session_id, participant_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'client_attendance_log_session_id_participant_id_key', 'client_attendance_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'compliance_assets_status_check'
      AND conrelid = 'public.compliance_assets'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.compliance_assets
        ADD CONSTRAINT compliance_assets_status_check CHECK (status = ANY (ARRAY['active'::text, 'archived'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'compliance_assets_status_check', 'compliance_assets', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_activity_rolls_status_check'
      AND conrelid = 'public.event_activity_rolls'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_activity_rolls
        ADD CONSTRAINT event_activity_rolls_status_check CHECK (status = ANY (ARRAY['expected'::text, 'checked_in'::text, 'absent'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_activity_rolls_status_check', 'event_activity_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_activity_rolls_unique_person_per_stop'
      AND conrelid = 'public.event_activity_rolls'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_activity_rolls
        ADD CONSTRAINT event_activity_rolls_unique_person_per_stop UNIQUE (venue_stop_id, participant_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_activity_rolls_unique_person_per_stop', 'event_activity_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_attendance_log_arrival_method_check'
      AND conrelid = 'public.event_attendance_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_attendance_log
        ADD CONSTRAINT event_attendance_log_arrival_method_check CHECK (arrival_method = ANY (ARRAY['bus'::text, 'private'::text, 'walk_in'::text, 'other'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_attendance_log_arrival_method_check', 'event_attendance_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_attendance_log_escalation_severity_check'
      AND conrelid = 'public.event_attendance_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_attendance_log
        ADD CONSTRAINT event_attendance_log_escalation_severity_check CHECK (escalation_severity = ANY (ARRAY['yellow'::text, 'red'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_attendance_log_escalation_severity_check', 'event_attendance_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_attendance_log_return_transport_check'
      AND conrelid = 'public.event_attendance_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_attendance_log
        ADD CONSTRAINT event_attendance_log_return_transport_check CHECK (return_transport = ANY (ARRAY['bus'::text, 'self'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_attendance_log_return_transport_check', 'event_attendance_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_attendance_log_status_check'
      AND conrelid = 'public.event_attendance_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_attendance_log
        ADD CONSTRAINT event_attendance_log_status_check CHECK (status = ANY (ARRAY['expected'::text, 'checked_in'::text, 'checked_out'::text, 'absent'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_attendance_log_status_check', 'event_attendance_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_attendance_log_event_day_session_id_participant_id_key'
      AND conrelid = 'public.event_attendance_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_attendance_log
        ADD CONSTRAINT event_attendance_log_event_day_session_id_participant_id_key UNIQUE (event_day_session_id, participant_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_attendance_log_event_day_session_id_participant_id_key', 'event_attendance_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_bus_manifest_check'
      AND conrelid = 'public.event_bus_manifest'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_bus_manifest
        ADD CONSTRAINT event_bus_manifest_check CHECK (participant_id IS NOT NULL OR carer_id IS NOT NULL);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_bus_manifest_check', 'event_bus_manifest', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_bus_manifest_status_check'
      AND conrelid = 'public.event_bus_manifest'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_bus_manifest
        ADD CONSTRAINT event_bus_manifest_status_check CHECK (status = ANY (ARRAY['expected'::text, 'on_bus'::text, 'not_travelling'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_bus_manifest_status_check', 'event_bus_manifest', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_curfew_log_escalation_severity_check'
      AND conrelid = 'public.event_curfew_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_curfew_log
        ADD CONSTRAINT event_curfew_log_escalation_severity_check CHECK (escalation_severity = ANY (ARRAY['yellow'::text, 'red'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_curfew_log_escalation_severity_check', 'event_curfew_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_curfew_log_status_check'
      AND conrelid = 'public.event_curfew_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_curfew_log
        ADD CONSTRAINT event_curfew_log_status_check CHECK (status = ANY (ARRAY['expected'::text, 'accounted'::text, 'absent'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_curfew_log_status_check', 'event_curfew_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_curfew_log_event_day_session_id_participant_id_key'
      AND conrelid = 'public.event_curfew_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_curfew_log
        ADD CONSTRAINT event_curfew_log_event_day_session_id_participant_id_key UNIQUE (event_day_session_id, participant_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_curfew_log_event_day_session_id_participant_id_key', 'event_curfew_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_day_med_alternate_plans_event_day_session_id_particip_key'
      AND conrelid = 'public.event_day_med_alternate_plans'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_day_med_alternate_plans
        ADD CONSTRAINT event_day_med_alternate_plans_event_day_session_id_particip_key UNIQUE (event_day_session_id, participant_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_day_med_alternate_plans_event_day_session_id_particip_key', 'event_day_med_alternate_plans', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_day_sessions_phase_check'
      AND conrelid = 'public.event_day_sessions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_day_sessions
        ADD CONSTRAINT event_day_sessions_phase_check CHECK (phase = ANY (ARRAY['planning'::text, 'pre_departure'::text, 'active'::text, 'in_transit'::text, 'at_base'::text, 'closed_orderly'::text, 'closed_incident'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_day_sessions_phase_check', 'event_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_day_sessions_programme_suspend_severity_check'
      AND conrelid = 'public.event_day_sessions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_day_sessions
        ADD CONSTRAINT event_day_sessions_programme_suspend_severity_check CHECK (programme_suspend_severity IS NULL OR (programme_suspend_severity = ANY (ARRAY['yellow'::text, 'red'::text])));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_day_sessions_programme_suspend_severity_check', 'event_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_day_sessions_event_id_session_date_key'
      AND conrelid = 'public.event_day_sessions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_day_sessions
        ADD CONSTRAINT event_day_sessions_event_id_session_date_key UNIQUE (event_id, session_date);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_day_sessions_event_id_session_date_key', 'event_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_manifest_event_kind_check'
      AND conrelid = 'public.event_manifest'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_manifest
        ADD CONSTRAINT event_manifest_event_kind_check CHECK (event_kind = ANY (ARRAY['legacy'::text, 'single_day_outing'::text, 'multi_day_tour'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_manifest_event_kind_check', 'event_manifest', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_meal_service_rolls_status_check'
      AND conrelid = 'public.event_meal_service_rolls'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_meal_service_rolls
        ADD CONSTRAINT event_meal_service_rolls_status_check CHECK (status = ANY (ARRAY['expected'::text, 'served'::text, 'modified'::text, 'own_order'::text, 'declined'::text, 'na'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_meal_service_rolls_status_check', 'event_meal_service_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_meal_service_rolls_venue_stop_id_participant_id_key'
      AND conrelid = 'public.event_meal_service_rolls'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_meal_service_rolls
        ADD CONSTRAINT event_meal_service_rolls_venue_stop_id_participant_id_key UNIQUE (venue_stop_id, participant_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_meal_service_rolls_venue_stop_id_participant_id_key', 'event_meal_service_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_morning_log_escalation_severity_check'
      AND conrelid = 'public.event_morning_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_morning_log
        ADD CONSTRAINT event_morning_log_escalation_severity_check CHECK (escalation_severity = ANY (ARRAY['yellow'::text, 'red'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_morning_log_escalation_severity_check', 'event_morning_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_morning_log_status_check'
      AND conrelid = 'public.event_morning_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_morning_log
        ADD CONSTRAINT event_morning_log_status_check CHECK (status = ANY (ARRAY['expected'::text, 'accounted'::text, 'absent'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_morning_log_status_check', 'event_morning_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_morning_log_event_day_session_id_participant_id_key'
      AND conrelid = 'public.event_morning_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_morning_log
        ADD CONSTRAINT event_morning_log_event_day_session_id_participant_id_key UNIQUE (event_day_session_id, participant_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_morning_log_event_day_session_id_participant_id_key', 'event_morning_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_roster_bookings_outbound_transport_mode_check'
      AND conrelid = 'public.event_roster_bookings'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_roster_bookings
        ADD CONSTRAINT event_roster_bookings_outbound_transport_mode_check CHECK (outbound_transport_mode = ANY (ARRAY['bus'::text, 'self'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_roster_bookings_outbound_transport_mode_check', 'event_roster_bookings', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_roster_bookings_return_transport_mode_check'
      AND conrelid = 'public.event_roster_bookings'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_roster_bookings
        ADD CONSTRAINT event_roster_bookings_return_transport_mode_check CHECK (return_transport_mode = ANY (ARRAY['bus'::text, 'self'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_roster_bookings_return_transport_mode_check', 'event_roster_bookings', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_roster_bookings_transport_med_bag_required_check'
      AND conrelid = 'public.event_roster_bookings'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_roster_bookings
        ADD CONSTRAINT event_roster_bookings_transport_med_bag_required_check CHECK (transport_med_bag_required = ANY (ARRAY['yes'::text, 'no'::text, 'not_set'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_roster_bookings_transport_med_bag_required_check', 'event_roster_bookings', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_roster_bookings_event_id_participant_id_key'
      AND conrelid = 'public.event_roster_bookings'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_roster_bookings
        ADD CONSTRAINT event_roster_bookings_event_id_participant_id_key UNIQUE (event_id, participant_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_roster_bookings_event_id_participant_id_key', 'event_roster_bookings', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_reconfirmations_event_id_venue_id_key'
      AND conrelid = 'public.event_venue_reconfirmations'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_reconfirmations
        ADD CONSTRAINT event_venue_reconfirmations_event_id_venue_id_key UNIQUE (event_id, venue_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_venue_reconfirmations_event_id_venue_id_key', 'event_venue_reconfirmations', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_activity_kind_check'
      AND conrelid = 'public.event_venue_stops'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_stops
        ADD CONSTRAINT event_venue_stops_activity_kind_check CHECK (activity_kind = ANY (ARRAY['venue'::text, 'meal'::text, 'medication_round'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_venue_stops_activity_kind_check', 'event_venue_stops', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_meal_slot_check'
      AND conrelid = 'public.event_venue_stops'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_stops
        ADD CONSTRAINT event_venue_stops_meal_slot_check CHECK (meal_slot IS NULL OR (meal_slot = ANY (ARRAY['breakfast'::text, 'morning_tea'::text, 'lunch'::text, 'dinner'::text])));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_venue_stops_meal_slot_check', 'event_venue_stops', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_meal_source_check'
      AND conrelid = 'public.event_venue_stops'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_stops
        ADD CONSTRAINT event_venue_stops_meal_source_check CHECK (meal_source IS NULL OR (meal_source = ANY (ARRAY['delivered_by_us'::text, 'own_food'::text, 'venue_provided'::text, 'packed'::text, 'purchase'::text])));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_venue_stops_meal_source_check', 'event_venue_stops', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_movement_method_check'
      AND conrelid = 'public.event_venue_stops'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_stops
        ADD CONSTRAINT event_venue_stops_movement_method_check CHECK (movement_method = ANY (ARRAY['bus'::text, 'walk'::text, 'on_site'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_venue_stops_movement_method_check', 'event_venue_stops', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_phase_check'
      AND conrelid = 'public.event_venue_stops'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_stops
        ADD CONSTRAINT event_venue_stops_phase_check CHECK (phase = ANY (ARRAY['pending'::text, 'active'::text, 'completed'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_venue_stops_phase_check', 'event_venue_stops', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_prep_attestation_mode_check'
      AND conrelid = 'public.event_venue_stops'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_stops
        ADD CONSTRAINT event_venue_stops_prep_attestation_mode_check CHECK (prep_attestation_mode IS NULL OR (prep_attestation_mode = ANY (ARRAY['preparer_pin'::text, 'manager_guest_override'::text])));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_venue_stops_prep_attestation_mode_check', 'event_venue_stops', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_preparer_cert_status_check'
      AND conrelid = 'public.event_venue_stops'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_stops
        ADD CONSTRAINT event_venue_stops_preparer_cert_status_check CHECK (preparer_cert_status IS NULL OR (preparer_cert_status = ANY (ARRAY['ok'::text, 'warn_missing'::text, 'warn_expired'::text, 'na'::text])));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_venue_stops_preparer_cert_status_check', 'event_venue_stops', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_stop_order_check'
      AND conrelid = 'public.event_venue_stops'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_stops
        ADD CONSTRAINT event_venue_stops_stop_order_check CHECK (stop_order >= 0);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_venue_stops_stop_order_check', 'event_venue_stops', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_event_id_session_date_stop_order_key'
      AND conrelid = 'public.event_venue_stops'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_stops
        ADD CONSTRAINT event_venue_stops_event_id_session_date_stop_order_key UNIQUE (event_id, session_date, stop_order);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'event_venue_stops_event_id_session_date_stop_order_key', 'event_venue_stops', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hub_issue_notes_kind_check'
      AND conrelid = 'public.hub_issue_notes'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.hub_issue_notes
        ADD CONSTRAINT hub_issue_notes_kind_check CHECK (kind = ANY (ARRAY['append'::text, 'defer'::text, 'escalate'::text, 'resolve'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'hub_issue_notes_kind_check', 'hub_issue_notes', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hub_issue_notes_source_check'
      AND conrelid = 'public.hub_issue_notes'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.hub_issue_notes
        ADD CONSTRAINT hub_issue_notes_source_check CHECK (source = ANY (ARRAY['day_centre'::text, 'event'::text, 'incident'::text, 'escalation'::text, 'renewal'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'hub_issue_notes_source_check', 'hub_issue_notes', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'maintenance_items_severity_check'
      AND conrelid = 'public.maintenance_items'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.maintenance_items
        ADD CONSTRAINT maintenance_items_severity_check CHECK (severity = ANY (ARRAY['green'::text, 'yellow'::text, 'red'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'maintenance_items_severity_check', 'maintenance_items', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'maintenance_items_source_check'
      AND conrelid = 'public.maintenance_items'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.maintenance_items
        ADD CONSTRAINT maintenance_items_source_check CHECK (source = ANY (ARRAY['venue_issue'::text, 'centre_issue'::text, 'vehicle_issue'::text, 'incident_fault'::text, 'manual'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'maintenance_items_source_check', 'maintenance_items', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'maintenance_items_status_check'
      AND conrelid = 'public.maintenance_items'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.maintenance_items
        ADD CONSTRAINT maintenance_items_status_check CHECK (status = ANY (ARRAY['open'::text, 'in_progress'::text, 'deferred'::text, 'resolved'::text, 'closed'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'maintenance_items_status_check', 'maintenance_items', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_emergencies_mode_check'
      AND conrelid = 'public.operational_emergencies'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.operational_emergencies
        ADD CONSTRAINT operational_emergencies_mode_check CHECK (mode = ANY (ARRAY['drill'::text, 'live'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'operational_emergencies_mode_check', 'operational_emergencies', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_emergencies_severity_check'
      AND conrelid = 'public.operational_emergencies'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.operational_emergencies
        ADD CONSTRAINT operational_emergencies_severity_check CHECK (severity = ANY (ARRAY['yellow'::text, 'red'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'operational_emergencies_severity_check', 'operational_emergencies', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_emergencies_status_check'
      AND conrelid = 'public.operational_emergencies'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.operational_emergencies
        ADD CONSTRAINT operational_emergencies_status_check CHECK (status = ANY (ARRAY['active'::text, 'stood_down'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'operational_emergencies_status_check', 'operational_emergencies', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_emergencies_surface_check'
      AND conrelid = 'public.operational_emergencies'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.operational_emergencies
        ADD CONSTRAINT operational_emergencies_surface_check CHECK (surface = ANY (ARRAY['centre'::text, 'trip'::text, 'manifest'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'operational_emergencies_surface_check', 'operational_emergencies', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_emergency_muster_state_check'
      AND conrelid = 'public.operational_emergency_muster'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.operational_emergency_muster
        ADD CONSTRAINT operational_emergency_muster_state_check CHECK (state = ANY (ARRAY['expected'::text, 'accounted'::text, 'missing'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'operational_emergency_muster_state_check', 'operational_emergency_muster', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_emergency_muster_emergency_id_participant_id_key'
      AND conrelid = 'public.operational_emergency_muster'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.operational_emergency_muster
        ADD CONSTRAINT operational_emergency_muster_emergency_id_participant_id_key UNIQUE (emergency_id, participant_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'operational_emergency_muster_emergency_id_participant_id_key', 'operational_emergency_muster', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_incidents_incident_type_check'
      AND conrelid = 'public.operational_incidents'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.operational_incidents
        ADD CONSTRAINT operational_incidents_incident_type_check CHECK (incident_type = ANY (ARRAY['mechanical'::text, 'human_operational'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'operational_incidents_incident_type_check', 'operational_incidents', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_incidents_severity_check'
      AND conrelid = 'public.operational_incidents'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.operational_incidents
        ADD CONSTRAINT operational_incidents_severity_check CHECK (severity = ANY (ARRAY['sev1'::text, 'sev2'::text, 'sev3'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'operational_incidents_severity_check', 'operational_incidents', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_incidents_status_check'
      AND conrelid = 'public.operational_incidents'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.operational_incidents
        ADD CONSTRAINT operational_incidents_status_check CHECK (status = ANY (ARRAY['pending'::text, 'resolved'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'operational_incidents_status_check', 'operational_incidents', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_ledger_category_check'
      AND conrelid = 'public.operational_ledger'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.operational_ledger
        ADD CONSTRAINT operational_ledger_category_check CHECK (category = ANY (ARRAY['VEHICLE'::text, 'CENTRE'::text, 'CLIENT'::text, 'TRIP'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'operational_ledger_category_check', 'operational_ledger', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_ledger_severity_check'
      AND conrelid = 'public.operational_ledger'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.operational_ledger
        ADD CONSTRAINT operational_ledger_severity_check CHECK (severity = ANY (ARRAY['RED'::text, 'YELLOW'::text, 'GREEN'::text, 'INFO'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'operational_ledger_severity_check', 'operational_ledger', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_infectious_exclusions_category_check'
      AND conrelid = 'public.participant_infectious_exclusions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.participant_infectious_exclusions
        ADD CONSTRAINT participant_infectious_exclusions_category_check CHECK (category = ANY (ARRAY['respiratory'::text, 'gi'::text, 'skin_parasite'::text, 'other'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'participant_infectious_exclusions_category_check', 'participant_infectious_exclusions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_infectious_exclusions_clearance_method_check'
      AND conrelid = 'public.participant_infectious_exclusions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.participant_infectious_exclusions
        ADD CONSTRAINT participant_infectious_exclusions_clearance_method_check CHECK (clearance_method IS NULL OR (clearance_method = ANY (ARRAY['carer_attestation'::text, 'medical_cert'::text])));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'participant_infectious_exclusions_clearance_method_check', 'participant_infectious_exclusions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_infectious_exclusions_home_safe_disposition_check'
      AND conrelid = 'public.participant_infectious_exclusions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.participant_infectious_exclusions
        ADD CONSTRAINT participant_infectious_exclusions_home_safe_disposition_check CHECK (home_safe_disposition IS NULL OR (home_safe_disposition = ANY (ARRAY['family_carer'::text, 'staff_escorted'::text, 'transport_taxi'::text, 'other'::text])));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'participant_infectious_exclusions_home_safe_disposition_check', 'participant_infectious_exclusions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_infectious_exclusions_status_check'
      AND conrelid = 'public.participant_infectious_exclusions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.participant_infectious_exclusions
        ADD CONSTRAINT participant_infectious_exclusions_status_check CHECK (status = ANY (ARRAY['active'::text, 'cleared'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'participant_infectious_exclusions_status_check', 'participant_infectious_exclusions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participants_iddsi_level_liquids_check'
      AND conrelid = 'public.participants'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.participants
        ADD CONSTRAINT participants_iddsi_level_liquids_check CHECK (iddsi_level_liquids >= 0 AND iddsi_level_liquids <= 7);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'participants_iddsi_level_liquids_check', 'participants', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participants_iddsi_level_solids_check'
      AND conrelid = 'public.participants'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.participants
        ADD CONSTRAINT participants_iddsi_level_solids_check CHECK (iddsi_level_solids >= 3 AND iddsi_level_solids <= 7);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'participants_iddsi_level_solids_check', 'participants', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participants_participant_kind_check'
      AND conrelid = 'public.participants'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.participants
        ADD CONSTRAINT participants_participant_kind_check CHECK (participant_kind = ANY (ARRAY['client'::text, 'guest'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'participants_participant_kind_check', 'participants', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participants_ndis_number_key'
      AND conrelid = 'public.participants'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.participants
        ADD CONSTRAINT participants_ndis_number_key UNIQUE (ndis_number);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'participants_ndis_number_key', 'participants', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_activities_activity_kind_check'
      AND conrelid = 'public.site_day_activities'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_activities
        ADD CONSTRAINT site_day_activities_activity_kind_check CHECK (activity_kind = ANY (ARRAY['meal'::text, 'medication_round'::text, 'other'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'site_day_activities_activity_kind_check', 'site_day_activities', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_activities_meal_slot_check'
      AND conrelid = 'public.site_day_activities'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_activities
        ADD CONSTRAINT site_day_activities_meal_slot_check CHECK (meal_slot IS NULL OR (meal_slot = ANY (ARRAY['breakfast'::text, 'morning_tea'::text, 'lunch'::text, 'dinner'::text])));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'site_day_activities_meal_slot_check', 'site_day_activities', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_activities_meal_source_check'
      AND conrelid = 'public.site_day_activities'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_activities
        ADD CONSTRAINT site_day_activities_meal_source_check CHECK (meal_source IS NULL OR (meal_source = ANY (ARRAY['delivered_by_us'::text, 'own_food'::text, 'venue_provided'::text, 'packed'::text, 'purchase'::text])));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'site_day_activities_meal_source_check', 'site_day_activities', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_activities_phase_check'
      AND conrelid = 'public.site_day_activities'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_activities
        ADD CONSTRAINT site_day_activities_phase_check CHECK (phase = ANY (ARRAY['pending'::text, 'active'::text, 'completed'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'site_day_activities_phase_check', 'site_day_activities', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_activities_prep_attestation_mode_check'
      AND conrelid = 'public.site_day_activities'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_activities
        ADD CONSTRAINT site_day_activities_prep_attestation_mode_check CHECK (prep_attestation_mode IS NULL OR (prep_attestation_mode = ANY (ARRAY['preparer_pin'::text, 'manager_guest_override'::text])));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'site_day_activities_prep_attestation_mode_check', 'site_day_activities', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_activities_preparer_cert_status_check'
      AND conrelid = 'public.site_day_activities'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_activities
        ADD CONSTRAINT site_day_activities_preparer_cert_status_check CHECK (preparer_cert_status IS NULL OR (preparer_cert_status = ANY (ARRAY['ok'::text, 'warn_missing'::text, 'warn_expired'::text, 'na'::text])));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'site_day_activities_preparer_cert_status_check', 'site_day_activities', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_meal_service_rolls_status_check'
      AND conrelid = 'public.site_day_meal_service_rolls'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_meal_service_rolls
        ADD CONSTRAINT site_day_meal_service_rolls_status_check CHECK (status = ANY (ARRAY['expected'::text, 'served'::text, 'modified'::text, 'own_order'::text, 'declined'::text, 'na'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'site_day_meal_service_rolls_status_check', 'site_day_meal_service_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_meal_service_rolls_activity_id_participant_id_key'
      AND conrelid = 'public.site_day_meal_service_rolls'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_meal_service_rolls
        ADD CONSTRAINT site_day_meal_service_rolls_activity_id_participant_id_key UNIQUE (activity_id, participant_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'site_day_meal_service_rolls_activity_id_participant_id_key', 'site_day_meal_service_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_sessions_leader_decision_check'
      AND conrelid = 'public.site_day_sessions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_sessions
        ADD CONSTRAINT site_day_sessions_leader_decision_check CHECK (leader_decision = ANY (ARRAY['go'::text, 'no_go'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'site_day_sessions_leader_decision_check', 'site_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_sessions_lockdown_severity_check'
      AND conrelid = 'public.site_day_sessions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_sessions
        ADD CONSTRAINT site_day_sessions_lockdown_severity_check CHECK (lockdown_severity IS NULL OR (lockdown_severity = ANY (ARRAY['yellow'::text, 'red'::text])));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'site_day_sessions_lockdown_severity_check', 'site_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_sessions_manager_decision_check'
      AND conrelid = 'public.site_day_sessions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_sessions
        ADD CONSTRAINT site_day_sessions_manager_decision_check CHECK (manager_decision = ANY (ARRAY['go'::text, 'no_go'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'site_day_sessions_manager_decision_check', 'site_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_sessions_session_date_key'
      AND conrelid = 'public.site_day_sessions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_sessions
        ADD CONSTRAINT site_day_sessions_session_date_key UNIQUE (session_date);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'site_day_sessions_session_date_key', 'site_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_visitors_kind_check'
      AND conrelid = 'public.site_day_visitors'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_visitors
        ADD CONSTRAINT site_day_visitors_kind_check CHECK (kind = ANY (ARRAY['trial'::text, 'friend_family'::text, 'site'::text, 'other'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'site_day_visitors_kind_check', 'site_day_visitors', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_issues_register_issue_area_check'
      AND conrelid = 'public.site_issues_register'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_issues_register
        ADD CONSTRAINT site_issues_register_issue_area_check CHECK (issue_area IS NULL OR (issue_area = ANY (ARRAY['general'::text, 'health_safety'::text])));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'site_issues_register_issue_area_check', 'site_issues_register', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'system_lookup_parameters_code_key'
      AND conrelid = 'public.system_lookup_parameters'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.system_lookup_parameters
        ADD CONSTRAINT system_lookup_parameters_code_key UNIQUE (code);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'system_lookup_parameters_code_key', 'system_lookup_parameters', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_assets_last_service_odo_check'
      AND conrelid = 'public.transport_assets'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.transport_assets
        ADD CONSTRAINT transport_assets_last_service_odo_check CHECK (last_service_odo IS NULL OR last_service_odo >= 0);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'transport_assets_last_service_odo_check', 'transport_assets', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_assets_service_interval_km_check'
      AND conrelid = 'public.transport_assets'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.transport_assets
        ADD CONSTRAINT transport_assets_service_interval_km_check CHECK (service_interval_km IS NULL OR service_interval_km > 0);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'transport_assets_service_interval_km_check', 'transport_assets', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_assets_vehicle_category_check'
      AND conrelid = 'public.transport_assets'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.transport_assets
        ADD CONSTRAINT transport_assets_vehicle_category_check CHECK (vehicle_category = ANY (ARRAY['all'::text, 'bus'::text, 'van'::text, 'sedan'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'transport_assets_vehicle_category_check', 'transport_assets', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_assets_name_key'
      AND conrelid = 'public.transport_assets'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.transport_assets
        ADD CONSTRAINT transport_assets_name_key UNIQUE (name);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'transport_assets_name_key', 'transport_assets', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_assets_rego_plate_key'
      AND conrelid = 'public.transport_assets'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.transport_assets
        ADD CONSTRAINT transport_assets_rego_plate_key UNIQUE (rego_plate);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'transport_assets_rego_plate_key', 'transport_assets', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_requests_status_check'
      AND conrelid = 'public.transport_requests'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.transport_requests
        ADD CONSTRAINT transport_requests_status_check CHECK (status = ANY (ARRAY['requested'::text, 'assigned'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'transport_requests_status_check', 'transport_requests', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_trips_trip_kind_check'
      AND conrelid = 'public.transport_trips'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.transport_trips
        ADD CONSTRAINT transport_trips_trip_kind_check CHECK (trip_kind IS NULL OR (trip_kind = ANY (ARRAY['day_centre'::text, 'event'::text, 'event_venue_hop'::text, 'transport_request'::text])));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'transport_trips_trip_kind_check', 'transport_trips', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_trips_trip_origin_check'
      AND conrelid = 'public.transport_trips'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.transport_trips
        ADD CONSTRAINT transport_trips_trip_origin_check CHECK (trip_origin = ANY (ARRAY['depot'::text, 'day_centre'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'transport_trips_trip_origin_check', 'transport_trips', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_trips_trip_return_check'
      AND conrelid = 'public.transport_trips'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.transport_trips
        ADD CONSTRAINT transport_trips_trip_return_check CHECK (trip_return = ANY (ARRAY['depot'::text, 'day_centre'::text, 'none'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'transport_trips_trip_return_check', 'transport_trips', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trip_legs_medication_handover_status_check'
      AND conrelid = 'public.trip_legs'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.trip_legs
        ADD CONSTRAINT trip_legs_medication_handover_status_check CHECK (medication_handover_status = ANY (ARRAY['collected_intact'::text, 'collected_damaged'::text, 'expected_not_provided'::text, 'not_required'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'trip_legs_medication_handover_status_check', 'trip_legs', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vendors_status_check'
      AND conrelid = 'public.vendors'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.vendors
        ADD CONSTRAINT vendors_status_check CHECK (status = ANY (ARRAY['active'::text, 'archived'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'vendors_status_check', 'vendors', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venue_safety_answers_signoff_id_field_id_key'
      AND conrelid = 'public.venue_safety_answers'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.venue_safety_answers
        ADD CONSTRAINT venue_safety_answers_signoff_id_field_id_key UNIQUE (signoff_id, field_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'venue_safety_answers_signoff_id_field_id_key', 'venue_safety_answers', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venue_template_fields_answer_type_check'
      AND conrelid = 'public.venue_template_fields'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.venue_template_fields
        ADD CONSTRAINT venue_template_fields_answer_type_check CHECK (answer_type = ANY (ARRAY['yes_no'::text, 'text'::text, 'number'::text, 'select'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'venue_template_fields_answer_type_check', 'venue_template_fields', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venues_risk_tier_check'
      AND conrelid = 'public.venues'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.venues
        ADD CONSTRAINT venues_risk_tier_check CHECK (risk_tier = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'venues_risk_tier_check', 'venues', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venues_status_check'
      AND conrelid = 'public.venues'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.venues
        ADD CONSTRAINT venues_status_check CHECK (status = ANY (ARRAY['active'::text, 'archived'::text]));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP constraint % on %: %', 'venues_status_check', 'venues', SQLERRM;
    END;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) FOREIGN KEY constraints (NOT VALID)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_checkpoints_asset_id_fkey'
      AND conrelid = 'public.asset_checkpoints'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.asset_checkpoints
        ADD CONSTRAINT asset_checkpoints_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES transport_assets(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'asset_checkpoints_asset_id_fkey', 'asset_checkpoints', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_clearance_items_checkpoint_id_fkey'
      AND conrelid = 'public.asset_clearance_items'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.asset_clearance_items
        ADD CONSTRAINT asset_clearance_items_checkpoint_id_fkey FOREIGN KEY (checkpoint_id) REFERENCES asset_checkpoints(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'asset_clearance_items_checkpoint_id_fkey', 'asset_clearance_items', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_clearance_items_clearance_id_fkey'
      AND conrelid = 'public.asset_clearance_items'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.asset_clearance_items
        ADD CONSTRAINT asset_clearance_items_clearance_id_fkey FOREIGN KEY (clearance_id) REFERENCES asset_daily_clearance(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'asset_clearance_items_clearance_id_fkey', 'asset_clearance_items', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_daily_clearance_asset_id_fkey'
      AND conrelid = 'public.asset_daily_clearance'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.asset_daily_clearance
        ADD CONSTRAINT asset_daily_clearance_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES transport_assets(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'asset_daily_clearance_asset_id_fkey', 'asset_daily_clearance', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_daily_clearance_driver_auth_staff_id_fkey'
      AND conrelid = 'public.asset_daily_clearance'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.asset_daily_clearance
        ADD CONSTRAINT asset_daily_clearance_driver_auth_staff_id_fkey FOREIGN KEY (driver_auth_staff_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'asset_daily_clearance_driver_auth_staff_id_fkey', 'asset_daily_clearance', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_daily_clearance_manager_auth_staff_id_fkey'
      AND conrelid = 'public.asset_daily_clearance'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.asset_daily_clearance
        ADD CONSTRAINT asset_daily_clearance_manager_auth_staff_id_fkey FOREIGN KEY (manager_auth_staff_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'asset_daily_clearance_manager_auth_staff_id_fkey', 'asset_daily_clearance', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_maintenance_logs_asset_id_fkey'
      AND conrelid = 'public.asset_maintenance_logs'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.asset_maintenance_logs
        ADD CONSTRAINT asset_maintenance_logs_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'asset_maintenance_logs_asset_id_fkey', 'asset_maintenance_logs', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_maintenance_logs_logged_by_id_fkey'
      AND conrelid = 'public.asset_maintenance_logs'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.asset_maintenance_logs
        ADD CONSTRAINT asset_maintenance_logs_logged_by_id_fkey FOREIGN KEY (logged_by_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'asset_maintenance_logs_logged_by_id_fkey', 'asset_maintenance_logs', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'attendance_roster_logs_participant_id_fkey'
      AND conrelid = 'public.attendance_roster_logs'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.attendance_roster_logs
        ADD CONSTRAINT attendance_roster_logs_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'attendance_roster_logs_participant_id_fkey', 'attendance_roster_logs', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'carers_registry_participant_id_fkey'
      AND conrelid = 'public.carers_registry'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.carers_registry
        ADD CONSTRAINT carers_registry_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'carers_registry_participant_id_fkey', 'carers_registry', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checklist_responses_item_id_fkey'
      AND conrelid = 'public.checklist_responses'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.checklist_responses
        ADD CONSTRAINT checklist_responses_item_id_fkey FOREIGN KEY (item_id) REFERENCES checklist_items(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'checklist_responses_item_id_fkey', 'checklist_responses', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checklist_responses_ledger_id_fkey'
      AND conrelid = 'public.checklist_responses'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.checklist_responses
        ADD CONSTRAINT checklist_responses_ledger_id_fkey FOREIGN KEY (ledger_id) REFERENCES operational_ledger(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'checklist_responses_ledger_id_fkey', 'checklist_responses', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_attendance_log_departure_issue_id_fkey'
      AND conrelid = 'public.client_attendance_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.client_attendance_log
        ADD CONSTRAINT client_attendance_log_departure_issue_id_fkey FOREIGN KEY (departure_issue_id) REFERENCES site_issues_register(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'client_attendance_log_departure_issue_id_fkey', 'client_attendance_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_attendance_log_escalation_issue_id_fkey'
      AND conrelid = 'public.client_attendance_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.client_attendance_log
        ADD CONSTRAINT client_attendance_log_escalation_issue_id_fkey FOREIGN KEY (escalation_issue_id) REFERENCES site_issues_register(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'client_attendance_log_escalation_issue_id_fkey', 'client_attendance_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_attendance_log_session_id_fkey'
      AND conrelid = 'public.client_attendance_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.client_attendance_log
        ADD CONSTRAINT client_attendance_log_session_id_fkey FOREIGN KEY (session_id) REFERENCES site_day_sessions(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'client_attendance_log_session_id_fkey', 'client_attendance_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'compliance_audit_logs_participant_id_fkey'
      AND conrelid = 'public.compliance_audit_logs'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.compliance_audit_logs
        ADD CONSTRAINT compliance_audit_logs_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES participants(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'compliance_audit_logs_participant_id_fkey', 'compliance_audit_logs', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_activity_rolls_checked_in_by_id_fkey'
      AND conrelid = 'public.event_activity_rolls'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_activity_rolls
        ADD CONSTRAINT event_activity_rolls_checked_in_by_id_fkey FOREIGN KEY (checked_in_by_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_activity_rolls_checked_in_by_id_fkey', 'event_activity_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_activity_rolls_event_day_session_id_fkey'
      AND conrelid = 'public.event_activity_rolls'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_activity_rolls
        ADD CONSTRAINT event_activity_rolls_event_day_session_id_fkey FOREIGN KEY (event_day_session_id) REFERENCES event_day_sessions(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_activity_rolls_event_day_session_id_fkey', 'event_activity_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_activity_rolls_marked_absent_by_id_fkey'
      AND conrelid = 'public.event_activity_rolls'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_activity_rolls
        ADD CONSTRAINT event_activity_rolls_marked_absent_by_id_fkey FOREIGN KEY (marked_absent_by_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_activity_rolls_marked_absent_by_id_fkey', 'event_activity_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_activity_rolls_participant_id_fkey'
      AND conrelid = 'public.event_activity_rolls'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_activity_rolls
        ADD CONSTRAINT event_activity_rolls_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_activity_rolls_participant_id_fkey', 'event_activity_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_activity_rolls_venue_stop_id_fkey'
      AND conrelid = 'public.event_activity_rolls'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_activity_rolls
        ADD CONSTRAINT event_activity_rolls_venue_stop_id_fkey FOREIGN KEY (venue_stop_id) REFERENCES event_venue_stops(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_activity_rolls_venue_stop_id_fkey', 'event_activity_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_attendance_log_escalation_issue_id_fkey'
      AND conrelid = 'public.event_attendance_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_attendance_log
        ADD CONSTRAINT event_attendance_log_escalation_issue_id_fkey FOREIGN KEY (escalation_issue_id) REFERENCES site_issues_register(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_attendance_log_escalation_issue_id_fkey', 'event_attendance_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_attendance_log_event_day_session_id_fkey'
      AND conrelid = 'public.event_attendance_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_attendance_log
        ADD CONSTRAINT event_attendance_log_event_day_session_id_fkey FOREIGN KEY (event_day_session_id) REFERENCES event_day_sessions(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_attendance_log_event_day_session_id_fkey', 'event_attendance_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_bus_manifest_carer_id_fkey'
      AND conrelid = 'public.event_bus_manifest'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_bus_manifest
        ADD CONSTRAINT event_bus_manifest_carer_id_fkey FOREIGN KEY (carer_id) REFERENCES carers_registry(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_bus_manifest_carer_id_fkey', 'event_bus_manifest', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_bus_manifest_checked_on_by_fkey'
      AND conrelid = 'public.event_bus_manifest'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_bus_manifest
        ADD CONSTRAINT event_bus_manifest_checked_on_by_fkey FOREIGN KEY (checked_on_by) REFERENCES staff_registry(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_bus_manifest_checked_on_by_fkey', 'event_bus_manifest', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_bus_manifest_event_day_session_id_fkey'
      AND conrelid = 'public.event_bus_manifest'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_bus_manifest
        ADD CONSTRAINT event_bus_manifest_event_day_session_id_fkey FOREIGN KEY (event_day_session_id) REFERENCES event_day_sessions(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_bus_manifest_event_day_session_id_fkey', 'event_bus_manifest', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_bus_manifest_participant_id_fkey'
      AND conrelid = 'public.event_bus_manifest'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_bus_manifest
        ADD CONSTRAINT event_bus_manifest_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_bus_manifest_participant_id_fkey', 'event_bus_manifest', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_bus_manifest_transport_trip_id_fkey'
      AND conrelid = 'public.event_bus_manifest'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_bus_manifest
        ADD CONSTRAINT event_bus_manifest_transport_trip_id_fkey FOREIGN KEY (transport_trip_id) REFERENCES transport_trips(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_bus_manifest_transport_trip_id_fkey', 'event_bus_manifest', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_curfew_log_accounted_by_fkey'
      AND conrelid = 'public.event_curfew_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_curfew_log
        ADD CONSTRAINT event_curfew_log_accounted_by_fkey FOREIGN KEY (accounted_by) REFERENCES staff_registry(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_curfew_log_accounted_by_fkey', 'event_curfew_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_curfew_log_escalation_issue_id_fkey'
      AND conrelid = 'public.event_curfew_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_curfew_log
        ADD CONSTRAINT event_curfew_log_escalation_issue_id_fkey FOREIGN KEY (escalation_issue_id) REFERENCES site_issues_register(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_curfew_log_escalation_issue_id_fkey', 'event_curfew_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_curfew_log_event_day_session_id_fkey'
      AND conrelid = 'public.event_curfew_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_curfew_log
        ADD CONSTRAINT event_curfew_log_event_day_session_id_fkey FOREIGN KEY (event_day_session_id) REFERENCES event_day_sessions(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_curfew_log_event_day_session_id_fkey', 'event_curfew_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_curfew_log_participant_id_fkey'
      AND conrelid = 'public.event_curfew_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_curfew_log
        ADD CONSTRAINT event_curfew_log_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_curfew_log_participant_id_fkey', 'event_curfew_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_day_med_alternate_plans_attested_by_staff_id_fkey'
      AND conrelid = 'public.event_day_med_alternate_plans'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_day_med_alternate_plans
        ADD CONSTRAINT event_day_med_alternate_plans_attested_by_staff_id_fkey FOREIGN KEY (attested_by_staff_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_day_med_alternate_plans_attested_by_staff_id_fkey', 'event_day_med_alternate_plans', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_day_med_alternate_plans_event_day_session_id_fkey'
      AND conrelid = 'public.event_day_med_alternate_plans'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_day_med_alternate_plans
        ADD CONSTRAINT event_day_med_alternate_plans_event_day_session_id_fkey FOREIGN KEY (event_day_session_id) REFERENCES event_day_sessions(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_day_med_alternate_plans_event_day_session_id_fkey', 'event_day_med_alternate_plans', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_day_med_alternate_plans_participant_id_fkey'
      AND conrelid = 'public.event_day_med_alternate_plans'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_day_med_alternate_plans
        ADD CONSTRAINT event_day_med_alternate_plans_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_day_med_alternate_plans_participant_id_fkey', 'event_day_med_alternate_plans', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_day_sessions_closed_by_id_fkey'
      AND conrelid = 'public.event_day_sessions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_day_sessions
        ADD CONSTRAINT event_day_sessions_closed_by_id_fkey FOREIGN KEY (closed_by_id) REFERENCES staff_registry(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_day_sessions_closed_by_id_fkey', 'event_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_day_sessions_event_id_fkey'
      AND conrelid = 'public.event_day_sessions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_day_sessions
        ADD CONSTRAINT event_day_sessions_event_id_fkey FOREIGN KEY (event_id) REFERENCES event_manifest(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_day_sessions_event_id_fkey', 'event_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_day_sessions_manager_staff_id_fkey'
      AND conrelid = 'public.event_day_sessions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_day_sessions
        ADD CONSTRAINT event_day_sessions_manager_staff_id_fkey FOREIGN KEY (manager_staff_id) REFERENCES staff_registry(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_day_sessions_manager_staff_id_fkey', 'event_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_day_sessions_opened_by_id_fkey'
      AND conrelid = 'public.event_day_sessions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_day_sessions
        ADD CONSTRAINT event_day_sessions_opened_by_id_fkey FOREIGN KEY (opened_by_id) REFERENCES staff_registry(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_day_sessions_opened_by_id_fkey', 'event_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_day_sessions_programme_suspend_hub_issue_id_fkey'
      AND conrelid = 'public.event_day_sessions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_day_sessions
        ADD CONSTRAINT event_day_sessions_programme_suspend_hub_issue_id_fkey FOREIGN KEY (programme_suspend_hub_issue_id) REFERENCES site_issues_register(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_day_sessions_programme_suspend_hub_issue_id_fkey', 'event_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_day_sessions_programme_suspended_by_staff_id_fkey'
      AND conrelid = 'public.event_day_sessions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_day_sessions
        ADD CONSTRAINT event_day_sessions_programme_suspended_by_staff_id_fkey FOREIGN KEY (programme_suspended_by_staff_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_day_sessions_programme_suspended_by_staff_id_fkey', 'event_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_financial_ledger_event_id_fkey'
      AND conrelid = 'public.event_financial_ledger'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_financial_ledger
        ADD CONSTRAINT event_financial_ledger_event_id_fkey FOREIGN KEY (event_id) REFERENCES event_manifest(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_financial_ledger_event_id_fkey', 'event_financial_ledger', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_manifest_base_hotel_venue_id_fkey'
      AND conrelid = 'public.event_manifest'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_manifest
        ADD CONSTRAINT event_manifest_base_hotel_venue_id_fkey FOREIGN KEY (base_hotel_venue_id) REFERENCES venues(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_manifest_base_hotel_venue_id_fkey', 'event_manifest', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_manifest_closed_by_id_fkey'
      AND conrelid = 'public.event_manifest'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_manifest
        ADD CONSTRAINT event_manifest_closed_by_id_fkey FOREIGN KEY (closed_by_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_manifest_closed_by_id_fkey', 'event_manifest', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_manifest_default_charge_code_id_fkey'
      AND conrelid = 'public.event_manifest'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_manifest
        ADD CONSTRAINT event_manifest_default_charge_code_id_fkey FOREIGN KEY (default_charge_code_id) REFERENCES charge_codes(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_manifest_default_charge_code_id_fkey', 'event_manifest', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_manifest_primary_venue_id_fkey'
      AND conrelid = 'public.event_manifest'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_manifest
        ADD CONSTRAINT event_manifest_primary_venue_id_fkey FOREIGN KEY (primary_venue_id) REFERENCES venues(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_manifest_primary_venue_id_fkey', 'event_manifest', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_meal_service_rolls_participant_id_fkey'
      AND conrelid = 'public.event_meal_service_rolls'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_meal_service_rolls
        ADD CONSTRAINT event_meal_service_rolls_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_meal_service_rolls_participant_id_fkey', 'event_meal_service_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_meal_service_rolls_updated_by_id_fkey'
      AND conrelid = 'public.event_meal_service_rolls'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_meal_service_rolls
        ADD CONSTRAINT event_meal_service_rolls_updated_by_id_fkey FOREIGN KEY (updated_by_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_meal_service_rolls_updated_by_id_fkey', 'event_meal_service_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_meal_service_rolls_venue_stop_id_fkey'
      AND conrelid = 'public.event_meal_service_rolls'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_meal_service_rolls
        ADD CONSTRAINT event_meal_service_rolls_venue_stop_id_fkey FOREIGN KEY (venue_stop_id) REFERENCES event_venue_stops(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_meal_service_rolls_venue_stop_id_fkey', 'event_meal_service_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_morning_log_accounted_by_fkey'
      AND conrelid = 'public.event_morning_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_morning_log
        ADD CONSTRAINT event_morning_log_accounted_by_fkey FOREIGN KEY (accounted_by) REFERENCES staff_registry(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_morning_log_accounted_by_fkey', 'event_morning_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_morning_log_escalation_issue_id_fkey'
      AND conrelid = 'public.event_morning_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_morning_log
        ADD CONSTRAINT event_morning_log_escalation_issue_id_fkey FOREIGN KEY (escalation_issue_id) REFERENCES site_issues_register(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_morning_log_escalation_issue_id_fkey', 'event_morning_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_morning_log_event_day_session_id_fkey'
      AND conrelid = 'public.event_morning_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_morning_log
        ADD CONSTRAINT event_morning_log_event_day_session_id_fkey FOREIGN KEY (event_day_session_id) REFERENCES event_day_sessions(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_morning_log_event_day_session_id_fkey', 'event_morning_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_morning_log_participant_id_fkey'
      AND conrelid = 'public.event_morning_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_morning_log
        ADD CONSTRAINT event_morning_log_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_morning_log_participant_id_fkey', 'event_morning_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_roster_bookings_carer_id_fkey'
      AND conrelid = 'public.event_roster_bookings'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_roster_bookings
        ADD CONSTRAINT event_roster_bookings_carer_id_fkey FOREIGN KEY (carer_id) REFERENCES carers_registry(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_roster_bookings_carer_id_fkey', 'event_roster_bookings', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_roster_bookings_charge_code_id_fkey'
      AND conrelid = 'public.event_roster_bookings'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_roster_bookings
        ADD CONSTRAINT event_roster_bookings_charge_code_id_fkey FOREIGN KEY (charge_code_id) REFERENCES charge_codes(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_roster_bookings_charge_code_id_fkey', 'event_roster_bookings', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_roster_bookings_companion_carer_id_fkey'
      AND conrelid = 'public.event_roster_bookings'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_roster_bookings
        ADD CONSTRAINT event_roster_bookings_companion_carer_id_fkey FOREIGN KEY (companion_carer_id) REFERENCES carers_registry(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_roster_bookings_companion_carer_id_fkey', 'event_roster_bookings', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_roster_bookings_event_id_fkey'
      AND conrelid = 'public.event_roster_bookings'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_roster_bookings
        ADD CONSTRAINT event_roster_bookings_event_id_fkey FOREIGN KEY (event_id) REFERENCES event_manifest(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_roster_bookings_event_id_fkey', 'event_roster_bookings', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_roster_bookings_host_participant_id_fkey'
      AND conrelid = 'public.event_roster_bookings'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_roster_bookings
        ADD CONSTRAINT event_roster_bookings_host_participant_id_fkey FOREIGN KEY (host_participant_id) REFERENCES participants(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_roster_bookings_host_participant_id_fkey', 'event_roster_bookings', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_roster_bookings_participant_id_fkey'
      AND conrelid = 'public.event_roster_bookings'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_roster_bookings
        ADD CONSTRAINT event_roster_bookings_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_roster_bookings_participant_id_fkey', 'event_roster_bookings', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_reconfirmations_event_id_fkey'
      AND conrelid = 'public.event_venue_reconfirmations'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_reconfirmations
        ADD CONSTRAINT event_venue_reconfirmations_event_id_fkey FOREIGN KEY (event_id) REFERENCES event_manifest(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_venue_reconfirmations_event_id_fkey', 'event_venue_reconfirmations', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_reconfirmations_reconfirmed_by_staff_id_fkey'
      AND conrelid = 'public.event_venue_reconfirmations'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_reconfirmations
        ADD CONSTRAINT event_venue_reconfirmations_reconfirmed_by_staff_id_fkey FOREIGN KEY (reconfirmed_by_staff_id) REFERENCES staff_registry(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_venue_reconfirmations_reconfirmed_by_staff_id_fkey', 'event_venue_reconfirmations', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_reconfirmations_venue_id_fkey'
      AND conrelid = 'public.event_venue_reconfirmations'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_reconfirmations
        ADD CONSTRAINT event_venue_reconfirmations_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_venue_reconfirmations_venue_id_fkey', 'event_venue_reconfirmations', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_event_id_fkey'
      AND conrelid = 'public.event_venue_stops'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_stops
        ADD CONSTRAINT event_venue_stops_event_id_fkey FOREIGN KEY (event_id) REFERENCES event_manifest(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_venue_stops_event_id_fkey', 'event_venue_stops', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_opened_by_id_fkey'
      AND conrelid = 'public.event_venue_stops'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_stops
        ADD CONSTRAINT event_venue_stops_opened_by_id_fkey FOREIGN KEY (opened_by_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_venue_stops_opened_by_id_fkey', 'event_venue_stops', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_prep_attested_by_staff_id_fkey'
      AND conrelid = 'public.event_venue_stops'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_stops
        ADD CONSTRAINT event_venue_stops_prep_attested_by_staff_id_fkey FOREIGN KEY (prep_attested_by_staff_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_venue_stops_prep_attested_by_staff_id_fkey', 'event_venue_stops', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_prepared_by_staff_id_fkey'
      AND conrelid = 'public.event_venue_stops'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_stops
        ADD CONSTRAINT event_venue_stops_prepared_by_staff_id_fkey FOREIGN KEY (prepared_by_staff_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_venue_stops_prepared_by_staff_id_fkey', 'event_venue_stops', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_sfh_approved_by_staff_id_fkey'
      AND conrelid = 'public.event_venue_stops'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_stops
        ADD CONSTRAINT event_venue_stops_sfh_approved_by_staff_id_fkey FOREIGN KEY (sfh_approved_by_staff_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_venue_stops_sfh_approved_by_staff_id_fkey', 'event_venue_stops', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_venue_id_fkey'
      AND conrelid = 'public.event_venue_stops'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_stops
        ADD CONSTRAINT event_venue_stops_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE RESTRICT NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'event_venue_stops_venue_id_fkey', 'event_venue_stops', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'maintenance_notes_item_id_fkey'
      AND conrelid = 'public.maintenance_notes'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.maintenance_notes
        ADD CONSTRAINT maintenance_notes_item_id_fkey FOREIGN KEY (item_id) REFERENCES maintenance_items(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'maintenance_notes_item_id_fkey', 'maintenance_notes', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'medication_administration_log_administered_by_id_fkey'
      AND conrelid = 'public.medication_administration_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.medication_administration_log
        ADD CONSTRAINT medication_administration_log_administered_by_id_fkey FOREIGN KEY (administered_by_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'medication_administration_log_administered_by_id_fkey', 'medication_administration_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'medication_administration_log_participant_id_fkey'
      AND conrelid = 'public.medication_administration_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.medication_administration_log
        ADD CONSTRAINT medication_administration_log_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'medication_administration_log_participant_id_fkey', 'medication_administration_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'medication_administration_log_schedule_id_fkey'
      AND conrelid = 'public.medication_administration_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.medication_administration_log
        ADD CONSTRAINT medication_administration_log_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES participant_attendance_schedules(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'medication_administration_log_schedule_id_fkey', 'medication_administration_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'medication_administration_log_witnessed_by_id_fkey'
      AND conrelid = 'public.medication_administration_log'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.medication_administration_log
        ADD CONSTRAINT medication_administration_log_witnessed_by_id_fkey FOREIGN KEY (witnessed_by_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'medication_administration_log_witnessed_by_id_fkey', 'medication_administration_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'myob_export_batches_exported_by_fkey'
      AND conrelid = 'public.myob_export_batches'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.myob_export_batches
        ADD CONSTRAINT myob_export_batches_exported_by_fkey FOREIGN KEY (exported_by) REFERENCES auth.users(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'myob_export_batches_exported_by_fkey', 'myob_export_batches', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_emergencies_activated_by_staff_id_fkey'
      AND conrelid = 'public.operational_emergencies'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.operational_emergencies
        ADD CONSTRAINT operational_emergencies_activated_by_staff_id_fkey FOREIGN KEY (activated_by_staff_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'operational_emergencies_activated_by_staff_id_fkey', 'operational_emergencies', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_emergencies_hub_issue_id_fkey'
      AND conrelid = 'public.operational_emergencies'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.operational_emergencies
        ADD CONSTRAINT operational_emergencies_hub_issue_id_fkey FOREIGN KEY (hub_issue_id) REFERENCES site_issues_register(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'operational_emergencies_hub_issue_id_fkey', 'operational_emergencies', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_emergencies_site_day_session_id_fkey'
      AND conrelid = 'public.operational_emergencies'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.operational_emergencies
        ADD CONSTRAINT operational_emergencies_site_day_session_id_fkey FOREIGN KEY (site_day_session_id) REFERENCES site_day_sessions(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'operational_emergencies_site_day_session_id_fkey', 'operational_emergencies', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_emergencies_stood_down_by_staff_id_fkey'
      AND conrelid = 'public.operational_emergencies'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.operational_emergencies
        ADD CONSTRAINT operational_emergencies_stood_down_by_staff_id_fkey FOREIGN KEY (stood_down_by_staff_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'operational_emergencies_stood_down_by_staff_id_fkey', 'operational_emergencies', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_emergency_muster_emergency_id_fkey'
      AND conrelid = 'public.operational_emergency_muster'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.operational_emergency_muster
        ADD CONSTRAINT operational_emergency_muster_emergency_id_fkey FOREIGN KEY (emergency_id) REFERENCES operational_emergencies(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'operational_emergency_muster_emergency_id_fkey', 'operational_emergency_muster', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_emergency_muster_participant_id_fkey'
      AND conrelid = 'public.operational_emergency_muster'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.operational_emergency_muster
        ADD CONSTRAINT operational_emergency_muster_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'operational_emergency_muster_participant_id_fkey', 'operational_emergency_muster', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_emergency_muster_updated_by_staff_id_fkey'
      AND conrelid = 'public.operational_emergency_muster'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.operational_emergency_muster
        ADD CONSTRAINT operational_emergency_muster_updated_by_staff_id_fkey FOREIGN KEY (updated_by_staff_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'operational_emergency_muster_updated_by_staff_id_fkey', 'operational_emergency_muster', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_escalations_claimed_by_fkey'
      AND conrelid = 'public.operational_escalations'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.operational_escalations
        ADD CONSTRAINT operational_escalations_claimed_by_fkey FOREIGN KEY (claimed_by) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'operational_escalations_claimed_by_fkey', 'operational_escalations', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_escalations_clearance_id_fkey'
      AND conrelid = 'public.operational_escalations'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.operational_escalations
        ADD CONSTRAINT operational_escalations_clearance_id_fkey FOREIGN KEY (clearance_id) REFERENCES asset_daily_clearance(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'operational_escalations_clearance_id_fkey', 'operational_escalations', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_escalations_operator_acknowledged_by_fkey'
      AND conrelid = 'public.operational_escalations'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.operational_escalations
        ADD CONSTRAINT operational_escalations_operator_acknowledged_by_fkey FOREIGN KEY (operator_acknowledged_by) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'operational_escalations_operator_acknowledged_by_fkey', 'operational_escalations', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_escalations_raised_by_fkey'
      AND conrelid = 'public.operational_escalations'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.operational_escalations
        ADD CONSTRAINT operational_escalations_raised_by_fkey FOREIGN KEY (raised_by) REFERENCES staff_registry(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'operational_escalations_raised_by_fkey', 'operational_escalations', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_escalations_resolved_by_fkey'
      AND conrelid = 'public.operational_escalations'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.operational_escalations
        ADD CONSTRAINT operational_escalations_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'operational_escalations_resolved_by_fkey', 'operational_escalations', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_incidents_assisting_staff_id_fkey'
      AND conrelid = 'public.operational_incidents'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.operational_incidents
        ADD CONSTRAINT operational_incidents_assisting_staff_id_fkey FOREIGN KEY (assisting_staff_id) REFERENCES staff_registry(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'operational_incidents_assisting_staff_id_fkey', 'operational_incidents', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_attendance_schedules_archive_witnessed_by_id_fkey'
      AND conrelid = 'public.participant_attendance_schedules'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.participant_attendance_schedules
        ADD CONSTRAINT participant_attendance_schedules_archive_witnessed_by_id_fkey FOREIGN KEY (archive_witnessed_by_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'participant_attendance_schedules_archive_witnessed_by_id_fkey', 'participant_attendance_schedules', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_attendance_schedules_archived_by_id_fkey'
      AND conrelid = 'public.participant_attendance_schedules'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.participant_attendance_schedules
        ADD CONSTRAINT participant_attendance_schedules_archived_by_id_fkey FOREIGN KEY (archived_by_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'participant_attendance_schedules_archived_by_id_fkey', 'participant_attendance_schedules', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_attendance_schedules_participant_id_fkey'
      AND conrelid = 'public.participant_attendance_schedules'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.participant_attendance_schedules
        ADD CONSTRAINT participant_attendance_schedules_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'participant_attendance_schedules_participant_id_fkey', 'participant_attendance_schedules', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_compliance_and_alerts_participant_id_fkey'
      AND conrelid = 'public.participant_compliance_and_alerts'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.participant_compliance_and_alerts
        ADD CONSTRAINT participant_compliance_and_alerts_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'participant_compliance_and_alerts_participant_id_fkey', 'participant_compliance_and_alerts', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_financial_ledger_event_id_fkey'
      AND conrelid = 'public.participant_financial_ledger'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.participant_financial_ledger
        ADD CONSTRAINT participant_financial_ledger_event_id_fkey FOREIGN KEY (event_id) REFERENCES event_manifest(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'participant_financial_ledger_event_id_fkey', 'participant_financial_ledger', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_financial_ledger_participant_id_fkey'
      AND conrelid = 'public.participant_financial_ledger'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.participant_financial_ledger
        ADD CONSTRAINT participant_financial_ledger_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'participant_financial_ledger_participant_id_fkey', 'participant_financial_ledger', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_infectious_exclusions_cleared_by_staff_id_fkey'
      AND conrelid = 'public.participant_infectious_exclusions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.participant_infectious_exclusions
        ADD CONSTRAINT participant_infectious_exclusions_cleared_by_staff_id_fkey FOREIGN KEY (cleared_by_staff_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'participant_infectious_exclusions_cleared_by_staff_id_fkey', 'participant_infectious_exclusions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_infectious_exclusions_declared_by_staff_id_fkey'
      AND conrelid = 'public.participant_infectious_exclusions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.participant_infectious_exclusions
        ADD CONSTRAINT participant_infectious_exclusions_declared_by_staff_id_fkey FOREIGN KEY (declared_by_staff_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'participant_infectious_exclusions_declared_by_staff_id_fkey', 'participant_infectious_exclusions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_infectious_exclusions_event_day_session_id_fkey'
      AND conrelid = 'public.participant_infectious_exclusions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.participant_infectious_exclusions
        ADD CONSTRAINT participant_infectious_exclusions_event_day_session_id_fkey FOREIGN KEY (event_day_session_id) REFERENCES event_day_sessions(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'participant_infectious_exclusions_event_day_session_id_fkey', 'participant_infectious_exclusions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_infectious_exclusions_event_id_fkey'
      AND conrelid = 'public.participant_infectious_exclusions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.participant_infectious_exclusions
        ADD CONSTRAINT participant_infectious_exclusions_event_id_fkey FOREIGN KEY (event_id) REFERENCES event_manifest(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'participant_infectious_exclusions_event_id_fkey', 'participant_infectious_exclusions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_infectious_exclusions_home_safe_by_staff_id_fkey'
      AND conrelid = 'public.participant_infectious_exclusions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.participant_infectious_exclusions
        ADD CONSTRAINT participant_infectious_exclusions_home_safe_by_staff_id_fkey FOREIGN KEY (home_safe_by_staff_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'participant_infectious_exclusions_home_safe_by_staff_id_fkey', 'participant_infectious_exclusions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_infectious_exclusions_hub_issue_id_fkey'
      AND conrelid = 'public.participant_infectious_exclusions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.participant_infectious_exclusions
        ADD CONSTRAINT participant_infectious_exclusions_hub_issue_id_fkey FOREIGN KEY (hub_issue_id) REFERENCES site_issues_register(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'participant_infectious_exclusions_hub_issue_id_fkey', 'participant_infectious_exclusions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_infectious_exclusions_participant_id_fkey'
      AND conrelid = 'public.participant_infectious_exclusions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.participant_infectious_exclusions
        ADD CONSTRAINT participant_infectious_exclusions_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'participant_infectious_exclusions_participant_id_fkey', 'participant_infectious_exclusions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_infectious_exclusions_site_day_session_id_fkey'
      AND conrelid = 'public.participant_infectious_exclusions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.participant_infectious_exclusions
        ADD CONSTRAINT participant_infectious_exclusions_site_day_session_id_fkey FOREIGN KEY (site_day_session_id) REFERENCES site_day_sessions(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'participant_infectious_exclusions_site_day_session_id_fkey', 'participant_infectious_exclusions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_medication_schedules_participant_id_fkey'
      AND conrelid = 'public.participant_medication_schedules'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.participant_medication_schedules
        ADD CONSTRAINT participant_medication_schedules_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'participant_medication_schedules_participant_id_fkey', 'participant_medication_schedules', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_activities_closed_by_id_fkey'
      AND conrelid = 'public.site_day_activities'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_activities
        ADD CONSTRAINT site_day_activities_closed_by_id_fkey FOREIGN KEY (closed_by_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'site_day_activities_closed_by_id_fkey', 'site_day_activities', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_activities_opened_by_id_fkey'
      AND conrelid = 'public.site_day_activities'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_activities
        ADD CONSTRAINT site_day_activities_opened_by_id_fkey FOREIGN KEY (opened_by_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'site_day_activities_opened_by_id_fkey', 'site_day_activities', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_activities_prep_attested_by_staff_id_fkey'
      AND conrelid = 'public.site_day_activities'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_activities
        ADD CONSTRAINT site_day_activities_prep_attested_by_staff_id_fkey FOREIGN KEY (prep_attested_by_staff_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'site_day_activities_prep_attested_by_staff_id_fkey', 'site_day_activities', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_activities_prepared_by_staff_id_fkey'
      AND conrelid = 'public.site_day_activities'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_activities
        ADD CONSTRAINT site_day_activities_prepared_by_staff_id_fkey FOREIGN KEY (prepared_by_staff_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'site_day_activities_prepared_by_staff_id_fkey', 'site_day_activities', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_activities_session_id_fkey'
      AND conrelid = 'public.site_day_activities'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_activities
        ADD CONSTRAINT site_day_activities_session_id_fkey FOREIGN KEY (session_id) REFERENCES site_day_sessions(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'site_day_activities_session_id_fkey', 'site_day_activities', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_activities_sfh_approved_by_staff_id_fkey'
      AND conrelid = 'public.site_day_activities'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_activities
        ADD CONSTRAINT site_day_activities_sfh_approved_by_staff_id_fkey FOREIGN KEY (sfh_approved_by_staff_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'site_day_activities_sfh_approved_by_staff_id_fkey', 'site_day_activities', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_meal_service_rolls_activity_id_fkey'
      AND conrelid = 'public.site_day_meal_service_rolls'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_meal_service_rolls
        ADD CONSTRAINT site_day_meal_service_rolls_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES site_day_activities(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'site_day_meal_service_rolls_activity_id_fkey', 'site_day_meal_service_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_meal_service_rolls_participant_id_fkey'
      AND conrelid = 'public.site_day_meal_service_rolls'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_meal_service_rolls
        ADD CONSTRAINT site_day_meal_service_rolls_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'site_day_meal_service_rolls_participant_id_fkey', 'site_day_meal_service_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_meal_service_rolls_updated_by_id_fkey'
      AND conrelid = 'public.site_day_meal_service_rolls'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_meal_service_rolls
        ADD CONSTRAINT site_day_meal_service_rolls_updated_by_id_fkey FOREIGN KEY (updated_by_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'site_day_meal_service_rolls_updated_by_id_fkey', 'site_day_meal_service_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_sessions_closed_by_id_fkey'
      AND conrelid = 'public.site_day_sessions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_sessions
        ADD CONSTRAINT site_day_sessions_closed_by_id_fkey FOREIGN KEY (closed_by_id) REFERENCES auth.users(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'site_day_sessions_closed_by_id_fkey', 'site_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_sessions_leader_auth_staff_id_fkey'
      AND conrelid = 'public.site_day_sessions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_sessions
        ADD CONSTRAINT site_day_sessions_leader_auth_staff_id_fkey FOREIGN KEY (leader_auth_staff_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'site_day_sessions_leader_auth_staff_id_fkey', 'site_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_sessions_lockdown_by_staff_id_fkey'
      AND conrelid = 'public.site_day_sessions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_sessions
        ADD CONSTRAINT site_day_sessions_lockdown_by_staff_id_fkey FOREIGN KEY (lockdown_by_staff_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'site_day_sessions_lockdown_by_staff_id_fkey', 'site_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_sessions_lockdown_hub_issue_id_fkey'
      AND conrelid = 'public.site_day_sessions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_sessions
        ADD CONSTRAINT site_day_sessions_lockdown_hub_issue_id_fkey FOREIGN KEY (lockdown_hub_issue_id) REFERENCES site_issues_register(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'site_day_sessions_lockdown_hub_issue_id_fkey', 'site_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_sessions_manager_auth_staff_id_fkey'
      AND conrelid = 'public.site_day_sessions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_sessions
        ADD CONSTRAINT site_day_sessions_manager_auth_staff_id_fkey FOREIGN KEY (manager_auth_staff_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'site_day_sessions_manager_auth_staff_id_fkey', 'site_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_sessions_opened_by_id_fkey'
      AND conrelid = 'public.site_day_sessions'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_sessions
        ADD CONSTRAINT site_day_sessions_opened_by_id_fkey FOREIGN KEY (opened_by_id) REFERENCES auth.users(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'site_day_sessions_opened_by_id_fkey', 'site_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_visitors_linked_participant_id_fkey'
      AND conrelid = 'public.site_day_visitors'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_visitors
        ADD CONSTRAINT site_day_visitors_linked_participant_id_fkey FOREIGN KEY (linked_participant_id) REFERENCES participants(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'site_day_visitors_linked_participant_id_fkey', 'site_day_visitors', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_visitors_session_id_fkey'
      AND conrelid = 'public.site_day_visitors'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_visitors
        ADD CONSTRAINT site_day_visitors_session_id_fkey FOREIGN KEY (session_id) REFERENCES site_day_sessions(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'site_day_visitors_session_id_fkey', 'site_day_visitors', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_issues_register_event_day_session_id_fkey'
      AND conrelid = 'public.site_issues_register'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_issues_register
        ADD CONSTRAINT site_issues_register_event_day_session_id_fkey FOREIGN KEY (event_day_session_id) REFERENCES event_day_sessions(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'site_issues_register_event_day_session_id_fkey', 'site_issues_register', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_issues_register_event_id_fkey'
      AND conrelid = 'public.site_issues_register'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_issues_register
        ADD CONSTRAINT site_issues_register_event_id_fkey FOREIGN KEY (event_id) REFERENCES event_manifest(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'site_issues_register_event_id_fkey', 'site_issues_register', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_issues_register_session_id_fkey'
      AND conrelid = 'public.site_issues_register'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.site_issues_register
        ADD CONSTRAINT site_issues_register_session_id_fkey FOREIGN KEY (session_id) REFERENCES site_day_sessions(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'site_issues_register_session_id_fkey', 'site_issues_register', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'staff_compliance_and_certs_staff_id_fkey'
      AND conrelid = 'public.staff_compliance_and_certs'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.staff_compliance_and_certs
        ADD CONSTRAINT staff_compliance_and_certs_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES staff_registry(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'staff_compliance_and_certs_staff_id_fkey', 'staff_compliance_and_certs', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'staff_registry_auth_user_id_fkey'
      AND conrelid = 'public.staff_registry'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.staff_registry
        ADD CONSTRAINT staff_registry_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'staff_registry_auth_user_id_fkey', 'staff_registry', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'system_operational_settings_updated_by_fkey'
      AND conrelid = 'public.system_operational_settings'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.system_operational_settings
        ADD CONSTRAINT system_operational_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'system_operational_settings_updated_by_fkey', 'system_operational_settings', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'system_operational_settings_value_uuid_fkey'
      AND conrelid = 'public.system_operational_settings'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.system_operational_settings
        ADD CONSTRAINT system_operational_settings_value_uuid_fkey FOREIGN KEY (value_uuid) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'system_operational_settings_value_uuid_fkey', 'system_operational_settings', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_requests_assigned_asset_id_fkey'
      AND conrelid = 'public.transport_requests'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.transport_requests
        ADD CONSTRAINT transport_requests_assigned_asset_id_fkey FOREIGN KEY (assigned_asset_id) REFERENCES transport_assets(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'transport_requests_assigned_asset_id_fkey', 'transport_requests', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_requests_assigned_driver_staff_id_fkey'
      AND conrelid = 'public.transport_requests'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.transport_requests
        ADD CONSTRAINT transport_requests_assigned_driver_staff_id_fkey FOREIGN KEY (assigned_driver_staff_id) REFERENCES staff_registry(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'transport_requests_assigned_driver_staff_id_fkey', 'transport_requests', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_requests_created_by_staff_id_fkey'
      AND conrelid = 'public.transport_requests'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.transport_requests
        ADD CONSTRAINT transport_requests_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES staff_registry(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'transport_requests_created_by_staff_id_fkey', 'transport_requests', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_requests_participant_id_fkey'
      AND conrelid = 'public.transport_requests'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.transport_requests
        ADD CONSTRAINT transport_requests_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'transport_requests_participant_id_fkey', 'transport_requests', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_trips_asset_id_fkey'
      AND conrelid = 'public.transport_trips'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.transport_trips
        ADD CONSTRAINT transport_trips_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES transport_assets(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'transport_trips_asset_id_fkey', 'transport_trips', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_trips_driver_id_fkey'
      AND conrelid = 'public.transport_trips'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.transport_trips
        ADD CONSTRAINT transport_trips_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES staff_registry(id) NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'transport_trips_driver_id_fkey', 'transport_trips', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_trips_event_day_session_id_fkey'
      AND conrelid = 'public.transport_trips'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.transport_trips
        ADD CONSTRAINT transport_trips_event_day_session_id_fkey FOREIGN KEY (event_day_session_id) REFERENCES event_day_sessions(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'transport_trips_event_day_session_id_fkey', 'transport_trips', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_trips_event_id_fkey'
      AND conrelid = 'public.transport_trips'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.transport_trips
        ADD CONSTRAINT transport_trips_event_id_fkey FOREIGN KEY (event_id) REFERENCES event_manifest(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'transport_trips_event_id_fkey', 'transport_trips', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_trips_venue_stop_from_id_fkey'
      AND conrelid = 'public.transport_trips'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.transport_trips
        ADD CONSTRAINT transport_trips_venue_stop_from_id_fkey FOREIGN KEY (venue_stop_from_id) REFERENCES event_venue_stops(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'transport_trips_venue_stop_from_id_fkey', 'transport_trips', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_trips_venue_stop_to_id_fkey'
      AND conrelid = 'public.transport_trips'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.transport_trips
        ADD CONSTRAINT transport_trips_venue_stop_to_id_fkey FOREIGN KEY (venue_stop_to_id) REFERENCES event_venue_stops(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'transport_trips_venue_stop_to_id_fkey', 'transport_trips', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trip_legs_participant_id_fkey'
      AND conrelid = 'public.trip_legs'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.trip_legs
        ADD CONSTRAINT trip_legs_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'trip_legs_participant_id_fkey', 'trip_legs', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trip_legs_trip_id_fkey'
      AND conrelid = 'public.trip_legs'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.trip_legs
        ADD CONSTRAINT trip_legs_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES transport_trips(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'trip_legs_trip_id_fkey', 'trip_legs', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venue_safety_answers_field_id_fkey'
      AND conrelid = 'public.venue_safety_answers'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.venue_safety_answers
        ADD CONSTRAINT venue_safety_answers_field_id_fkey FOREIGN KEY (field_id) REFERENCES venue_template_fields(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'venue_safety_answers_field_id_fkey', 'venue_safety_answers', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venue_safety_answers_signoff_id_fkey'
      AND conrelid = 'public.venue_safety_answers'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.venue_safety_answers
        ADD CONSTRAINT venue_safety_answers_signoff_id_fkey FOREIGN KEY (signoff_id) REFERENCES venue_safety_baseline_signoffs(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'venue_safety_answers_signoff_id_fkey', 'venue_safety_answers', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venue_safety_baseline_signoffs_signed_off_by_staff_id_fkey'
      AND conrelid = 'public.venue_safety_baseline_signoffs'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.venue_safety_baseline_signoffs
        ADD CONSTRAINT venue_safety_baseline_signoffs_signed_off_by_staff_id_fkey FOREIGN KEY (signed_off_by_staff_id) REFERENCES staff_registry(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'venue_safety_baseline_signoffs_signed_off_by_staff_id_fkey', 'venue_safety_baseline_signoffs', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venue_safety_baseline_signoffs_venue_id_fkey'
      AND conrelid = 'public.venue_safety_baseline_signoffs'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.venue_safety_baseline_signoffs
        ADD CONSTRAINT venue_safety_baseline_signoffs_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'venue_safety_baseline_signoffs_venue_id_fkey', 'venue_safety_baseline_signoffs', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venue_template_fields_venue_id_fkey'
      AND conrelid = 'public.venue_template_fields'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.venue_template_fields
        ADD CONSTRAINT venue_template_fields_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'venue_template_fields_venue_id_fkey', 'venue_template_fields', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venues_cloned_from_venue_id_fkey'
      AND conrelid = 'public.venues'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.venues
        ADD CONSTRAINT venues_cloned_from_venue_id_fkey FOREIGN KEY (cloned_from_venue_id) REFERENCES venues(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'venues_cloned_from_venue_id_fkey', 'venues', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venues_created_by_staff_id_fkey'
      AND conrelid = 'public.venues'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.venues
        ADD CONSTRAINT venues_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES staff_registry(id) ON DELETE SET NULL NOT VALID;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'SKIP FK % on %: %', 'venues_created_by_staff_id_fkey', 'venues', SQLERRM;
    END;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) VALIDATE FOREIGN KEYs (reports orphans via NOTICE, does not abort)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_checkpoints_asset_id_fkey'
      AND conrelid = 'public.asset_checkpoints'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.asset_checkpoints VALIDATE CONSTRAINT asset_checkpoints_asset_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'asset_checkpoints_asset_id_fkey', 'asset_checkpoints', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_clearance_items_checkpoint_id_fkey'
      AND conrelid = 'public.asset_clearance_items'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.asset_clearance_items VALIDATE CONSTRAINT asset_clearance_items_checkpoint_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'asset_clearance_items_checkpoint_id_fkey', 'asset_clearance_items', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_clearance_items_clearance_id_fkey'
      AND conrelid = 'public.asset_clearance_items'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.asset_clearance_items VALIDATE CONSTRAINT asset_clearance_items_clearance_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'asset_clearance_items_clearance_id_fkey', 'asset_clearance_items', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_daily_clearance_asset_id_fkey'
      AND conrelid = 'public.asset_daily_clearance'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.asset_daily_clearance VALIDATE CONSTRAINT asset_daily_clearance_asset_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'asset_daily_clearance_asset_id_fkey', 'asset_daily_clearance', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_daily_clearance_driver_auth_staff_id_fkey'
      AND conrelid = 'public.asset_daily_clearance'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.asset_daily_clearance VALIDATE CONSTRAINT asset_daily_clearance_driver_auth_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'asset_daily_clearance_driver_auth_staff_id_fkey', 'asset_daily_clearance', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_daily_clearance_manager_auth_staff_id_fkey'
      AND conrelid = 'public.asset_daily_clearance'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.asset_daily_clearance VALIDATE CONSTRAINT asset_daily_clearance_manager_auth_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'asset_daily_clearance_manager_auth_staff_id_fkey', 'asset_daily_clearance', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_maintenance_logs_asset_id_fkey'
      AND conrelid = 'public.asset_maintenance_logs'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.asset_maintenance_logs VALIDATE CONSTRAINT asset_maintenance_logs_asset_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'asset_maintenance_logs_asset_id_fkey', 'asset_maintenance_logs', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_maintenance_logs_logged_by_id_fkey'
      AND conrelid = 'public.asset_maintenance_logs'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.asset_maintenance_logs VALIDATE CONSTRAINT asset_maintenance_logs_logged_by_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'asset_maintenance_logs_logged_by_id_fkey', 'asset_maintenance_logs', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'attendance_roster_logs_participant_id_fkey'
      AND conrelid = 'public.attendance_roster_logs'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.attendance_roster_logs VALIDATE CONSTRAINT attendance_roster_logs_participant_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'attendance_roster_logs_participant_id_fkey', 'attendance_roster_logs', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'carers_registry_participant_id_fkey'
      AND conrelid = 'public.carers_registry'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.carers_registry VALIDATE CONSTRAINT carers_registry_participant_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'carers_registry_participant_id_fkey', 'carers_registry', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checklist_responses_item_id_fkey'
      AND conrelid = 'public.checklist_responses'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.checklist_responses VALIDATE CONSTRAINT checklist_responses_item_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'checklist_responses_item_id_fkey', 'checklist_responses', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checklist_responses_ledger_id_fkey'
      AND conrelid = 'public.checklist_responses'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.checklist_responses VALIDATE CONSTRAINT checklist_responses_ledger_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'checklist_responses_ledger_id_fkey', 'checklist_responses', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_attendance_log_departure_issue_id_fkey'
      AND conrelid = 'public.client_attendance_log'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.client_attendance_log VALIDATE CONSTRAINT client_attendance_log_departure_issue_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'client_attendance_log_departure_issue_id_fkey', 'client_attendance_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_attendance_log_escalation_issue_id_fkey'
      AND conrelid = 'public.client_attendance_log'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.client_attendance_log VALIDATE CONSTRAINT client_attendance_log_escalation_issue_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'client_attendance_log_escalation_issue_id_fkey', 'client_attendance_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_attendance_log_session_id_fkey'
      AND conrelid = 'public.client_attendance_log'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.client_attendance_log VALIDATE CONSTRAINT client_attendance_log_session_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'client_attendance_log_session_id_fkey', 'client_attendance_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'compliance_audit_logs_participant_id_fkey'
      AND conrelid = 'public.compliance_audit_logs'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.compliance_audit_logs VALIDATE CONSTRAINT compliance_audit_logs_participant_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'compliance_audit_logs_participant_id_fkey', 'compliance_audit_logs', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_activity_rolls_checked_in_by_id_fkey'
      AND conrelid = 'public.event_activity_rolls'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_activity_rolls VALIDATE CONSTRAINT event_activity_rolls_checked_in_by_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_activity_rolls_checked_in_by_id_fkey', 'event_activity_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_activity_rolls_event_day_session_id_fkey'
      AND conrelid = 'public.event_activity_rolls'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_activity_rolls VALIDATE CONSTRAINT event_activity_rolls_event_day_session_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_activity_rolls_event_day_session_id_fkey', 'event_activity_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_activity_rolls_marked_absent_by_id_fkey'
      AND conrelid = 'public.event_activity_rolls'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_activity_rolls VALIDATE CONSTRAINT event_activity_rolls_marked_absent_by_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_activity_rolls_marked_absent_by_id_fkey', 'event_activity_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_activity_rolls_participant_id_fkey'
      AND conrelid = 'public.event_activity_rolls'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_activity_rolls VALIDATE CONSTRAINT event_activity_rolls_participant_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_activity_rolls_participant_id_fkey', 'event_activity_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_activity_rolls_venue_stop_id_fkey'
      AND conrelid = 'public.event_activity_rolls'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_activity_rolls VALIDATE CONSTRAINT event_activity_rolls_venue_stop_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_activity_rolls_venue_stop_id_fkey', 'event_activity_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_attendance_log_escalation_issue_id_fkey'
      AND conrelid = 'public.event_attendance_log'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_attendance_log VALIDATE CONSTRAINT event_attendance_log_escalation_issue_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_attendance_log_escalation_issue_id_fkey', 'event_attendance_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_attendance_log_event_day_session_id_fkey'
      AND conrelid = 'public.event_attendance_log'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_attendance_log VALIDATE CONSTRAINT event_attendance_log_event_day_session_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_attendance_log_event_day_session_id_fkey', 'event_attendance_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_bus_manifest_carer_id_fkey'
      AND conrelid = 'public.event_bus_manifest'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_bus_manifest VALIDATE CONSTRAINT event_bus_manifest_carer_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_bus_manifest_carer_id_fkey', 'event_bus_manifest', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_bus_manifest_checked_on_by_fkey'
      AND conrelid = 'public.event_bus_manifest'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_bus_manifest VALIDATE CONSTRAINT event_bus_manifest_checked_on_by_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_bus_manifest_checked_on_by_fkey', 'event_bus_manifest', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_bus_manifest_event_day_session_id_fkey'
      AND conrelid = 'public.event_bus_manifest'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_bus_manifest VALIDATE CONSTRAINT event_bus_manifest_event_day_session_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_bus_manifest_event_day_session_id_fkey', 'event_bus_manifest', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_bus_manifest_participant_id_fkey'
      AND conrelid = 'public.event_bus_manifest'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_bus_manifest VALIDATE CONSTRAINT event_bus_manifest_participant_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_bus_manifest_participant_id_fkey', 'event_bus_manifest', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_bus_manifest_transport_trip_id_fkey'
      AND conrelid = 'public.event_bus_manifest'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_bus_manifest VALIDATE CONSTRAINT event_bus_manifest_transport_trip_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_bus_manifest_transport_trip_id_fkey', 'event_bus_manifest', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_curfew_log_accounted_by_fkey'
      AND conrelid = 'public.event_curfew_log'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_curfew_log VALIDATE CONSTRAINT event_curfew_log_accounted_by_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_curfew_log_accounted_by_fkey', 'event_curfew_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_curfew_log_escalation_issue_id_fkey'
      AND conrelid = 'public.event_curfew_log'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_curfew_log VALIDATE CONSTRAINT event_curfew_log_escalation_issue_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_curfew_log_escalation_issue_id_fkey', 'event_curfew_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_curfew_log_event_day_session_id_fkey'
      AND conrelid = 'public.event_curfew_log'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_curfew_log VALIDATE CONSTRAINT event_curfew_log_event_day_session_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_curfew_log_event_day_session_id_fkey', 'event_curfew_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_curfew_log_participant_id_fkey'
      AND conrelid = 'public.event_curfew_log'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_curfew_log VALIDATE CONSTRAINT event_curfew_log_participant_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_curfew_log_participant_id_fkey', 'event_curfew_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_day_med_alternate_plans_attested_by_staff_id_fkey'
      AND conrelid = 'public.event_day_med_alternate_plans'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_day_med_alternate_plans VALIDATE CONSTRAINT event_day_med_alternate_plans_attested_by_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_day_med_alternate_plans_attested_by_staff_id_fkey', 'event_day_med_alternate_plans', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_day_med_alternate_plans_event_day_session_id_fkey'
      AND conrelid = 'public.event_day_med_alternate_plans'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_day_med_alternate_plans VALIDATE CONSTRAINT event_day_med_alternate_plans_event_day_session_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_day_med_alternate_plans_event_day_session_id_fkey', 'event_day_med_alternate_plans', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_day_med_alternate_plans_participant_id_fkey'
      AND conrelid = 'public.event_day_med_alternate_plans'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_day_med_alternate_plans VALIDATE CONSTRAINT event_day_med_alternate_plans_participant_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_day_med_alternate_plans_participant_id_fkey', 'event_day_med_alternate_plans', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_day_sessions_closed_by_id_fkey'
      AND conrelid = 'public.event_day_sessions'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_day_sessions VALIDATE CONSTRAINT event_day_sessions_closed_by_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_day_sessions_closed_by_id_fkey', 'event_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_day_sessions_event_id_fkey'
      AND conrelid = 'public.event_day_sessions'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_day_sessions VALIDATE CONSTRAINT event_day_sessions_event_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_day_sessions_event_id_fkey', 'event_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_day_sessions_manager_staff_id_fkey'
      AND conrelid = 'public.event_day_sessions'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_day_sessions VALIDATE CONSTRAINT event_day_sessions_manager_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_day_sessions_manager_staff_id_fkey', 'event_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_day_sessions_opened_by_id_fkey'
      AND conrelid = 'public.event_day_sessions'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_day_sessions VALIDATE CONSTRAINT event_day_sessions_opened_by_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_day_sessions_opened_by_id_fkey', 'event_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_day_sessions_programme_suspend_hub_issue_id_fkey'
      AND conrelid = 'public.event_day_sessions'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_day_sessions VALIDATE CONSTRAINT event_day_sessions_programme_suspend_hub_issue_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_day_sessions_programme_suspend_hub_issue_id_fkey', 'event_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_day_sessions_programme_suspended_by_staff_id_fkey'
      AND conrelid = 'public.event_day_sessions'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_day_sessions VALIDATE CONSTRAINT event_day_sessions_programme_suspended_by_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_day_sessions_programme_suspended_by_staff_id_fkey', 'event_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_financial_ledger_event_id_fkey'
      AND conrelid = 'public.event_financial_ledger'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_financial_ledger VALIDATE CONSTRAINT event_financial_ledger_event_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_financial_ledger_event_id_fkey', 'event_financial_ledger', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_manifest_base_hotel_venue_id_fkey'
      AND conrelid = 'public.event_manifest'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_manifest VALIDATE CONSTRAINT event_manifest_base_hotel_venue_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_manifest_base_hotel_venue_id_fkey', 'event_manifest', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_manifest_closed_by_id_fkey'
      AND conrelid = 'public.event_manifest'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_manifest VALIDATE CONSTRAINT event_manifest_closed_by_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_manifest_closed_by_id_fkey', 'event_manifest', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_manifest_default_charge_code_id_fkey'
      AND conrelid = 'public.event_manifest'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_manifest VALIDATE CONSTRAINT event_manifest_default_charge_code_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_manifest_default_charge_code_id_fkey', 'event_manifest', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_manifest_primary_venue_id_fkey'
      AND conrelid = 'public.event_manifest'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_manifest VALIDATE CONSTRAINT event_manifest_primary_venue_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_manifest_primary_venue_id_fkey', 'event_manifest', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_meal_service_rolls_participant_id_fkey'
      AND conrelid = 'public.event_meal_service_rolls'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_meal_service_rolls VALIDATE CONSTRAINT event_meal_service_rolls_participant_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_meal_service_rolls_participant_id_fkey', 'event_meal_service_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_meal_service_rolls_updated_by_id_fkey'
      AND conrelid = 'public.event_meal_service_rolls'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_meal_service_rolls VALIDATE CONSTRAINT event_meal_service_rolls_updated_by_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_meal_service_rolls_updated_by_id_fkey', 'event_meal_service_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_meal_service_rolls_venue_stop_id_fkey'
      AND conrelid = 'public.event_meal_service_rolls'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_meal_service_rolls VALIDATE CONSTRAINT event_meal_service_rolls_venue_stop_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_meal_service_rolls_venue_stop_id_fkey', 'event_meal_service_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_morning_log_accounted_by_fkey'
      AND conrelid = 'public.event_morning_log'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_morning_log VALIDATE CONSTRAINT event_morning_log_accounted_by_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_morning_log_accounted_by_fkey', 'event_morning_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_morning_log_escalation_issue_id_fkey'
      AND conrelid = 'public.event_morning_log'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_morning_log VALIDATE CONSTRAINT event_morning_log_escalation_issue_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_morning_log_escalation_issue_id_fkey', 'event_morning_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_morning_log_event_day_session_id_fkey'
      AND conrelid = 'public.event_morning_log'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_morning_log VALIDATE CONSTRAINT event_morning_log_event_day_session_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_morning_log_event_day_session_id_fkey', 'event_morning_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_morning_log_participant_id_fkey'
      AND conrelid = 'public.event_morning_log'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_morning_log VALIDATE CONSTRAINT event_morning_log_participant_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_morning_log_participant_id_fkey', 'event_morning_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_roster_bookings_carer_id_fkey'
      AND conrelid = 'public.event_roster_bookings'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_roster_bookings VALIDATE CONSTRAINT event_roster_bookings_carer_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_roster_bookings_carer_id_fkey', 'event_roster_bookings', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_roster_bookings_charge_code_id_fkey'
      AND conrelid = 'public.event_roster_bookings'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_roster_bookings VALIDATE CONSTRAINT event_roster_bookings_charge_code_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_roster_bookings_charge_code_id_fkey', 'event_roster_bookings', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_roster_bookings_companion_carer_id_fkey'
      AND conrelid = 'public.event_roster_bookings'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_roster_bookings VALIDATE CONSTRAINT event_roster_bookings_companion_carer_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_roster_bookings_companion_carer_id_fkey', 'event_roster_bookings', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_roster_bookings_event_id_fkey'
      AND conrelid = 'public.event_roster_bookings'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_roster_bookings VALIDATE CONSTRAINT event_roster_bookings_event_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_roster_bookings_event_id_fkey', 'event_roster_bookings', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_roster_bookings_host_participant_id_fkey'
      AND conrelid = 'public.event_roster_bookings'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_roster_bookings VALIDATE CONSTRAINT event_roster_bookings_host_participant_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_roster_bookings_host_participant_id_fkey', 'event_roster_bookings', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_roster_bookings_participant_id_fkey'
      AND conrelid = 'public.event_roster_bookings'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_roster_bookings VALIDATE CONSTRAINT event_roster_bookings_participant_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_roster_bookings_participant_id_fkey', 'event_roster_bookings', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_reconfirmations_event_id_fkey'
      AND conrelid = 'public.event_venue_reconfirmations'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_reconfirmations VALIDATE CONSTRAINT event_venue_reconfirmations_event_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_venue_reconfirmations_event_id_fkey', 'event_venue_reconfirmations', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_reconfirmations_reconfirmed_by_staff_id_fkey'
      AND conrelid = 'public.event_venue_reconfirmations'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_reconfirmations VALIDATE CONSTRAINT event_venue_reconfirmations_reconfirmed_by_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_venue_reconfirmations_reconfirmed_by_staff_id_fkey', 'event_venue_reconfirmations', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_reconfirmations_venue_id_fkey'
      AND conrelid = 'public.event_venue_reconfirmations'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_reconfirmations VALIDATE CONSTRAINT event_venue_reconfirmations_venue_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_venue_reconfirmations_venue_id_fkey', 'event_venue_reconfirmations', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_event_id_fkey'
      AND conrelid = 'public.event_venue_stops'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_stops VALIDATE CONSTRAINT event_venue_stops_event_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_venue_stops_event_id_fkey', 'event_venue_stops', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_opened_by_id_fkey'
      AND conrelid = 'public.event_venue_stops'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_stops VALIDATE CONSTRAINT event_venue_stops_opened_by_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_venue_stops_opened_by_id_fkey', 'event_venue_stops', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_prep_attested_by_staff_id_fkey'
      AND conrelid = 'public.event_venue_stops'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_stops VALIDATE CONSTRAINT event_venue_stops_prep_attested_by_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_venue_stops_prep_attested_by_staff_id_fkey', 'event_venue_stops', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_prepared_by_staff_id_fkey'
      AND conrelid = 'public.event_venue_stops'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_stops VALIDATE CONSTRAINT event_venue_stops_prepared_by_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_venue_stops_prepared_by_staff_id_fkey', 'event_venue_stops', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_sfh_approved_by_staff_id_fkey'
      AND conrelid = 'public.event_venue_stops'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_stops VALIDATE CONSTRAINT event_venue_stops_sfh_approved_by_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_venue_stops_sfh_approved_by_staff_id_fkey', 'event_venue_stops', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_venue_stops_venue_id_fkey'
      AND conrelid = 'public.event_venue_stops'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.event_venue_stops VALIDATE CONSTRAINT event_venue_stops_venue_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'event_venue_stops_venue_id_fkey', 'event_venue_stops', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'maintenance_notes_item_id_fkey'
      AND conrelid = 'public.maintenance_notes'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.maintenance_notes VALIDATE CONSTRAINT maintenance_notes_item_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'maintenance_notes_item_id_fkey', 'maintenance_notes', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'medication_administration_log_administered_by_id_fkey'
      AND conrelid = 'public.medication_administration_log'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.medication_administration_log VALIDATE CONSTRAINT medication_administration_log_administered_by_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'medication_administration_log_administered_by_id_fkey', 'medication_administration_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'medication_administration_log_participant_id_fkey'
      AND conrelid = 'public.medication_administration_log'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.medication_administration_log VALIDATE CONSTRAINT medication_administration_log_participant_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'medication_administration_log_participant_id_fkey', 'medication_administration_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'medication_administration_log_schedule_id_fkey'
      AND conrelid = 'public.medication_administration_log'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.medication_administration_log VALIDATE CONSTRAINT medication_administration_log_schedule_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'medication_administration_log_schedule_id_fkey', 'medication_administration_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'medication_administration_log_witnessed_by_id_fkey'
      AND conrelid = 'public.medication_administration_log'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.medication_administration_log VALIDATE CONSTRAINT medication_administration_log_witnessed_by_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'medication_administration_log_witnessed_by_id_fkey', 'medication_administration_log', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'myob_export_batches_exported_by_fkey'
      AND conrelid = 'public.myob_export_batches'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.myob_export_batches VALIDATE CONSTRAINT myob_export_batches_exported_by_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'myob_export_batches_exported_by_fkey', 'myob_export_batches', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_emergencies_activated_by_staff_id_fkey'
      AND conrelid = 'public.operational_emergencies'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.operational_emergencies VALIDATE CONSTRAINT operational_emergencies_activated_by_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'operational_emergencies_activated_by_staff_id_fkey', 'operational_emergencies', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_emergencies_hub_issue_id_fkey'
      AND conrelid = 'public.operational_emergencies'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.operational_emergencies VALIDATE CONSTRAINT operational_emergencies_hub_issue_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'operational_emergencies_hub_issue_id_fkey', 'operational_emergencies', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_emergencies_site_day_session_id_fkey'
      AND conrelid = 'public.operational_emergencies'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.operational_emergencies VALIDATE CONSTRAINT operational_emergencies_site_day_session_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'operational_emergencies_site_day_session_id_fkey', 'operational_emergencies', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_emergencies_stood_down_by_staff_id_fkey'
      AND conrelid = 'public.operational_emergencies'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.operational_emergencies VALIDATE CONSTRAINT operational_emergencies_stood_down_by_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'operational_emergencies_stood_down_by_staff_id_fkey', 'operational_emergencies', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_emergency_muster_emergency_id_fkey'
      AND conrelid = 'public.operational_emergency_muster'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.operational_emergency_muster VALIDATE CONSTRAINT operational_emergency_muster_emergency_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'operational_emergency_muster_emergency_id_fkey', 'operational_emergency_muster', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_emergency_muster_participant_id_fkey'
      AND conrelid = 'public.operational_emergency_muster'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.operational_emergency_muster VALIDATE CONSTRAINT operational_emergency_muster_participant_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'operational_emergency_muster_participant_id_fkey', 'operational_emergency_muster', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_emergency_muster_updated_by_staff_id_fkey'
      AND conrelid = 'public.operational_emergency_muster'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.operational_emergency_muster VALIDATE CONSTRAINT operational_emergency_muster_updated_by_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'operational_emergency_muster_updated_by_staff_id_fkey', 'operational_emergency_muster', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_escalations_claimed_by_fkey'
      AND conrelid = 'public.operational_escalations'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.operational_escalations VALIDATE CONSTRAINT operational_escalations_claimed_by_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'operational_escalations_claimed_by_fkey', 'operational_escalations', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_escalations_clearance_id_fkey'
      AND conrelid = 'public.operational_escalations'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.operational_escalations VALIDATE CONSTRAINT operational_escalations_clearance_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'operational_escalations_clearance_id_fkey', 'operational_escalations', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_escalations_operator_acknowledged_by_fkey'
      AND conrelid = 'public.operational_escalations'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.operational_escalations VALIDATE CONSTRAINT operational_escalations_operator_acknowledged_by_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'operational_escalations_operator_acknowledged_by_fkey', 'operational_escalations', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_escalations_raised_by_fkey'
      AND conrelid = 'public.operational_escalations'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.operational_escalations VALIDATE CONSTRAINT operational_escalations_raised_by_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'operational_escalations_raised_by_fkey', 'operational_escalations', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_escalations_resolved_by_fkey'
      AND conrelid = 'public.operational_escalations'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.operational_escalations VALIDATE CONSTRAINT operational_escalations_resolved_by_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'operational_escalations_resolved_by_fkey', 'operational_escalations', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_incidents_assisting_staff_id_fkey'
      AND conrelid = 'public.operational_incidents'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.operational_incidents VALIDATE CONSTRAINT operational_incidents_assisting_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'operational_incidents_assisting_staff_id_fkey', 'operational_incidents', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_attendance_schedules_archive_witnessed_by_id_fkey'
      AND conrelid = 'public.participant_attendance_schedules'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.participant_attendance_schedules VALIDATE CONSTRAINT participant_attendance_schedules_archive_witnessed_by_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'participant_attendance_schedules_archive_witnessed_by_id_fkey', 'participant_attendance_schedules', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_attendance_schedules_archived_by_id_fkey'
      AND conrelid = 'public.participant_attendance_schedules'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.participant_attendance_schedules VALIDATE CONSTRAINT participant_attendance_schedules_archived_by_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'participant_attendance_schedules_archived_by_id_fkey', 'participant_attendance_schedules', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_attendance_schedules_participant_id_fkey'
      AND conrelid = 'public.participant_attendance_schedules'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.participant_attendance_schedules VALIDATE CONSTRAINT participant_attendance_schedules_participant_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'participant_attendance_schedules_participant_id_fkey', 'participant_attendance_schedules', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_compliance_and_alerts_participant_id_fkey'
      AND conrelid = 'public.participant_compliance_and_alerts'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.participant_compliance_and_alerts VALIDATE CONSTRAINT participant_compliance_and_alerts_participant_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'participant_compliance_and_alerts_participant_id_fkey', 'participant_compliance_and_alerts', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_financial_ledger_event_id_fkey'
      AND conrelid = 'public.participant_financial_ledger'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.participant_financial_ledger VALIDATE CONSTRAINT participant_financial_ledger_event_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'participant_financial_ledger_event_id_fkey', 'participant_financial_ledger', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_financial_ledger_participant_id_fkey'
      AND conrelid = 'public.participant_financial_ledger'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.participant_financial_ledger VALIDATE CONSTRAINT participant_financial_ledger_participant_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'participant_financial_ledger_participant_id_fkey', 'participant_financial_ledger', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_infectious_exclusions_cleared_by_staff_id_fkey'
      AND conrelid = 'public.participant_infectious_exclusions'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.participant_infectious_exclusions VALIDATE CONSTRAINT participant_infectious_exclusions_cleared_by_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'participant_infectious_exclusions_cleared_by_staff_id_fkey', 'participant_infectious_exclusions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_infectious_exclusions_declared_by_staff_id_fkey'
      AND conrelid = 'public.participant_infectious_exclusions'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.participant_infectious_exclusions VALIDATE CONSTRAINT participant_infectious_exclusions_declared_by_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'participant_infectious_exclusions_declared_by_staff_id_fkey', 'participant_infectious_exclusions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_infectious_exclusions_event_day_session_id_fkey'
      AND conrelid = 'public.participant_infectious_exclusions'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.participant_infectious_exclusions VALIDATE CONSTRAINT participant_infectious_exclusions_event_day_session_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'participant_infectious_exclusions_event_day_session_id_fkey', 'participant_infectious_exclusions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_infectious_exclusions_event_id_fkey'
      AND conrelid = 'public.participant_infectious_exclusions'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.participant_infectious_exclusions VALIDATE CONSTRAINT participant_infectious_exclusions_event_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'participant_infectious_exclusions_event_id_fkey', 'participant_infectious_exclusions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_infectious_exclusions_home_safe_by_staff_id_fkey'
      AND conrelid = 'public.participant_infectious_exclusions'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.participant_infectious_exclusions VALIDATE CONSTRAINT participant_infectious_exclusions_home_safe_by_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'participant_infectious_exclusions_home_safe_by_staff_id_fkey', 'participant_infectious_exclusions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_infectious_exclusions_hub_issue_id_fkey'
      AND conrelid = 'public.participant_infectious_exclusions'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.participant_infectious_exclusions VALIDATE CONSTRAINT participant_infectious_exclusions_hub_issue_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'participant_infectious_exclusions_hub_issue_id_fkey', 'participant_infectious_exclusions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_infectious_exclusions_participant_id_fkey'
      AND conrelid = 'public.participant_infectious_exclusions'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.participant_infectious_exclusions VALIDATE CONSTRAINT participant_infectious_exclusions_participant_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'participant_infectious_exclusions_participant_id_fkey', 'participant_infectious_exclusions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_infectious_exclusions_site_day_session_id_fkey'
      AND conrelid = 'public.participant_infectious_exclusions'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.participant_infectious_exclusions VALIDATE CONSTRAINT participant_infectious_exclusions_site_day_session_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'participant_infectious_exclusions_site_day_session_id_fkey', 'participant_infectious_exclusions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participant_medication_schedules_participant_id_fkey'
      AND conrelid = 'public.participant_medication_schedules'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.participant_medication_schedules VALIDATE CONSTRAINT participant_medication_schedules_participant_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'participant_medication_schedules_participant_id_fkey', 'participant_medication_schedules', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_activities_closed_by_id_fkey'
      AND conrelid = 'public.site_day_activities'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_activities VALIDATE CONSTRAINT site_day_activities_closed_by_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'site_day_activities_closed_by_id_fkey', 'site_day_activities', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_activities_opened_by_id_fkey'
      AND conrelid = 'public.site_day_activities'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_activities VALIDATE CONSTRAINT site_day_activities_opened_by_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'site_day_activities_opened_by_id_fkey', 'site_day_activities', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_activities_prep_attested_by_staff_id_fkey'
      AND conrelid = 'public.site_day_activities'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_activities VALIDATE CONSTRAINT site_day_activities_prep_attested_by_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'site_day_activities_prep_attested_by_staff_id_fkey', 'site_day_activities', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_activities_prepared_by_staff_id_fkey'
      AND conrelid = 'public.site_day_activities'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_activities VALIDATE CONSTRAINT site_day_activities_prepared_by_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'site_day_activities_prepared_by_staff_id_fkey', 'site_day_activities', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_activities_session_id_fkey'
      AND conrelid = 'public.site_day_activities'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_activities VALIDATE CONSTRAINT site_day_activities_session_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'site_day_activities_session_id_fkey', 'site_day_activities', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_activities_sfh_approved_by_staff_id_fkey'
      AND conrelid = 'public.site_day_activities'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_activities VALIDATE CONSTRAINT site_day_activities_sfh_approved_by_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'site_day_activities_sfh_approved_by_staff_id_fkey', 'site_day_activities', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_meal_service_rolls_activity_id_fkey'
      AND conrelid = 'public.site_day_meal_service_rolls'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_meal_service_rolls VALIDATE CONSTRAINT site_day_meal_service_rolls_activity_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'site_day_meal_service_rolls_activity_id_fkey', 'site_day_meal_service_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_meal_service_rolls_participant_id_fkey'
      AND conrelid = 'public.site_day_meal_service_rolls'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_meal_service_rolls VALIDATE CONSTRAINT site_day_meal_service_rolls_participant_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'site_day_meal_service_rolls_participant_id_fkey', 'site_day_meal_service_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_meal_service_rolls_updated_by_id_fkey'
      AND conrelid = 'public.site_day_meal_service_rolls'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_meal_service_rolls VALIDATE CONSTRAINT site_day_meal_service_rolls_updated_by_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'site_day_meal_service_rolls_updated_by_id_fkey', 'site_day_meal_service_rolls', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_sessions_closed_by_id_fkey'
      AND conrelid = 'public.site_day_sessions'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_sessions VALIDATE CONSTRAINT site_day_sessions_closed_by_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'site_day_sessions_closed_by_id_fkey', 'site_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_sessions_leader_auth_staff_id_fkey'
      AND conrelid = 'public.site_day_sessions'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_sessions VALIDATE CONSTRAINT site_day_sessions_leader_auth_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'site_day_sessions_leader_auth_staff_id_fkey', 'site_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_sessions_lockdown_by_staff_id_fkey'
      AND conrelid = 'public.site_day_sessions'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_sessions VALIDATE CONSTRAINT site_day_sessions_lockdown_by_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'site_day_sessions_lockdown_by_staff_id_fkey', 'site_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_sessions_lockdown_hub_issue_id_fkey'
      AND conrelid = 'public.site_day_sessions'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_sessions VALIDATE CONSTRAINT site_day_sessions_lockdown_hub_issue_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'site_day_sessions_lockdown_hub_issue_id_fkey', 'site_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_sessions_manager_auth_staff_id_fkey'
      AND conrelid = 'public.site_day_sessions'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_sessions VALIDATE CONSTRAINT site_day_sessions_manager_auth_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'site_day_sessions_manager_auth_staff_id_fkey', 'site_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_sessions_opened_by_id_fkey'
      AND conrelid = 'public.site_day_sessions'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_sessions VALIDATE CONSTRAINT site_day_sessions_opened_by_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'site_day_sessions_opened_by_id_fkey', 'site_day_sessions', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_visitors_linked_participant_id_fkey'
      AND conrelid = 'public.site_day_visitors'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_visitors VALIDATE CONSTRAINT site_day_visitors_linked_participant_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'site_day_visitors_linked_participant_id_fkey', 'site_day_visitors', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_day_visitors_session_id_fkey'
      AND conrelid = 'public.site_day_visitors'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.site_day_visitors VALIDATE CONSTRAINT site_day_visitors_session_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'site_day_visitors_session_id_fkey', 'site_day_visitors', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_issues_register_event_day_session_id_fkey'
      AND conrelid = 'public.site_issues_register'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.site_issues_register VALIDATE CONSTRAINT site_issues_register_event_day_session_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'site_issues_register_event_day_session_id_fkey', 'site_issues_register', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_issues_register_event_id_fkey'
      AND conrelid = 'public.site_issues_register'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.site_issues_register VALIDATE CONSTRAINT site_issues_register_event_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'site_issues_register_event_id_fkey', 'site_issues_register', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_issues_register_session_id_fkey'
      AND conrelid = 'public.site_issues_register'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.site_issues_register VALIDATE CONSTRAINT site_issues_register_session_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'site_issues_register_session_id_fkey', 'site_issues_register', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'staff_compliance_and_certs_staff_id_fkey'
      AND conrelid = 'public.staff_compliance_and_certs'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.staff_compliance_and_certs VALIDATE CONSTRAINT staff_compliance_and_certs_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'staff_compliance_and_certs_staff_id_fkey', 'staff_compliance_and_certs', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'staff_registry_auth_user_id_fkey'
      AND conrelid = 'public.staff_registry'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.staff_registry VALIDATE CONSTRAINT staff_registry_auth_user_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'staff_registry_auth_user_id_fkey', 'staff_registry', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'system_operational_settings_updated_by_fkey'
      AND conrelid = 'public.system_operational_settings'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.system_operational_settings VALIDATE CONSTRAINT system_operational_settings_updated_by_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'system_operational_settings_updated_by_fkey', 'system_operational_settings', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'system_operational_settings_value_uuid_fkey'
      AND conrelid = 'public.system_operational_settings'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.system_operational_settings VALIDATE CONSTRAINT system_operational_settings_value_uuid_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'system_operational_settings_value_uuid_fkey', 'system_operational_settings', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_requests_assigned_asset_id_fkey'
      AND conrelid = 'public.transport_requests'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.transport_requests VALIDATE CONSTRAINT transport_requests_assigned_asset_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'transport_requests_assigned_asset_id_fkey', 'transport_requests', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_requests_assigned_driver_staff_id_fkey'
      AND conrelid = 'public.transport_requests'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.transport_requests VALIDATE CONSTRAINT transport_requests_assigned_driver_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'transport_requests_assigned_driver_staff_id_fkey', 'transport_requests', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_requests_created_by_staff_id_fkey'
      AND conrelid = 'public.transport_requests'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.transport_requests VALIDATE CONSTRAINT transport_requests_created_by_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'transport_requests_created_by_staff_id_fkey', 'transport_requests', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_requests_participant_id_fkey'
      AND conrelid = 'public.transport_requests'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.transport_requests VALIDATE CONSTRAINT transport_requests_participant_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'transport_requests_participant_id_fkey', 'transport_requests', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_trips_asset_id_fkey'
      AND conrelid = 'public.transport_trips'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.transport_trips VALIDATE CONSTRAINT transport_trips_asset_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'transport_trips_asset_id_fkey', 'transport_trips', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_trips_driver_id_fkey'
      AND conrelid = 'public.transport_trips'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.transport_trips VALIDATE CONSTRAINT transport_trips_driver_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'transport_trips_driver_id_fkey', 'transport_trips', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_trips_event_day_session_id_fkey'
      AND conrelid = 'public.transport_trips'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.transport_trips VALIDATE CONSTRAINT transport_trips_event_day_session_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'transport_trips_event_day_session_id_fkey', 'transport_trips', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_trips_event_id_fkey'
      AND conrelid = 'public.transport_trips'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.transport_trips VALIDATE CONSTRAINT transport_trips_event_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'transport_trips_event_id_fkey', 'transport_trips', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_trips_venue_stop_from_id_fkey'
      AND conrelid = 'public.transport_trips'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.transport_trips VALIDATE CONSTRAINT transport_trips_venue_stop_from_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'transport_trips_venue_stop_from_id_fkey', 'transport_trips', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_trips_venue_stop_to_id_fkey'
      AND conrelid = 'public.transport_trips'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.transport_trips VALIDATE CONSTRAINT transport_trips_venue_stop_to_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'transport_trips_venue_stop_to_id_fkey', 'transport_trips', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trip_legs_participant_id_fkey'
      AND conrelid = 'public.trip_legs'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.trip_legs VALIDATE CONSTRAINT trip_legs_participant_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'trip_legs_participant_id_fkey', 'trip_legs', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trip_legs_trip_id_fkey'
      AND conrelid = 'public.trip_legs'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.trip_legs VALIDATE CONSTRAINT trip_legs_trip_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'trip_legs_trip_id_fkey', 'trip_legs', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venue_safety_answers_field_id_fkey'
      AND conrelid = 'public.venue_safety_answers'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.venue_safety_answers VALIDATE CONSTRAINT venue_safety_answers_field_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'venue_safety_answers_field_id_fkey', 'venue_safety_answers', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venue_safety_answers_signoff_id_fkey'
      AND conrelid = 'public.venue_safety_answers'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.venue_safety_answers VALIDATE CONSTRAINT venue_safety_answers_signoff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'venue_safety_answers_signoff_id_fkey', 'venue_safety_answers', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venue_safety_baseline_signoffs_signed_off_by_staff_id_fkey'
      AND conrelid = 'public.venue_safety_baseline_signoffs'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.venue_safety_baseline_signoffs VALIDATE CONSTRAINT venue_safety_baseline_signoffs_signed_off_by_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'venue_safety_baseline_signoffs_signed_off_by_staff_id_fkey', 'venue_safety_baseline_signoffs', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venue_safety_baseline_signoffs_venue_id_fkey'
      AND conrelid = 'public.venue_safety_baseline_signoffs'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.venue_safety_baseline_signoffs VALIDATE CONSTRAINT venue_safety_baseline_signoffs_venue_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'venue_safety_baseline_signoffs_venue_id_fkey', 'venue_safety_baseline_signoffs', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venue_template_fields_venue_id_fkey'
      AND conrelid = 'public.venue_template_fields'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.venue_template_fields VALIDATE CONSTRAINT venue_template_fields_venue_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'venue_template_fields_venue_id_fkey', 'venue_template_fields', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venues_cloned_from_venue_id_fkey'
      AND conrelid = 'public.venues'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.venues VALIDATE CONSTRAINT venues_cloned_from_venue_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'venues_cloned_from_venue_id_fkey', 'venues', SQLERRM;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venues_created_by_staff_id_fkey'
      AND conrelid = 'public.venues'::regclass
      AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE public.venues VALIDATE CONSTRAINT venues_created_by_staff_id_fkey;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'UNVALIDATED FK % on % (orphans?): %', 'venues_created_by_staff_id_fkey', 'venues', SQLERRM;
    END;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Indexes not already created by PRIMARY KEY / UNIQUE constraints
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_maintenance_asset ON public.asset_maintenance_logs USING btree (asset_id, log_type);

CREATE INDEX IF NOT EXISTS idx_asset_type_status ON public.assets USING btree (asset_type, status);

CREATE UNIQUE INDEX IF NOT EXISTS carers_registry_one_primary_per_participant ON public.carers_registry USING btree (participant_id) WHERE ((is_primary_contact = true) AND (participant_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS checklist_items_category_idx ON public.checklist_items USING btree (category, sort_order);

CREATE INDEX IF NOT EXISTS checklist_responses_ledger_idx ON public.checklist_responses USING btree (ledger_id);

CREATE INDEX IF NOT EXISTS client_attendance_log_expected_dep_idx ON public.client_attendance_log USING btree (expected_departure_at);

CREATE INDEX IF NOT EXISTS client_attendance_log_expected_idx ON public.client_attendance_log USING btree (expected_arrival_at);

CREATE INDEX IF NOT EXISTS client_attendance_log_session_idx ON public.client_attendance_log USING btree (session_id);

CREATE INDEX IF NOT EXISTS client_attendance_log_status_idx ON public.client_attendance_log USING btree (status);

CREATE INDEX IF NOT EXISTS compliance_assets_action_module_idx ON public.compliance_assets USING btree (action_module);

CREATE INDEX IF NOT EXISTS compliance_assets_active_next_action_idx ON public.compliance_assets USING btree (status, next_action_at);

CREATE INDEX IF NOT EXISTS compliance_assets_category_idx ON public.compliance_assets USING btree (category);

CREATE INDEX IF NOT EXISTS compliance_assets_subject_idx ON public.compliance_assets USING btree (subject_table, subject_id);

CREATE INDEX IF NOT EXISTS event_attendance_log_session_idx ON public.event_attendance_log USING btree (event_day_session_id);

CREATE INDEX IF NOT EXISTS event_attendance_log_status_idx ON public.event_attendance_log USING btree (status);

CREATE INDEX IF NOT EXISTS event_bus_manifest_session_idx ON public.event_bus_manifest USING btree (event_day_session_id);

CREATE UNIQUE INDEX IF NOT EXISTS event_bus_manifest_trip_carer_uidx ON public.event_bus_manifest USING btree (transport_trip_id, carer_id) WHERE (carer_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS event_bus_manifest_trip_participant_uidx ON public.event_bus_manifest USING btree (transport_trip_id, participant_id) WHERE (participant_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS event_bus_manifest_trip_status_idx ON public.event_bus_manifest USING btree (transport_trip_id, status);

CREATE INDEX IF NOT EXISTS event_curfew_log_expected_idx ON public.event_curfew_log USING btree (expected_accounted_at);

CREATE INDEX IF NOT EXISTS event_curfew_log_session_idx ON public.event_curfew_log USING btree (event_day_session_id);

CREATE INDEX IF NOT EXISTS event_curfew_log_status_idx ON public.event_curfew_log USING btree (status);

CREATE INDEX IF NOT EXISTS idx_event_day_med_alternate_plans_session ON public.event_day_med_alternate_plans USING btree (event_day_session_id);

CREATE INDEX IF NOT EXISTS event_day_sessions_event_date_idx ON public.event_day_sessions USING btree (event_id, session_date);

CREATE INDEX IF NOT EXISTS event_day_sessions_phase_idx ON public.event_day_sessions USING btree (phase);

CREATE INDEX IF NOT EXISTS event_manifest_event_kind_idx ON public.event_manifest USING btree (event_kind);

CREATE INDEX IF NOT EXISTS event_manifest_primary_venue_idx ON public.event_manifest USING btree (primary_venue_id) WHERE (primary_venue_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_event_meal_service_rolls_stop ON public.event_meal_service_rolls USING btree (venue_stop_id);

CREATE INDEX IF NOT EXISTS event_morning_log_expected_idx ON public.event_morning_log USING btree (expected_accounted_at);

CREATE INDEX IF NOT EXISTS event_morning_log_session_idx ON public.event_morning_log USING btree (event_day_session_id);

CREATE INDEX IF NOT EXISTS event_morning_log_status_idx ON public.event_morning_log USING btree (status);

CREATE INDEX IF NOT EXISTS event_roster_bookings_carer_id_idx ON public.event_roster_bookings USING btree (carer_id);

CREATE INDEX IF NOT EXISTS event_roster_bookings_event_pickup_order_idx ON public.event_roster_bookings USING btree (event_id, pickup_order);

CREATE INDEX IF NOT EXISTS event_roster_bookings_guest_idx ON public.event_roster_bookings USING btree (event_id) WHERE (is_guest_booking = true);

CREATE INDEX IF NOT EXISTS event_venue_reconfirmations_event_idx ON public.event_venue_reconfirmations USING btree (event_id);

CREATE INDEX IF NOT EXISTS event_venue_stops_event_date_idx ON public.event_venue_stops USING btree (event_id, session_date, stop_order);

CREATE INDEX IF NOT EXISTS hub_issue_notes_source_row_idx ON public.hub_issue_notes USING btree (source, source_row_id, stamped_at);

CREATE INDEX IF NOT EXISTS maintenance_items_created_at_idx ON public.maintenance_items USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS maintenance_items_event_id_idx ON public.maintenance_items USING btree (event_id) WHERE (event_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS maintenance_items_severity_idx ON public.maintenance_items USING btree (severity);

CREATE INDEX IF NOT EXISTS maintenance_items_source_idx ON public.maintenance_items USING btree (source);

CREATE INDEX IF NOT EXISTS maintenance_items_status_idx ON public.maintenance_items USING btree (status);

CREATE INDEX IF NOT EXISTS maintenance_notes_item_id_idx ON public.maintenance_notes USING btree (item_id, created_at);

CREATE INDEX IF NOT EXISTS idx_op_emergencies_active ON public.operational_emergencies USING btree (status) WHERE (status = 'active'::text);

CREATE INDEX IF NOT EXISTS idx_op_emergencies_event_day ON public.operational_emergencies USING btree (event_day_session_id) WHERE (event_day_session_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_op_emergencies_hub ON public.operational_emergencies USING btree (hub_issue_id) WHERE (hub_issue_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_op_emergencies_site_day ON public.operational_emergencies USING btree (site_day_session_id) WHERE (site_day_session_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_op_emergencies_one_active_centre ON public.operational_emergencies USING btree (site_day_session_id) WHERE ((status = 'active'::text) AND (site_day_session_id IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS uq_op_emergencies_one_active_event_day ON public.operational_emergencies USING btree (event_day_session_id) WHERE ((status = 'active'::text) AND (event_day_session_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_op_emergency_muster_emergency ON public.operational_emergency_muster USING btree (emergency_id);

CREATE INDEX IF NOT EXISTS idx_op_escalations_source ON public.operational_escalations USING btree (source_kind, source_issue_id);

CREATE INDEX IF NOT EXISTS operational_escalations_raised_by_idx ON public.operational_escalations USING btree (raised_by);

CREATE INDEX IF NOT EXISTS operational_ledger_category_action_idx ON public.operational_ledger USING btree (category, action_type);

CREATE INDEX IF NOT EXISTS operational_ledger_created_at_idx ON public.operational_ledger USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS operational_ledger_staff_created_idx ON public.operational_ledger USING btree (staff_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_part_compliance_type ON public.participant_compliance_and_alerts USING btree (participant_id, record_type);

CREATE INDEX IF NOT EXISTS idx_infectious_exclusions_active ON public.participant_infectious_exclusions USING btree (status) WHERE (status = 'active'::text);

CREATE INDEX IF NOT EXISTS idx_infectious_exclusions_event_day ON public.participant_infectious_exclusions USING btree (event_day_session_id) WHERE (event_day_session_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_infectious_exclusions_hub_issue ON public.participant_infectious_exclusions USING btree (hub_issue_id) WHERE (hub_issue_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_infectious_exclusions_participant ON public.participant_infectious_exclusions USING btree (participant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_infectious_exclusions_one_active ON public.participant_infectious_exclusions USING btree (participant_id) WHERE (status = 'active'::text);

CREATE INDEX IF NOT EXISTS participants_kind_archived_idx ON public.participants USING btree (participant_kind, archived_at);

CREATE INDEX IF NOT EXISTS idx_site_day_activities_session ON public.site_day_activities USING btree (session_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_site_day_meal_service_rolls_activity ON public.site_day_meal_service_rolls USING btree (activity_id);

CREATE INDEX IF NOT EXISTS site_day_visitors_present_idx ON public.site_day_visitors USING btree (session_id) WHERE (left_at IS NULL);

CREATE INDEX IF NOT EXISTS site_day_visitors_session_idx ON public.site_day_visitors USING btree (session_id);

CREATE INDEX IF NOT EXISTS site_issues_register_event_day_session_idx ON public.site_issues_register USING btree (event_day_session_id) WHERE (event_day_session_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS site_issues_register_event_id_idx ON public.site_issues_register USING btree (event_id) WHERE (event_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_staff_compliance_type ON public.staff_compliance_and_certs USING btree (staff_id, cert_type);

CREATE UNIQUE INDEX IF NOT EXISTS staff_registry_auth_user_id_key ON public.staff_registry USING btree (auth_user_id) WHERE (auth_user_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS staff_registry_auth_user_id_uidx ON public.staff_registry USING btree (auth_user_id) WHERE (auth_user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS transport_assets_rego_expiry_idx ON public.transport_assets USING btree (registration_expiry) WHERE (registration_expiry IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS transport_assets_vin_uniq ON public.transport_assets USING btree (vin) WHERE (vin IS NOT NULL);

CREATE INDEX IF NOT EXISTS transport_requests_date_status_idx ON public.transport_requests USING btree (request_date, status);

CREATE INDEX IF NOT EXISTS transport_requests_participant_idx ON public.transport_requests USING btree (participant_id);

CREATE INDEX IF NOT EXISTS idx_transport_trips_bus_run_code ON public.transport_trips USING btree (bus_run_code) WHERE (bus_run_code IS NOT NULL);

CREATE INDEX IF NOT EXISTS transport_trips_asset_id_idx ON public.transport_trips USING btree (asset_id) WHERE (asset_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS transport_trips_event_day_session_idx ON public.transport_trips USING btree (event_day_session_id) WHERE (event_day_session_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS transport_trips_one_active_per_driver ON public.transport_trips USING btree (driver_staff_id) WHERE (status <> ALL (ARRAY['completed'::text, 'cancelled'::text]));

CREATE INDEX IF NOT EXISTS transport_trips_trip_kind_idx ON public.transport_trips USING btree (trip_kind) WHERE (trip_kind IS NOT NULL);

CREATE INDEX IF NOT EXISTS trip_legs_trip_id_idx ON public.trip_legs USING btree (trip_id, leg_index);

CREATE UNIQUE INDEX IF NOT EXISTS vendors_name_lower_unique ON public.vendors USING btree (lower(TRIM(BOTH FROM name)));

CREATE INDEX IF NOT EXISTS vendors_status_idx ON public.vendors USING btree (status);

CREATE INDEX IF NOT EXISTS venue_safety_answers_signoff_idx ON public.venue_safety_answers USING btree (signoff_id);

CREATE INDEX IF NOT EXISTS venue_safety_baseline_signoffs_venue_idx ON public.venue_safety_baseline_signoffs USING btree (venue_id, signed_off_at DESC);

CREATE INDEX IF NOT EXISTS venue_template_fields_venue_idx ON public.venue_template_fields USING btree (venue_id, sort_order);

CREATE INDEX IF NOT EXISTS venues_name_idx ON public.venues USING btree (lower(name));

CREATE INDEX IF NOT EXISTS venues_status_idx ON public.venues USING btree (status);

-- ---------------------------------------------------------------------------
-- VALIDATION (run after - expect rows)
-- ---------------------------------------------------------------------------
-- FK count on public (DEV baseline ~120+):
-- SELECT count(*) AS fk_count
-- FROM pg_constraint c
-- JOIN pg_class rel ON rel.oid = c.conrelid
-- JOIN pg_namespace n ON n.oid = rel.relnamespace
-- WHERE n.nspname = 'public' AND c.contype = 'f';
--
-- Unvalidated FKs (should be 0 after clean data):
-- SELECT rel.relname AS table_name, c.conname
-- FROM pg_constraint c
-- JOIN pg_class rel ON rel.oid = c.conrelid
-- JOIN pg_namespace n ON n.oid = rel.relnamespace
-- WHERE n.nspname = 'public' AND c.contype = 'f' AND NOT c.convalidated
-- ORDER BY 1, 2;
--
-- Sample PostgREST-critical FKs (expect 6 rows):
-- SELECT conname FROM pg_constraint
-- WHERE conname IN (
--   'event_roster_bookings_participant_id_fkey',
--   'event_roster_bookings_event_id_fkey',
--   'event_manifest_primary_venue_id_fkey',
--   'participant_attendance_schedules_participant_id_fkey',
--   'event_activity_rolls_participant_id_fkey',
--   'trip_legs_trip_id_fkey'
-- )
-- ORDER BY 1;
