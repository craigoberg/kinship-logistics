-- 2026-08-22 — Idle screen lock minutes (BL-002 screen-lock slice)
--
-- Run in Supabase Dashboard → SQL Editor → Run All
--
-- Seeds auth_idle_lock_minutes (default 15). After this many wall-clock
-- minutes with no tap/key, the signed-in UI locks. The same staff member
-- unlocks with their PIN. 0 = disabled. Active Manifest run does not lock.
-- Admin → System Parameters → Idle screen lock edits this key.
--
-- Re-run is safe: description refreshes; an already-saved value is kept.

INSERT INTO public.system_parameters (key, value, description)
VALUES
  (
    'auth_idle_lock_minutes',
    '15'::jsonb,
    'Idle minutes after last tap/key before the signed-in screen locks. Same staff unlocks with their PIN. 0 = off. Active Manifest run does not lock. Default 15. Edited via Admin → System Parameters → Idle screen lock.'
  )
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- What "Success. No rows returned" means
--   This script is INSERT/NOTIFY only. No rows in the result pane is normal.
--
-- Validation (expect 1 row, value 15 unless a Manager already changed it):
--   SELECT key, value, description
--   FROM public.system_parameters
--   WHERE key = 'auth_idle_lock_minutes';
-- ---------------------------------------------------------------------------
