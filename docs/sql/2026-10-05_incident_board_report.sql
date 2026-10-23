-- Board incident report (YADA Incident Report Version 1, 23.07.2024).
--
-- Every Big Red Button filing gets one board paper:
--   Human            → operational_incidents
--   Equipment/asset  → maintenance_items (source incident_fault)
--   Health & Safety  → site_issues_register (the Hub ticket)
--
-- Supabase SQL Editor often ends with "Success. No rows returned".
-- That is expected. Run the validation SELECTs at the bottom.

CREATE TABLE IF NOT EXISTS public.incident_number_counters (
  year integer PRIMARY KEY,
  last_value integer NOT NULL
);

COMMENT ON TABLE public.incident_number_counters IS
  'Yearly sequence for board incident numbers IR-YYYY-NNN. Allocate only via allocate_incident_number.';

ALTER TABLE public.incident_number_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.incident_number_counters FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.incident_number_counters TO service_role;

CREATE TABLE IF NOT EXISTS public.incident_board_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_number text NOT NULL UNIQUE,
  lane text NOT NULL CHECK (lane IN ('human', 'asset', 'health_safety')),
  hub_source text NOT NULL CHECK (hub_source IN ('incident', 'maintenance', 'day_centre', 'event')),
  hub_row_id uuid NOT NULL,
  board_office jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hub_source, hub_row_id)
);

COMMENT ON TABLE public.incident_board_reports IS
  'One printable YADA board incident report per Red Button filing.';

ALTER TABLE public.incident_board_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS incident_board_reports_authenticated ON public.incident_board_reports;
CREATE POLICY incident_board_reports_authenticated
  ON public.incident_board_reports
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.incident_board_reports FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.incident_board_reports TO authenticated, service_role;

ALTER TABLE public.operational_incidents
  ADD COLUMN IF NOT EXISTS incident_number text;
ALTER TABLE public.maintenance_items
  ADD COLUMN IF NOT EXISTS incident_number text;
ALTER TABLE public.site_issues_register
  ADD COLUMN IF NOT EXISTS incident_number text;

COMMENT ON COLUMN public.operational_incidents.incident_number IS
  'Board pack number IR-YYYY-NNN copied from incident_board_reports.';
COMMENT ON COLUMN public.maintenance_items.incident_number IS
  'Board pack number when the Red Button equipment lane filed this item.';
COMMENT ON COLUMN public.site_issues_register.incident_number IS
  'Board pack number when the Red Button Health & Safety lane filed this issue.';

CREATE UNIQUE INDEX IF NOT EXISTS operational_incidents_incident_number_uidx
  ON public.operational_incidents (incident_number)
  WHERE incident_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_items_incident_number_uidx
  ON public.maintenance_items (incident_number)
  WHERE incident_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS site_issues_register_incident_number_uidx
  ON public.site_issues_register (incident_number)
  WHERE incident_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.allocate_incident_number(p_year integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  IF p_year IS NULL OR p_year < 2000 OR p_year > 2100 THEN
    RAISE EXCEPTION 'incident number year out of range';
  END IF;

  INSERT INTO public.incident_number_counters AS c (year, last_value)
  VALUES (p_year, 1)
  ON CONFLICT (year) DO UPDATE
    SET last_value = c.last_value + 1
  RETURNING last_value INTO n;

  RETURN 'IR-' || p_year::text || '-' || lpad(n::text, 3, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_incident_number(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_incident_number(integer) TO authenticated, service_role;

-- Validation (expect rows — do not call allocate_incident_number; it burns a number):
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name = 'incident_board_reports';
-- -- expect 1 row
--
-- SELECT column_name, table_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND column_name = 'incident_number'
--   AND table_name IN ('operational_incidents', 'maintenance_items', 'site_issues_register')
-- ORDER BY table_name;
-- -- expect 3 rows
--
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'allocate_incident_number';
-- -- expect 1 row, args = p_year integer
