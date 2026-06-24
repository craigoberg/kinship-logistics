# Master Operating Hours + Departure Escalation Plan

## 1. Admin "Centre Operating Hours" Matrix

**New table** `public.centre_operating_hours` (migration `2026-07-12_centre_operating_hours.sql`):
- `day_of_week` text PK — values `DAY-MON`…`DAY-SUN` (matches the lookup codes already used by `participant_attendance_schedules`).
- `open_time` time NOT NULL DEFAULT `'09:00'`
- `close_time` time NOT NULL DEFAULT `'15:00'`
- `updated_at`, `updated_by_staff_id`.
- Seed all 7 rows on create. GRANTs to authenticated + service_role; RLS enabled; read-all policy, write restricted via `has_role('manager')`.

**New API module** `src/lib/api/centre-hours.ts`:
- `listCentreHours(): Promise<CentreHourRow[]>` (ordered Mon→Sun via `dayChronoIndex`).
- `updateCentreHours(dayCode, openTime, closeTime, justification)` — writes row + ledger receipt `CENTRE_HOURS_UPDATED` (≥10 char justification).

**New admin tab** `src/components/admin/centre-operating-hours-workspace.tsx`:
- 7-row table (Mon→Sun chronological), two `<input type="time">` per row, Save button per row (manager-only; read-only badge otherwise).
- Mirrors `system-parameter-workspace` styling.
- Wired into `src/routes/admin.tsx` as a new `TabsTrigger value="hours"` → "Centre Operating Hours".

## 2. Seeder 3-Tier Priority Ladder

Update `seedRollFromSchedules` in `src/lib/api/client-attendance.ts`:

1. **Tier 1 — Participant override**: existing `readScheduleClock(s)` on `participant_attendance_schedules.expected_arrival_time` (and `expected_departure_time` for the new departure column on the roll row).
2. **Tier 2 — Weekday master default**: pre-fetch today's `centre_operating_hours` row (by `getSydneyDayIndex()` → `DAY-XXX`) and use `open_time` when Tier 1 is blank, `close_time` for departure.
3. **Tier 3 — System baseline**: existing `sydneyTimeTodayFromClock(null)` fallback (09:00 / 15:00).

Also persist the resolved expected departure on the attendance row (see §3 schema add) so the sweeper can read it.

## 3. Symmetrical Overdue Departure Engine

**Schema additions** (same migration file):
- `client_attendance_log.expected_departure_at timestamptz` — populated at seed time using the 3-tier ladder.
- `client_attendance_log.departure_issue_id uuid REFERENCES site_issues_register(id)` — single-rail pointer (separate from `escalation_issue_id` so arrival + departure can coexist).
- `client_attendance_log.departure_severity text CHECK IN ('yellow','red')`.
- `client_attendance_log.departure_raised_at timestamptz`.
- `client_attendance_log.departure_red_sms_dispatched_at timestamptz`.

**Two new system_parameters** seeded if missing:
- `attendance_departure_yellow_threshold_mins` (default 30)
- `attendance_departure_red_threshold_mins` (default 60)

**Extend** `sweepOverdueArrivals` → rename internally to handle both rails, or add a sibling `sweepOverdueDepartures` called from the same `useQuery.queryFn` in `attendance-roll-panel.tsx`:
- Iterate `roll` filtered to `status === 'checked_in'` AND `expectedDepartureAt` set AND `checkedOutAt === null`.
- Compute `overdueMins = (now − expected_departure_at) / 60_000`.
- **Yellow path**: if `≥ yellow` and `departure_issue_id` is null → INSERT one `site_issues_register` row (`severity='yellow'`, `issue_description = "[DEPARTURE] {Name} overdue checkout by {N} min (expected {HH:MM})."`, `owner='internal'`); persist `departure_issue_id`, `departure_severity='yellow'`, `departure_raised_at`. Ledger `ATTENDANCE_DEPARTURE_YELLOW_RAISED`.
- **Red path**: if `≥ red` AND existing row is yellow → UPDATE the SAME `site_issues_register` row to `severity='red'` with rephrased description, set `departure_severity='red'`, fire `fireRedDepartureSmsPipeline()`. Ledger `ATTENDANCE_DEPARTURE_RED_ESCALATED`.
- Card UI in `attendance-roll-panel.tsx`: extend the per-row severity calc to also paint amber border when `departureSeverity === 'yellow'` and destructive border when `'red'`; show `Departure Overdue` / `Departure Escalated` badge. Keeps existing arrival colours when both exist (departure wins because the participant is already checked in).

**SMS pipeline**:
- New server route `src/routes/api/internal/departure-sms.ts` — clone of `attendance-sms.ts` with: distinct `key='attendance_departure_red_sms_recipients'` (fallback to Manager tier), message `"[RED DEPARTURE] {Name} has not been checked out — expected {HH:MM}. Please confirm whereabouts."`, reference `dep-red-${id}`.
- Client wrapper `fireRedDepartureSmsPipeline()` in `client-attendance.ts` — mirrors `fireRedSmsPipeline` and calls `emitMockSms` so the diagnostic popups appear during testing.

## 4. Symmetrical Auto-Healing on Checkout

**New API** `checkOutParticipant(row, vector)` in `client-attendance.ts` where vector is `'bus' | 'family' | 'independent'`:
- Sets `status='checked_out'`, `checked_out_at=now()`, `checked_out_by=staffId`.
- Ledger `ATTENDANCE_CHECKOUT` with vector + GPS.
- Reuse-pattern helper `autoCloseYellowDepartureIssue(row, reason, staffId)` mirroring the existing `autoCloseYellowIssue`:
  - If `departure_issue_id` null → no-op.
  - If linked issue `severity='yellow'` AND `status='open'` → resolve it, clear `departure_*` pointers on the attendance row, write `ATTENDANCE_DEPARTURE_YELLOW_AUTO_CLOSED` ledger receipt (≥10 char Compliance Shield reason).
  - If `severity='red'` → leave the issue OPEN (checkout still commits on the floor); write `ATTENDANCE_DEPARTURE_RED_CHECKOUT_WHILE_OPEN` ledger receipt so the Governance Hub keeps the RED for manual manager sign-off.

**UI**: in `attendance-roll-panel.tsx`, when `status === 'checked_in'`, render a small `LogOut` button beside the existing Clock icon that opens a tiny popover with three quick-tap buttons "Bus / Family / Independent" → calls `checkOutParticipant`. After checkout the row paints in a neutral slate "Checked out at HH:MM" state (analogous to the absent treatment already shipped).

## 5. Files Touched

**Created**
- `docs/sql/2026-07-12_centre_operating_hours.sql`
- `src/lib/api/centre-hours.ts`
- `src/components/admin/centre-operating-hours-workspace.tsx`
- `src/routes/api/internal/departure-sms.ts`
- `src/components/site-day/check-out-popover.tsx`

**Edited**
- `src/routes/admin.tsx` — add 4th tab "Centre Operating Hours".
- `src/lib/api/client-attendance.ts` — schema-typed `expectedDepartureAt` + `departure*` fields on `ClientAttendanceRow`/`DbRow`, 3-tier seeder, `sweepOverdueDepartures`, `checkOutParticipant`, `autoCloseYellowDepartureIssue`, `fireRedDepartureSmsPipeline`.
- `src/components/site-day/attendance-roll-panel.tsx` — render departure severity, add checkout button, run departure sweep alongside arrival sweep.
- `src/hooks/use-system-parameters.ts` — (no change; thresholds read via existing `useSystemParameter<number>` hook in the roll panel).

## 6. Out of Scope

- No change to the existing arrival YELLOW→RED engine logic (it stays single-rail on `escalation_*`).
- No bulk departure defer modal (deferred until a real-world need surfaces).
- No edit-departure-time modal on the card (uses seeded value; can be added later mirroring the arrival adjust modal).
- No change to End-of-Day closure modal (already handles un-accounted clients).

> **Action required after build**: run `docs/sql/2026-07-12_centre_operating_hours.sql` in the Supabase SQL editor — it creates the new table, seeds the 7 weekday rows, and adds the departure columns + parameter rows.
