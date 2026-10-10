-- Day Centre / Off today writes attendance_roster_logs.schedule_id.
-- Live DEV/TEST tables were created without that column → PostgREST PGRST204 400.
-- Idempotent. Do NOT GRANT anon (operational table).

ALTER TABLE public.attendance_roster_logs
  ADD COLUMN IF NOT EXISTS schedule_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'attendance_roster_logs_schedule_id_fkey'
      AND conrelid = 'public.attendance_roster_logs'::regclass
  ) THEN
    ALTER TABLE public.attendance_roster_logs
      ADD CONSTRAINT attendance_roster_logs_schedule_id_fkey
      FOREIGN KEY (schedule_id)
      REFERENCES public.participant_attendance_schedules(id)
      ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'SKIP FK attendance_roster_logs_schedule_id_fkey — participant_attendance_schedules missing';
  WHEN others THEN
    RAISE NOTICE 'SKIP FK attendance_roster_logs_schedule_id_fkey: %', SQLERRM;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_roster_logs TO authenticated;
GRANT ALL ON public.attendance_roster_logs TO service_role;

NOTIFY pgrst, 'reload schema';
