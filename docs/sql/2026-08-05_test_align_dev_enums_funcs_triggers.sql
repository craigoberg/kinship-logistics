-- ============================================================================
-- 2026-08-05 — TEST: align enums, functions/RPCs, triggers to DEV
--
-- SOURCE: DEV dumps A/B/C (2026-08-05_dev_structure_dump_queries.sql)
-- Safe / idempotent. Run after columns + constraints align.
-- "Success. No rows returned" is normal for DDL.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- 0) ENUMS (exact DEV labels)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.responsibility_owner AS ENUM ('internal', 'council');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.ryge_severity AS ENUM ('green', 'yellow', 'red');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.site_session_status AS ENUM (
    'open_pending', 'active_day', 'escalated_lock', 'closed_orderly', 'closed_no_go'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Promote text → enum where bootstrap left text
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
-- 1) FUNCTIONS / RPCs (DEV definitions)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_operational_escalation(p_escalation_id uuid, p_staff_id uuid)
 RETURNS TABLE(success boolean, message text, updated_status text, claimed_by_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_current_status TEXT;
    v_claimed_by UUID;
BEGIN
    SELECT status, claimed_by INTO v_current_status, v_claimed_by
    FROM public.operational_escalations
    WHERE id = p_escalation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'Escalation record not found.'::TEXT, NULL::TEXT, NULL::UUID;
        RETURN;
    END IF;

    IF v_current_status != 'pending' THEN
        RETURN QUERY SELECT FALSE, 'This incident has already been claimed or processed.'::TEXT, v_current_status, v_claimed_by;
        RETURN;
    END IF;

    UPDATE public.operational_escalations
    SET status = 'claimed',
        claimed_by = p_staff_id,
        updated_at = NOW()
    WHERE id = p_escalation_id;

    RETURN QUERY SELECT TRUE, 'Incident successfully claimed.'::TEXT, 'claimed'::TEXT, p_staff_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.compliance_assets_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.is_manager(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.staff_registry s
     WHERE s.active IS DISTINCT FROM false
       AND (s.id = _user_id OR s.auth_user_id = _user_id)
       AND lower(coalesce(s.role, '')) LIKE '%manager%'
  )
$function$;

CREATE OR REPLACE FUNCTION public.list_backup_tables()
 RETURNS TABLE(table_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT c.relname::text
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname NOT LIKE 'pg_%'
     AND c.relname NOT LIKE 'sql_%'
   ORDER BY c.relname;
$function$;

CREATE OR REPLACE FUNCTION public.log_compliance_asset_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
BEGIN
  INSERT INTO public.operational_ledger(
    staff_id, category, severity, action_type, metadata
  ) VALUES (
    v_actor,
    'CENTRE',
    'INFO',
    'COMPLIANCE_ASSET_' || TG_OP,
    jsonb_build_object(
      'op',     TG_OP,
      'before', CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
      'after',  CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END,
      'source', 'compliance_assets_trigger'
    )
  );
  RETURN COALESCE(NEW, OLD);
END
$function$;

CREATE OR REPLACE FUNCTION public.order_tables_for_restore(p_tables text[])
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH input AS (
    SELECT unnest(p_tables) AS table_name
  ),
  fk_counts AS (
    SELECT i.table_name,
           COALESCE((
             SELECT COUNT(*)
               FROM pg_constraint con
               JOIN pg_class child ON child.oid = con.conrelid
               JOIN pg_namespace ns ON ns.oid = child.relnamespace
              WHERE con.contype = 'f'
                AND ns.nspname = 'public'
                AND child.relname = i.table_name
           ), 0) AS inbound_fk_count
      FROM input i
  )
  SELECT array_agg(table_name ORDER BY inbound_fk_count ASC, table_name ASC)
    FROM fk_counts;
$function$;

CREATE OR REPLACE FUNCTION public.reset_active_site_day_red_escalation(p_session_phase text DEFAULT 'active_day'::text)
 RETURNS TABLE(escalation_id uuid, previous_escalation_status text, new_escalation_status text, previous_claimed_by uuid, previous_claimed_at timestamp with time zone, session_id uuid, previous_session_phase text, new_session_phase text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_escalation_id uuid;
  v_previous_escalation_status text;
  v_previous_claimed_by uuid;
  v_previous_claimed_at timestamptz;
  v_session_id uuid;
  v_previous_session_phase text;
BEGIN
  IF p_session_phase NOT IN (
    'open_pending',
    'active_day',
    'escalated_lock',
    'closed_orderly',
    'closed_no_go'
  ) THEN
    RAISE EXCEPTION 'Invalid site_day_sessions phase: %', p_session_phase;
  END IF;

  SELECT e.id,
         e.status::text,
         e.claimed_by,
         e.claimed_at
    INTO v_escalation_id,
         v_previous_escalation_status,
         v_previous_claimed_by,
         v_previous_claimed_at
    FROM public.operational_escalations e
   WHERE (e.source_kind = 'site_day_red' OR e.gate_id = 'site_day_red')
     AND e.status IN ('pending', 'claimed')
   ORDER BY
     CASE WHEN e.status = 'claimed' THEN 0 ELSE 1 END,
     e.created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF v_escalation_id IS NULL THEN
    RAISE EXCEPTION 'No active site_day_red escalation found.';
  END IF;

  UPDATE public.operational_escalations e
     SET status = 'pending',
         claimed_by = NULL,
         claimed_at = NULL,
         resolved_by = NULL,
         resolved_at = NULL,
         resolution_notes = NULL
   WHERE e.id = v_escalation_id;

  SELECT s.id,
         s.phase::text
    INTO v_session_id,
         v_previous_session_phase
    FROM public.site_day_sessions s
   WHERE s.phase IN ('escalated_lock', 'active_day', 'open_pending')
   ORDER BY
     CASE WHEN s.phase = 'escalated_lock' THEN 0 ELSE 1 END,
     s.session_date DESC,
     s.updated_at DESC
   LIMIT 1
   FOR UPDATE;

  IF v_session_id IS NOT NULL THEN
    UPDATE public.site_day_sessions s
       SET phase = p_session_phase,
           manager_plan_text = NULL,
           manager_decision = NULL,
           manager_auth_staff_id = NULL,
           manager_auth_at = NULL,
           leader_decision = NULL,
           leader_auth_staff_id = NULL,
           leader_auth_at = NULL,
           closed_by_id = CASE
             WHEN p_session_phase IN ('open_pending', 'active_day', 'escalated_lock')
               THEN NULL
             ELSE s.closed_by_id
           END,
           close_declared_at = CASE
             WHEN p_session_phase IN ('open_pending', 'active_day', 'escalated_lock')
               THEN NULL
             ELSE s.close_declared_at
           END,
           close_leader_notes = CASE
             WHEN p_session_phase IN ('open_pending', 'active_day', 'escalated_lock')
               THEN NULL
             ELSE s.close_leader_notes
           END
     WHERE s.id = v_session_id;
  END IF;

  RETURN QUERY
  SELECT v_escalation_id,
         v_previous_escalation_status,
         'pending'::text,
         v_previous_claimed_by,
         v_previous_claimed_at,
         v_session_id,
         v_previous_session_phase,
         CASE WHEN v_session_id IS NULL THEN NULL ELSE p_session_phase END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.seed_venue_mandatory_safety_fields(p_venue_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.set_maintenance_items_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_system_parameter(_key text, _value jsonb, _staff_id uuid, _justification text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _old_value jsonb;
BEGIN
  IF NOT public.is_manager(_staff_id) THEN
    RAISE EXCEPTION 'Only Managers can update system parameters.' USING ERRCODE = '42501';
  END IF;

  IF length(btrim(coalesce(_justification, ''))) < 10 THEN
    RAISE EXCEPTION 'Justification must be at least 10 characters.' USING ERRCODE = '22023';
  END IF;

  SELECT value INTO _old_value
    FROM public.system_parameters
   WHERE key = _key
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown system parameter: %', _key USING ERRCODE = '22023';
  END IF;

  UPDATE public.system_parameters
     SET value = _value,
         updated_by = _staff_id,
         updated_at = now()
   WHERE key = _key;

  INSERT INTO public.operational_ledger(
    staff_id,
    category,
    severity,
    action_type,
    gps_lat,
    gps_lng,
    metadata
  ) VALUES (
    _staff_id,
    'CENTRE',
    'INFO',
    'SYSTEM_PARAMETER_UPDATED',
    NULL,
    NULL,
    jsonb_build_object(
      'key', _key,
      'old_value', _old_value,
      'new_value', _value,
      'justification', btrim(_justification)
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.touch_client_attendance_log_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.touch_event_attendance_log_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.touch_row_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.touch_site_day_visitors_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trip_legs_sync_leg_type()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.leg_type IS NULL THEN
    NEW.leg_type := NEW.leg_kind;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trip_legs_sync_sequence_order()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.sequence_order IS NULL THEN
    NEW.sequence_order := NEW.leg_index;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.truncate_backup_tables(p_tables text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sql text;
BEGIN
  IF p_tables IS NULL OR array_length(p_tables, 1) IS NULL THEN
    RETURN;
  END IF;

  v_sql := format(
    'TRUNCATE TABLE %s RESTART IDENTITY CASCADE',
    (
      SELECT string_agg(quote_ident(t), ', ' ORDER BY t)
        FROM unnest(p_tables) AS t
    )
  );

  EXECUTE v_sql;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_operator_pin(entered_pin text)
 RETURNS TABLE(id uuid, full_name text, role text, personnel_type text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT s.id, s.full_name, s.role, s.personnel_type
  FROM public.staff_registry s
  WHERE s.active = true
    AND s.pin_hash IS NOT NULL
    AND s.pin_hash = encode(digest(entered_pin, 'sha256'), 'hex')
  LIMIT 1;
$function$;

-- Grants (PIN / anon terminals)
GRANT EXECUTE ON FUNCTION public.claim_operational_escalation(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_manager(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_backup_tables() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.order_tables_for_restore(text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reset_active_site_day_red_escalation(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.seed_venue_mandatory_safety_fields(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_system_parameter(text, jsonb, uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.truncate_backup_tables(text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_operator_pin(text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) TRIGGERS (drop + recreate to match DEV names)
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_touch_client_attendance_log ON public.client_attendance_log;
CREATE TRIGGER trg_touch_client_attendance_log
  BEFORE UPDATE ON public.client_attendance_log
  FOR EACH ROW EXECUTE FUNCTION public.touch_client_attendance_log_updated_at();

DROP TRIGGER IF EXISTS compliance_assets_audit_trg ON public.compliance_assets;
CREATE TRIGGER compliance_assets_audit_trg
  AFTER INSERT OR DELETE OR UPDATE ON public.compliance_assets
  FOR EACH ROW EXECUTE FUNCTION public.log_compliance_asset_change();

DROP TRIGGER IF EXISTS compliance_assets_touch_updated_at_trg ON public.compliance_assets;
CREATE TRIGGER compliance_assets_touch_updated_at_trg
  BEFORE UPDATE ON public.compliance_assets
  FOR EACH ROW EXECUTE FUNCTION public.compliance_assets_touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_event_attendance_log ON public.event_attendance_log;
CREATE TRIGGER trg_touch_event_attendance_log
  BEFORE UPDATE ON public.event_attendance_log
  FOR EACH ROW EXECUTE FUNCTION public.touch_event_attendance_log_updated_at();

DROP TRIGGER IF EXISTS trg_touch_event_bus_manifest ON public.event_bus_manifest;
CREATE TRIGGER trg_touch_event_bus_manifest
  BEFORE UPDATE ON public.event_bus_manifest
  FOR EACH ROW EXECUTE FUNCTION public.touch_row_updated_at();

DROP TRIGGER IF EXISTS trg_touch_event_curfew_log ON public.event_curfew_log;
CREATE TRIGGER trg_touch_event_curfew_log
  BEFORE UPDATE ON public.event_curfew_log
  FOR EACH ROW EXECUTE FUNCTION public.touch_row_updated_at();

DROP TRIGGER IF EXISTS trg_touch_event_day_sessions ON public.event_day_sessions;
CREATE TRIGGER trg_touch_event_day_sessions
  BEFORE UPDATE ON public.event_day_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_row_updated_at();

DROP TRIGGER IF EXISTS trg_touch_event_morning_log ON public.event_morning_log;
CREATE TRIGGER trg_touch_event_morning_log
  BEFORE UPDATE ON public.event_morning_log
  FOR EACH ROW EXECUTE FUNCTION public.touch_row_updated_at();

DROP TRIGGER IF EXISTS trg_touch_event_venue_stops ON public.event_venue_stops;
CREATE TRIGGER trg_touch_event_venue_stops
  BEFORE UPDATE ON public.event_venue_stops
  FOR EACH ROW EXECUTE FUNCTION public.touch_row_updated_at();

DROP TRIGGER IF EXISTS trg_maintenance_items_updated_at ON public.maintenance_items;
CREATE TRIGGER trg_maintenance_items_updated_at
  BEFORE UPDATE ON public.maintenance_items
  FOR EACH ROW EXECUTE FUNCTION public.set_maintenance_items_updated_at();

DROP TRIGGER IF EXISTS trg_touch_site_day_visitors ON public.site_day_visitors;
CREATE TRIGGER trg_touch_site_day_visitors
  BEFORE UPDATE ON public.site_day_visitors
  FOR EACH ROW EXECUTE FUNCTION public.touch_site_day_visitors_updated_at();

DROP TRIGGER IF EXISTS update_transport_assets_updated_at ON public.transport_assets;
CREATE TRIGGER update_transport_assets_updated_at
  BEFORE UPDATE ON public.transport_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trip_legs_sync_leg_type ON public.trip_legs;
CREATE TRIGGER trip_legs_sync_leg_type
  BEFORE INSERT OR UPDATE ON public.trip_legs
  FOR EACH ROW EXECUTE FUNCTION public.trip_legs_sync_leg_type();

DROP TRIGGER IF EXISTS trip_legs_sync_sequence_order ON public.trip_legs;
CREATE TRIGGER trip_legs_sync_sequence_order
  BEFORE INSERT OR UPDATE ON public.trip_legs
  FOR EACH ROW EXECUTE FUNCTION public.trip_legs_sync_sequence_order();

DROP TRIGGER IF EXISTS trg_touch_venue_template_fields ON public.venue_template_fields;
CREATE TRIGGER trg_touch_venue_template_fields
  BEFORE UPDATE ON public.venue_template_fields
  FOR EACH ROW EXECUTE FUNCTION public.touch_row_updated_at();

DROP TRIGGER IF EXISTS trg_touch_venues ON public.venues;
CREATE TRIGGER trg_touch_venues
  BEFORE UPDATE ON public.venues
  FOR EACH ROW EXECUTE FUNCTION public.touch_row_updated_at();

-- ---------------------------------------------------------------------------
-- VALIDATION (expect rows)
-- ---------------------------------------------------------------------------
-- SELECT typname FROM pg_type t
-- JOIN pg_namespace n ON n.oid = t.typnamespace
-- WHERE n.nspname = 'public' AND t.typtype = 'e'
-- ORDER BY 1;
-- expect: responsibility_owner, ryge_severity, site_session_status
--
-- SELECT proname FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.prokind = 'f'
--   AND proname IN ('verify_operator_pin','is_manager','set_system_parameter','list_backup_tables')
-- ORDER BY 1;
-- expect 4 rows
--
-- SELECT count(*) AS trigger_count FROM pg_trigger t
-- JOIN pg_class c ON c.oid = t.tgrelid
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND NOT t.tgisinternal;
-- expect 16
