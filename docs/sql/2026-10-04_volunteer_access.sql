-- =============================================================================
-- 2026-10-04 — Volunteer is a system access level
-- =============================================================================
--
-- personnel_type "Volunteer" (the hat word) did not match the menu matrix,
-- so the staff profile showed a blank System Access Level.
-- This stores the key `volunteer` and copies Support Worker menu ticks
-- onto Volunteer. Managers can change those ticks in Admin → Menu Access.
--
-- "Success. No rows returned" is expected.
--
-- Validation — expect personnel_type volunteer, and write_menus matching
-- the Support Worker write count (usually 7):
--   SELECT personnel_type
--     FROM public.staff_registry
--    WHERE id = '5eb1ba9c-65ac-4f82-ab30-b88219985eb3';
--   SELECT
--     (SELECT count(*) FROM public.role_menu_access
--       WHERE role_key = 'volunteer' AND access_level = 'write') AS volunteer_writes,
--     (SELECT count(*) FROM public.role_menu_access
--       WHERE role_key = 'support_worker' AND access_level = 'write') AS support_writes;
-- =============================================================================

UPDATE public.staff_registry
   SET personnel_type = 'volunteer'
 WHERE lower(trim(personnel_type)) = 'volunteer';

INSERT INTO public.role_menu_access (role_key, menu_key, access_level)
SELECT 'volunteer', menu_key, access_level
  FROM public.role_menu_access
 WHERE role_key = 'support_worker'
ON CONFLICT (role_key, menu_key) DO NOTHING;
