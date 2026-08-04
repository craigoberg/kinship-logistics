-- =============================================================================
-- 2026-08-04 — TEST ONLY — Training pack wipe (Hub / Day / Events / outing venues)
-- =============================================================================
--
-- Purpose
--   Clear operational rubbish before Alpha training so the room can:
--     • Open Day Centre without hundreds of stale REDs
--     • Create outing venues + safety baselines from scratch
--     • Build Event Manage → Deliver trips from an empty slate
--     • Run Manifest / meals / odd incidents on a quiet floor
--
-- KEEP (do not touch)
--   • staff_registry (+ PINs) — Michelle, Mark, Buffy, others
--   • participants / clients (incl. Fred + medication schedules)
--   • transport_assets, asset_checkpoints
--   • system_parameters, system_lookup_parameters (bus_runs, addresses, check templates)
--   • centre_operating_hours
--   • auth.users
--   • charge codes / lookup registries
--
-- CLEAR
--   • Hub noise: site_issues_register, hub notes, incidents, escalations, maintenance,
--     infectious exclusions, operational emergencies
--   • Day Centre floor history: sessions, attendance, visitors, activities, meal rolls
--   • All events + Event Deliver tree + related transport trips
--   • Day Centre transport trips + asset daily clearances (clean Manifest)
--   • All outing venues (+ baselines / template fields / venue compliance rows)
--     NOTE: Day Centre is NOT a venues row — it lives in site_day_sessions +
--     system_parameters.day_centre_address. Deleting all venues is correct for
--     "create venues in training."
--
-- HOW TO RUN (Supabase → TEST project → SQL Editor)
--   1) Confirm project is TEST (not DEV, not PROD). Cursor local .env is often DEV.
--   2) Run PART A (preview). Eyeball counts + venue list.
--   3) In PART B, set v_confirm_test_wipe := true, then run PART B only
--      (or whole file after flipping the flag).
--   4) Run PART C (validation). Expect zeros on wipe tables; staff/clients still present.
--
-- "Success. No rows returned" on DELETE/DO blocks is normal.
-- =============================================================================


-- =============================================================================
-- PART A — PREVIEW (safe; run anytime on TEST)
-- =============================================================================

SELECT 'hub_site_issues' AS bucket, count(*)::bigint AS n FROM public.site_issues_register
UNION ALL SELECT 'hub_issue_notes', count(*) FROM public.hub_issue_notes
UNION ALL SELECT 'operational_incidents', count(*) FROM public.operational_incidents
UNION ALL SELECT 'operational_escalations', count(*) FROM public.operational_escalations
UNION ALL SELECT 'maintenance_items', count(*) FROM public.maintenance_items
UNION ALL SELECT 'infectious_exclusions', count(*) FROM public.participant_infectious_exclusions
UNION ALL SELECT 'operational_emergencies', count(*) FROM public.operational_emergencies
UNION ALL SELECT 'site_day_sessions', count(*) FROM public.site_day_sessions
UNION ALL SELECT 'client_attendance_log', count(*) FROM public.client_attendance_log
UNION ALL SELECT 'event_manifest', count(*) FROM public.event_manifest
UNION ALL SELECT 'event_day_sessions', count(*) FROM public.event_day_sessions
UNION ALL SELECT 'event_venue_stops', count(*) FROM public.event_venue_stops
UNION ALL SELECT 'transport_trips', count(*) FROM public.transport_trips
UNION ALL SELECT 'venues', count(*) FROM public.venues
UNION ALL SELECT 'staff_kept', count(*) FROM public.staff_registry
UNION ALL SELECT 'participants_active', count(*) FROM public.participants WHERE archived_at IS NULL
ORDER BY 1;

SELECT id, name, venue_type, status, street_address
FROM public.venues
ORDER BY name;

SELECT key, left(value::text, 80) AS value_preview
FROM public.system_parameters
WHERE key IN (
  'day_centre_address',
  'depot_address',
  'site_management.mandated_compliance_checks',
  'site_management.mandated_close_checks',
  'event_deliver.venue_open_checks'
)
ORDER BY key;

-- Fred med schedule sanity (name match — adjust if display name differs)
SELECT p.id,
       trim(both FROM concat_ws(' ', p.first_name, p.last_name)) AS name,
       count(s.id) AS med_schedule_rows
FROM public.participants p
LEFT JOIN public.participant_medication_schedules s ON s.participant_id = p.id
WHERE (p.first_name ILIKE '%fred%' OR p.last_name ILIKE '%fred%')
  AND p.archived_at IS NULL
GROUP BY p.id, p.first_name, p.last_name;


-- =============================================================================
-- PART B — WIPE (destructive; gated)
-- =============================================================================
-- Flip v_confirm_test_wipe to true ONLY after PART A on the TEST project.

DO $$
DECLARE
  v_confirm_test_wipe boolean := false; -- <<< set true on TEST to execute wipe
  v_venues_before int;
  v_events_before int;
  v_issues_before int;
BEGIN
  IF NOT v_confirm_test_wipe THEN
    RAISE EXCEPTION
      'Aborted: training wipe not confirmed. Set v_confirm_test_wipe := true in PART B after verifying TEST project + PART A preview.';
  END IF;

  SELECT count(*) INTO v_venues_before FROM public.venues;
  SELECT count(*) INTO v_events_before FROM public.event_manifest;
  SELECT count(*) INTO v_issues_before FROM public.site_issues_register;

  RAISE NOTICE 'TEST training wipe starting: venues=%, events=%, site_issues=%',
    v_venues_before, v_events_before, v_issues_before;

  -- ── 0) Null loose FKs that can block issue deletes ─────────────────────────
  UPDATE public.client_attendance_log
     SET escalation_issue_id = NULL,
         departure_issue_id = NULL
   WHERE escalation_issue_id IS NOT NULL
      OR departure_issue_id IS NOT NULL;

  IF to_regclass('public.event_attendance_log') IS NOT NULL THEN
    UPDATE public.event_attendance_log
       SET escalation_issue_id = NULL
     WHERE escalation_issue_id IS NOT NULL;
  END IF;

  IF to_regclass('public.event_morning_log') IS NOT NULL THEN
    UPDATE public.event_morning_log
       SET escalation_issue_id = NULL
     WHERE escalation_issue_id IS NOT NULL;
  END IF;

  IF to_regclass('public.event_curfew_log') IS NOT NULL THEN
    UPDATE public.event_curfew_log
       SET escalation_issue_id = NULL
     WHERE escalation_issue_id IS NOT NULL;
  END IF;

  IF to_regclass('public.operational_emergencies') IS NOT NULL THEN
    UPDATE public.operational_emergencies
       SET hub_issue_id = NULL
     WHERE hub_issue_id IS NOT NULL;
  END IF;

  IF to_regclass('public.participant_infectious_exclusions') IS NOT NULL THEN
    UPDATE public.participant_infectious_exclusions
       SET hub_issue_id = NULL
     WHERE hub_issue_id IS NOT NULL;
  END IF;

  -- ── A) Hub / issues / Reds / maintenance / H&S noise ───────────────────────
  DELETE FROM public.hub_issue_notes;
  DELETE FROM public.maintenance_notes;
  DELETE FROM public.maintenance_items;
  IF to_regclass('public.operational_emergency_muster') IS NOT NULL THEN
    DELETE FROM public.operational_emergency_muster;
  END IF;
  IF to_regclass('public.operational_emergencies') IS NOT NULL THEN
    DELETE FROM public.operational_emergencies;
  END IF;
  IF to_regclass('public.participant_infectious_exclusions') IS NOT NULL THEN
    DELETE FROM public.participant_infectious_exclusions;
  END IF;
  DELETE FROM public.site_issues_register;
  DELETE FROM public.operational_incidents;
  DELETE FROM public.operational_escalations;

  -- ── B) Day Centre floor history (KEEP hours + system_parameters) ───────────
  IF to_regclass('public.site_day_meal_service_rolls') IS NOT NULL THEN
    DELETE FROM public.site_day_meal_service_rolls;
  END IF;
  IF to_regclass('public.site_day_activities') IS NOT NULL THEN
    DELETE FROM public.site_day_activities;
  END IF;
  IF to_regclass('public.site_day_visitors') IS NOT NULL THEN
    DELETE FROM public.site_day_visitors;
  END IF;
  DELETE FROM public.client_attendance_log;
  DELETE FROM public.site_day_sessions;

  -- Optional med admin history (KEEP schedules on participants)
  IF to_regclass('public.medication_administration_log') IS NOT NULL THEN
    DELETE FROM public.medication_administration_log;
  END IF;

  -- ── C) Event Deliver tree ──────────────────────────────────────────────────
  IF to_regclass('public.event_meal_service_rolls') IS NOT NULL THEN
    DELETE FROM public.event_meal_service_rolls;
  END IF;
  IF to_regclass('public.event_activity_rolls') IS NOT NULL THEN
    DELETE FROM public.event_activity_rolls;
  END IF;
  IF to_regclass('public.event_bus_manifest') IS NOT NULL THEN
    DELETE FROM public.event_bus_manifest;
  END IF;
  IF to_regclass('public.event_day_med_alternate_plans') IS NOT NULL THEN
    DELETE FROM public.event_day_med_alternate_plans;
  END IF;
  IF to_regclass('public.event_attendance_log') IS NOT NULL THEN
    DELETE FROM public.event_attendance_log;
  END IF;
  IF to_regclass('public.event_morning_log') IS NOT NULL THEN
    DELETE FROM public.event_morning_log;
  END IF;
  IF to_regclass('public.event_curfew_log') IS NOT NULL THEN
    DELETE FROM public.event_curfew_log;
  END IF;

  -- Transport trips (event + day_centre) — trip_legs CASCADE from trips
  DELETE FROM public.transport_trips;

  IF to_regclass('public.transport_requests') IS NOT NULL THEN
    DELETE FROM public.transport_requests;
  END IF;

  -- Asset daily clearances (walkaround history)
  IF to_regclass('public.asset_clearance_items') IS NOT NULL THEN
    DELETE FROM public.asset_clearance_items;
  END IF;
  IF to_regclass('public.asset_daily_clearance') IS NOT NULL THEN
    DELETE FROM public.asset_daily_clearance;
  END IF;

  DELETE FROM public.event_venue_reconfirmations;
  DELETE FROM public.event_roster_bookings;
  DELETE FROM public.event_financial_ledger;

  IF to_regclass('public.participant_financial_ledger') IS NOT NULL THEN
    DELETE FROM public.participant_financial_ledger
     WHERE event_id IS NOT NULL;
  END IF;

  DELETE FROM public.event_venue_stops; -- before venues (RESTRICT)
  DELETE FROM public.event_day_sessions;
  DELETE FROM public.event_manifest;

  -- ── D) Outing venues (all — Centre is not a venues row) ────────────────────
  DELETE FROM public.compliance_assets
   WHERE subject_table = 'venues';

  -- Child venue tables CASCADE from venues, but delete explicitly for clarity
  IF to_regclass('public.venue_safety_answers') IS NOT NULL THEN
    DELETE FROM public.venue_safety_answers;
  END IF;
  DELETE FROM public.venue_safety_baseline_signoffs;
  DELETE FROM public.venue_template_fields;

  -- Break self-clone links then delete all outing venues
  UPDATE public.venues SET cloned_from_venue_id = NULL WHERE cloned_from_venue_id IS NOT NULL;
  DELETE FROM public.venues;

  -- ── E) Optional: trim operational_ledger noise (audit trail; not Hub cards)
  -- Uncomment if Dashboard/ledger clutter still distracts training:
  -- IF to_regclass('public.operational_ledger') IS NOT NULL THEN
  --   DELETE FROM public.operational_ledger;
  -- END IF;

  RAISE NOTICE 'TEST training wipe complete.';
END $$;


-- =============================================================================
-- PART C — VALIDATION (expect 0 on wipe buckets; KEEP rows > 0)
-- =============================================================================

SELECT 'site_issues_register' AS t, count(*)::bigint AS n FROM public.site_issues_register
UNION ALL SELECT 'hub_issue_notes', count(*) FROM public.hub_issue_notes
UNION ALL SELECT 'operational_incidents', count(*) FROM public.operational_incidents
UNION ALL SELECT 'operational_escalations', count(*) FROM public.operational_escalations
UNION ALL SELECT 'maintenance_items', count(*) FROM public.maintenance_items
UNION ALL SELECT 'infectious_exclusions', count(*) FROM public.participant_infectious_exclusions
UNION ALL SELECT 'operational_emergencies', count(*) FROM public.operational_emergencies
UNION ALL SELECT 'site_day_sessions', count(*) FROM public.site_day_sessions
UNION ALL SELECT 'client_attendance_log', count(*) FROM public.client_attendance_log
UNION ALL SELECT 'event_manifest', count(*) FROM public.event_manifest
UNION ALL SELECT 'event_day_sessions', count(*) FROM public.event_day_sessions
UNION ALL SELECT 'event_roster_bookings', count(*) FROM public.event_roster_bookings
UNION ALL SELECT 'event_venue_stops', count(*) FROM public.event_venue_stops
UNION ALL SELECT 'transport_trips', count(*) FROM public.transport_trips
UNION ALL SELECT 'venues', count(*) FROM public.venues
UNION ALL SELECT 'staff_kept', count(*) FROM public.staff_registry
UNION ALL SELECT 'participants_active', count(*) FROM public.participants WHERE archived_at IS NULL
UNION ALL SELECT 'bus_runs_kept', count(*) FROM public.system_lookup_parameters WHERE category = 'bus_runs'
ORDER BY 1;

-- Expect 0 venues after wipe
SELECT count(*) AS venues_remaining FROM public.venues;

-- Expect Centre address still configured
SELECT key, value
FROM public.system_parameters
WHERE key = 'day_centre_address';

-- Expect Michelle / Mark / Buffy still present (name match)
SELECT id, full_name, role
FROM public.staff_registry
WHERE full_name ILIKE ANY (ARRAY['%michelle%', '%mark%', '%buffy%'])
ORDER BY full_name;

-- =============================================================================
-- Expected shapes after successful wipe
-- =============================================================================
-- PART B DO block: Success / NOTICE "TEST training wipe complete."
-- PART C wipe buckets: n = 0 for issues, events, venues, sessions, trips
-- PART C KEEP: staff_kept > 0, participants_active > 0, bus_runs_kept >= 0,
--              day_centre_address row present, Michelle/Mark/Buffy rows present
-- =============================================================================
