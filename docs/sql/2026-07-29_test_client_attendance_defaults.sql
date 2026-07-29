-- ============================================================================
-- 2026-07-29 — TEST: restore DEV defaults on client_attendance_log
-- OpenAPI bootstrap created NOT NULL columns without DEFAULTs.
-- ============================================================================

ALTER TABLE public.client_attendance_log
  ALTER COLUMN status SET DEFAULT 'expected';

ALTER TABLE public.client_attendance_log
  ALTER COLUMN arrival_method SET DEFAULT 'bus';
