-- 2026-07-18 — asset_daily_clearance DELETE for PIN/anon terminals
--
-- Background: 2026-07-08_rls_baseline_legacy_tables.sql granted DELETE to anon
-- but only created SELECT/INSERT/UPDATE policies. Event Deliver "Reset Start of Day"
-- (test) must wipe same-date clearances so Manifest walkaround can re-run; without
-- a DELETE policy the wipe is a silent no-op and drivers hit
-- "Clearance already recorded for this vehicle on …".
--
-- Safe to re-run. Expect: Success. No rows returned (DDL).

DROP POLICY IF EXISTS "asset_daily_clearance deletable" ON public.asset_daily_clearance;
CREATE POLICY "asset_daily_clearance deletable"
  ON public.asset_daily_clearance
  FOR DELETE
  TO anon, authenticated
  USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_daily_clearance TO anon, authenticated;

-- Cascade children if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'asset_clearance_items'
  ) THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_clearance_items TO anon, authenticated';
    EXECUTE 'DROP POLICY IF EXISTS "asset_clearance_items deletable" ON public.asset_clearance_items';
    EXECUTE $p$
      CREATE POLICY "asset_clearance_items deletable"
        ON public.asset_clearance_items
        FOR DELETE
        TO anon, authenticated
        USING (true)
    $p$;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Validation (should return rows):
--
-- SELECT polname, cmd
-- FROM pg_policies
-- WHERE tablename = 'asset_daily_clearance'
-- ORDER BY cmd, polname;
-- Expect a DELETE policy named asset_daily_clearance deletable.
--
-- Optional heal — remove orphan clearances for a QA date (example 2026-07-17):
-- DELETE FROM public.asset_daily_clearance
-- WHERE clearance_date = '2026-07-17'
--   AND driver_auth_pin_verified_at IS NULL;
-- ---------------------------------------------------------------------------
