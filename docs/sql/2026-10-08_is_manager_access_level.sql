-- 2026-10-08 — is_manager uses system access level, not job title
--
-- Run in Supabase Dashboard → SQL Editor → Run All
--
-- staff_registry.role is a label (Volunteer Driver, Bugs Bunny, anything).
-- staff_registry.personnel_type is what a person is allowed to do.
-- Manager and Assistant Manager pass. A title that contains "manager" does not.

CREATE OR REPLACE FUNCTION public.is_manager(_user_id uuid)
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
       AND (s.id = _user_id OR s.auth_user_id = _user_id)
       AND s.personnel_type IN ('manager', 'assistant_manager')
  )
$$;

-- "Success. No rows returned" is expected. This only replaces the function.
-- Privileges on is_manager(uuid) stay as they are.

-- Validation — expect one row per active person. is_manager is true only when
-- personnel_type is manager or assistant_manager, whatever the title says.
-- Mark Kilcoyne should be true when his system access level is Manager.
SELECT full_name, role AS title, personnel_type AS access_level, public.is_manager(id) AS is_manager
FROM public.staff_registry
WHERE active IS DISTINCT FROM false
ORDER BY full_name;
