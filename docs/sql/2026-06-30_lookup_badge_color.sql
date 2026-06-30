-- 2026-06-30_lookup_badge_color.sql
-- Adds a badge_color column to system_lookup_parameters so coordinators
-- can assign a hex color to any lookup entry (bus runs, transport types, etc.)
-- The color is used in the Participants Directory transport badges.
--
-- Run in Supabase SQL editor BEFORE deploying the frontend changes.

ALTER TABLE public.system_lookup_parameters
  ADD COLUMN IF NOT EXISTS badge_color text DEFAULT NULL;

COMMENT ON COLUMN public.system_lookup_parameters.badge_color IS
  'Optional hex color code (e.g. #7c3aed) shown in UI badges for this entry.';

-- Seed sensible default colors for the two bus runs added earlier.
UPDATE public.system_lookup_parameters
  SET badge_color = '#7c3aed'   -- violet
  WHERE category = 'bus_runs' AND code = 'BUSRUN-1' AND badge_color IS NULL;

UPDATE public.system_lookup_parameters
  SET badge_color = '#d97706'   -- amber
  WHERE category = 'bus_runs' AND code = 'BUSRUN-2' AND badge_color IS NULL;
