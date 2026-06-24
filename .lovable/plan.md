## Fix Edit/Add Operational Schedule modal

Two issues, both isolated to the recurring-schedule form for participants:

### 1. Invisible time inputs

`AddAttendanceScheduleModal` renders the two `<input type="time">` fields with `bg-background` + `text-slate-900`. In the dark dialog the value text and the native clock glyph render dark-on-dark, so the field looks empty even though `09:00` / `15:00` are set.

**Fix** — match the rest of the dialog's inputs:
- Replace the hand-rolled `<input>` styling with classes that follow the theme: `bg-input text-foreground` (or the same class string used by the shadcn `Input`).
- Add `[color-scheme:dark]` so the native time-picker chrome (clock icon, AM/PM caret) inverts to a light glyph on the dark surface.
- Keep the existing border/padding/rounded so layout doesn't shift.

File: `src/components/attendance/add-attendance-schedule-modal.tsx` (lines 189-217 only).

### 2. `400` on Save changes

The form posts `expected_arrival_time` / `expected_departure_time` to `participant_attendance_schedules`. The columns are added by `docs/sql/2026-07-11_attendance_schedule_times.sql`, but the 400 response means that migration was never executed against the live Supabase project — PostgREST rejects the unknown columns.

**Fix** — apply the existing migration. No new SQL needed; the file already uses `ADD COLUMN IF NOT EXISTS` so it is safe to re-run.

> [!IMPORTANT]
> Action required: open the Supabase SQL editor and run `docs/sql/2026-07-11_attendance_schedule_times.sql`. After it succeeds the Save changes button will return 200 and the new time fields will round-trip.

### Out of scope

No changes to the seeder, data-store mappers, or hooks — they already speak the new column names correctly. No schema changes beyond the already-authored migration.