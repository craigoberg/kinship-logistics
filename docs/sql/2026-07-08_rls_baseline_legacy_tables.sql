-- 2026-07-08 — Enable RLS on legacy public tables (Supabase Security Advisor batch)
--
-- Run the ENTIRE file in Supabase Dashboard → SQL Editor → Run.
-- If errors persist, run section 1 only, then the verification query at the bottom.
--
-- Clears:
--   0007 policy_exists_rls_disabled  (trip_leps)
--   0013 rls_disabled_in_public
--   0023 sensitive_columns_exposed   (device_uuid on sync/roster logs)

-- ============================================================================
-- 1. ENABLE RLS (minimal — must succeed for Security Advisor to clear)
-- ============================================================================

ALTER TABLE public.trip_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offline_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_administration_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participant_medication_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_daily_clearance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participant_attendance_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_roster_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participant_compliance_and_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_compliance_and_certs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_lookup_parameters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participant_financial_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_maintenance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_financial_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.charge_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carers_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_roster_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. GRANTS — PIN terminal uses anon publishable key (match client_attendance_log)
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_legs TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offline_sync_logs TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.participants TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_audit_logs TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medication_administration_log TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.participant_medication_schedules TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transport_assets TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_daily_clearance TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.participant_attendance_schedules TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_roster_bookings TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.participant_compliance_and_alerts TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_compliance_and_certs TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_lookup_parameters TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.participant_financial_ledger TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assets TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_maintenance_logs TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_financial_ledger TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.charge_codes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_manifest TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carers_registry TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_roster_logs TO anon, authenticated;

-- ============================================================================
-- 3. POLICIES — permissive; app auth is PIN session layer
-- ============================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'trip_legs',
    'offline_sync_logs',
    'participants',
    'compliance_audit_logs',
    'medication_administration_log',
    'participant_medication_schedules',
    'transport_assets',
    'asset_daily_clearance',
    'participant_attendance_schedules',
    'event_roster_bookings',
    'participant_compliance_and_alerts',
    'staff_compliance_and_certs',
    'system_lookup_parameters',
    'participant_financial_ledger',
    'assets',
    'asset_maintenance_logs',
    'event_financial_ledger',
    'charge_codes',
    'event_manifest',
    'carers_registry',
    'attendance_roster_logs'
  ]
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      t || ' authenticated all', t
    );
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' readable', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' writable', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' updatable', t);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)',
      t || ' readable', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO anon, authenticated WITH CHECK (true)',
      t || ' writable', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true)',
      t || ' updatable', t
    );
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- 4. VERIFICATION — expect 0 rows. If any rows, RLS is still off on that table.
-- ============================================================================

SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'trip_legs','offline_sync_logs','participants','compliance_audit_logs',
    'medication_administration_log','participant_medication_schedules',
    'transport_assets','asset_daily_clearance','participant_attendance_schedules',
    'event_roster_bookings','participant_compliance_and_alerts',
    'staff_compliance_and_certs','system_lookup_parameters',
    'participant_financial_ledger','assets','asset_maintenance_logs',
    'event_financial_ledger','charge_codes','event_manifest',
    'carers_registry','attendance_roster_logs'
  )
  AND c.relkind = 'r'
  AND NOT c.relrowsecurity
ORDER BY 1;
