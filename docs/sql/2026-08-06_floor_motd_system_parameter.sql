-- 2026-08-06 — Message of the Day (floor announcement strip)
--
-- Run in Supabase Dashboard → SQL Editor → Run All
--
-- Non-empty `floor_motd` value shows a calm MOTD strip on every AppShell page
-- when no Live/Drill emergency is active. Empty string = no MOTD.
-- Admin → System Parameters → Message of the Day panel edits this key.

INSERT INTO public.system_parameters (key, value, description)
VALUES
  (
    'floor_motd',
    '""'::jsonb,
    'Message of the Day shown on every signed-in page when non-empty. Cleared/empty = off. Hidden while an operational emergency (Drill|Live) is active. Edited via Admin → System Parameters → Message of the Day.'
  )
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Post-migration validation (expect 1 row; value may be "" or a message)
-- ---------------------------------------------------------------------------
-- SELECT key, value, description
-- FROM public.system_parameters
-- WHERE key = 'floor_motd';
