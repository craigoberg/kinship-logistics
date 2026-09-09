-- =============================================================================
-- 2026-09-08 — Role × menu access (BL-002 Phase 1)
-- =============================================================================
--
-- Admin → Menu Access matrix writes to public.role_menu_access.
-- Phase 1 UI stores none | write. Column already accepts read for Phase 2.
--
-- Manager (personnel_type = manager) always sees every menu in the app
-- (hard-coded failsafe). Assistant Manager and others follow this table.
--
-- Run on DEV then TEST. SQL Editor "Success. No rows returned" is expected
-- for the DDL / GRANT / seed body.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.role_menu_access (
  role_key      TEXT        NOT NULL,
  menu_key      TEXT        NOT NULL,
  access_level  TEXT        NOT NULL DEFAULT 'none'
                CHECK (access_level IN ('none', 'read', 'write')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by    UUID        NULL,
  PRIMARY KEY (role_key, menu_key)
);

CREATE OR REPLACE FUNCTION public.set_role_menu_access_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_role_menu_access_updated_at ON public.role_menu_access;
CREATE TRIGGER trg_role_menu_access_updated_at
  BEFORE UPDATE ON public.role_menu_access
  FOR EACH ROW
  EXECUTE FUNCTION public.set_role_menu_access_updated_at();

-- Who may edit the matrix: SYSTEM ACCESS LEVEL = manager only
-- (not assistant_manager, not title-contains-"manager").
CREATE OR REPLACE FUNCTION public.is_menu_access_editor(_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.staff_registry s
     WHERE s.active IS DISTINCT FROM false
       AND (s.id = _id OR s.auth_user_id = _id)
       AND lower(replace(trim(coalesce(s.personnel_type, '')), ' ', '_')) = 'manager'
  )
$$;

REVOKE ALL ON FUNCTION public.is_menu_access_editor(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_menu_access_editor(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_menu_access_editor(uuid) TO authenticated, service_role;

ALTER TABLE public.role_menu_access ENABLE ROW LEVEL SECURITY;

-- Day-login JWT can read (nav needs it) and write. The Admin UI only lets
-- personnel_type = manager save. is_menu_access_editor() is for app / later RLS.
DROP POLICY IF EXISTS role_menu_access_authenticated_select ON public.role_menu_access;
DROP POLICY IF EXISTS role_menu_access_authenticated_write ON public.role_menu_access;
DROP POLICY IF EXISTS role_menu_access_authenticated_all ON public.role_menu_access;
CREATE POLICY role_menu_access_authenticated_all
  ON public.role_menu_access
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.role_menu_access FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.role_menu_access TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.role_menu_access TO service_role;

-- ---------- Seed every role × menu (missing row = deny after load) ----------
INSERT INTO public.role_menu_access (role_key, menu_key, access_level)
SELECT
  r.role_key,
  m.menu_key,
  CASE
    WHEN r.role_key IN ('manager', 'assistant_manager') THEN 'write'
    WHEN r.role_key = 'support_worker'
      AND m.menu_key IN (
        'dashboard', 'day', 'event_deliver', 'manifest',
        'participants', 'help', 'sync'
      ) THEN 'write'
    WHEN r.role_key = 'driver'
      AND m.menu_key IN ('dashboard', 'manifest', 'transport', 'help', 'sync')
      THEN 'write'
    WHEN r.role_key IN ('guardian', 'dashboard')
      AND m.menu_key IN ('dashboard', 'help') THEN 'write'
    ELSE 'none'
  END
FROM (
  VALUES
    ('manager'),
    ('assistant_manager'),
    ('guardian'),
    ('support_worker'),
    ('driver'),
    ('dashboard')
) AS r(role_key)
CROSS JOIN (
  VALUES
    ('dashboard'),
    ('day'),
    ('event_deliver'),
    ('events'),
    ('governance'),
    ('rights_voice'),
    ('participants'),
    ('staff'),
    ('run_planning'),
    ('transport'),
    ('manifest'),
    ('sync'),
    ('help'),
    ('admin'),
    ('onboarding'),
    ('public_website')
) AS m(menu_key)
ON CONFLICT (role_key, menu_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- What "Success. No rows returned" means
--   DDL / GRANT / seed UPDATEs. The result pane is often empty — that is normal.
--
-- Validation (these SHOULD return rows):
--
-- 1) Table + function exist — expect 2 rows:
--    SELECT 'role_menu_access' AS obj
--    WHERE to_regclass('public.role_menu_access') IS NOT NULL
--    UNION ALL
--    SELECT proname FROM pg_proc WHERE proname = 'is_menu_access_editor';
--
-- 2) Seeded cells — expect 96 rows (6 roles × 16 menus):
--    SELECT count(*) FROM public.role_menu_access;
--
-- 3) Driver grants — expect 5 write rows:
--    SELECT menu_key, access_level
--    FROM public.role_menu_access
--    WHERE role_key = 'driver' AND access_level = 'write'
--    ORDER BY 1;
--
-- 4) Anon must not read this table (publishable key, no JWT) — 0 rows or 401.
-- ---------------------------------------------------------------------------
