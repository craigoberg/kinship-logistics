// ============================================================================
// client_attendance_log — Day Centre arrival roll + single-row escalator.
//
// Auto-seeded from participant_attendance_schedules at session open. The
// 60 s background sweep promotes overdue rows YELLOW → RED on the SAME
// site_issues_register row (never duplicated). RED additionally fires the
// SMS pipeline via the /api/internal/attendance-sms server route.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { resolveStaffIdWithFallback } from "@/lib/data-store";
import { writeToLedger, tryGetGps } from "@/lib/api/ledger";
import {
  getSydneyDayIndex,
  sydneyTimeTodayFromClock,
} from "@/lib/operational-time";
import { getTodayCentreHours } from "@/lib/api/centre-hours";



export type ArrivalMethod = "bus" | "private" | "walk_in" | "other";
export type AttendanceStatus =
  | "expected"
  | "checked_in"
  | "checked_out"
  | "absent"
  | "accounted";
export type EscalationSeverity = "yellow" | "red";
export type DepartureVector = "bus" | "family" | "independent";

export interface ClientAttendanceRow {
  id: string;
  sessionId: string;
  participantId: string;
  expectedArrivalAt: string;
  expectedDepartureAt: string | null;
  arrivalMethod: ArrivalMethod;
  checkedInAt: string | null;
  checkedInBy: string | null;
  checkedOutAt: string | null;
  checkedOutBy: string | null;
  status: AttendanceStatus;
  escalationIssueId: string | null;
  escalationSeverity: EscalationSeverity | null;
  escalationRaisedAt: string | null;
  redSmsDispatchedAt: string | null;
  departureIssueId: string | null;
  departureSeverity: EscalationSeverity | null;
  departureRaisedAt: string | null;
  departureRedSmsDispatchedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DbRow {
  id: string;
  session_id: string;
  participant_id: string;
  expected_arrival_at: string;
  expected_departure_at: string | null;
  arrival_method: ArrivalMethod;
  checked_in_at: string | null;
  checked_in_by: string | null;
  checked_out_at: string | null;
  checked_out_by: string | null;
  status: AttendanceStatus;
  escalation_issue_id: string | null;
  escalation_severity: EscalationSeverity | null;
  escalation_raised_at: string | null;
  red_sms_dispatched_at: string | null;
  departure_issue_id: string | null;
  departure_severity: EscalationSeverity | null;
  departure_raised_at: string | null;
  departure_red_sms_dispatched_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function toRow(r: DbRow): ClientAttendanceRow {
  return {
    id: r.id,
    sessionId: r.session_id,
    participantId: r.participant_id,
    expectedArrivalAt: r.expected_arrival_at,
    expectedDepartureAt: r.expected_departure_at ?? null,
    arrivalMethod: r.arrival_method,
    checkedInAt: r.checked_in_at,
    checkedInBy: r.checked_in_by,
    checkedOutAt: r.checked_out_at,
    checkedOutBy: r.checked_out_by,
    status: r.status,
    escalationIssueId: r.escalation_issue_id,
    escalationSeverity: r.escalation_severity,
    escalationRaisedAt: r.escalation_raised_at,
    redSmsDispatchedAt: r.red_sms_dispatched_at,
    departureIssueId: r.departure_issue_id ?? null,
    departureSeverity: r.departure_severity ?? null,
    departureRaisedAt: r.departure_raised_at ?? null,
    departureRedSmsDispatchedAt: r.departure_red_sms_dispatched_at ?? null,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Accept both full English weekday names ("Wednesday") AND the lookup-coded
// values stored on participant_attendance_schedules ("DAY-WED"). Without the
// DAY-XXX keys the filter below matches nothing and seeding silently inserts
// zero rows.
const WEEKDAY_INDEX: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
  Thursday: 4, Friday: 5, Saturday: 6,
  "DAY-SUN": 0, "DAY-MON": 1, "DAY-TUE": 2, "DAY-WED": 3,
  "DAY-THU": 4, "DAY-FRI": 5, "DAY-SAT": 6,
};




function mapTransportToMethod(transportRule: string | null): ArrivalMethod {
  const v = (transportRule ?? "").toLowerCase();
  if (v.includes("bus") || v.includes("pickup")) return "bus";
  if (v.includes("private") || v.includes("self") || v.includes("family"))
    return "private";
  if (v.includes("walk")) return "walk_in";
  return "other";
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listAttendanceRoll(
  sessionId: string,
): Promise<ClientAttendanceRow[]> {
  const { data, error } = await supabase
    .from("client_attendance_log")
    .select("*")
    .eq("session_id", sessionId)
    .order("expected_arrival_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => toRow(r as DbRow));
}

// ---------------------------------------------------------------------------
// Auto-seed from participant_attendance_schedules.
// Idempotent: ON CONFLICT (session_id, participant_id) DO NOTHING.
// Per-row expected_arrival_at is derived from the schedule's clock value
// (if the column exists) via sydneyTimeTodayFromClock(); the helper falls
// back to 09:00 Sydney when the clock value is null or malformed.
// ---------------------------------------------------------------------------

const SCHEDULE_CLOCK_FIELDS = [
  "arrival_time",
  "expected_arrival_time",
  "start_time",
  "pickup_time",
] as const;

function readScheduleClock(row: Record<string, unknown>): string | null {
  for (const f of SCHEDULE_CLOCK_FIELDS) {
    const v = row[f];
    if (typeof v === "string" && v.length > 0) return v.slice(0, 5);
  }
  return null;
}

export async function seedRollFromSchedules(sessionId: string): Promise<number> {
  const dow = getSydneyDayIndex();

  // SELECT * so we pick up an optional clock column if one is ever added
  // to participant_attendance_schedules without requiring another code change.
  const { data: scheds, error } = await supabase
    .from("participant_attendance_schedules")
    .select("*");
  if (error) throw error;

  const todays = (scheds ?? []).filter(
    (s: Record<string, unknown>) =>
      s.active === true && WEEKDAY_INDEX[String(s.day_of_week)] === dow,
  );
  if (!todays.length) return 0;

  const payload = todays.map((s: Record<string, unknown>) => ({
    session_id: sessionId,
    participant_id: s.participant_id as string,
    expected_arrival_at: sydneyTimeTodayFromClock(readScheduleClock(s)),
    arrival_method: mapTransportToMethod(
      (s.transport_required as string | null) ?? null,
    ),
  }));

  const { data: inserted, error: insErr } = await supabase
    .from("client_attendance_log")
    .upsert(payload, { onConflict: "session_id,participant_id", ignoreDuplicates: true })
    .select("id");
  if (insErr) {
    console.error("[client-attendance] seed failed", insErr);
    throw insErr;
  }
  return inserted?.length ?? 0;
}

// ---------------------------------------------------------------------------
// Context-aware YELLOW auto-close helper.
//   • Closes the linked site_issues_register row ONLY if its current severity
//     is 'yellow' AND status is 'open'.
//   • Clears the attendance row's escalation_* fields so the card returns to
//     a clean Green state.
//   • Writes the ≥10-char Compliance Shield receipt to operational_ledger.
// RED rows are never auto-closed — they remain open for manual manager review.
// Returns { kind } describing what was done so callers can ledger the result.
// ---------------------------------------------------------------------------

type AutoCloseOutcome =
  | { kind: "yellow_closed"; issueId: string }
  | { kind: "red_left_open"; issueId: string }
  | { kind: "no_issue" }
  | { kind: "already_closed"; issueId: string };

async function autoCloseYellowIssue(
  row: ClientAttendanceRow,
  reason: string,
  staffId: string,
): Promise<AutoCloseOutcome> {
  if (!row.escalationIssueId) return { kind: "no_issue" };
  const issueId = row.escalationIssueId;

  const { data: issue, error } = await supabase
    .from("site_issues_register")
    .select("id, severity, status")
    .eq("id", issueId)
    .maybeSingle();
  if (error || !issue) {
    console.error("[client-attendance] could not load linked issue", error);
    return { kind: "no_issue" };
  }

  if (issue.status !== "open") {
    // Already resolved earlier; still clear stale escalation pointer.
    await supabase
      .from("client_attendance_log")
      .update({
        escalation_issue_id: null,
        escalation_severity: null,
        escalation_raised_at: null,
      })
      .eq("id", row.id);
    return { kind: "already_closed", issueId };
  }

  if (issue.severity === "red") {
    return { kind: "red_left_open", issueId };
  }

  // YELLOW + open → auto-close.
  const nowIso = new Date().toISOString();
  await supabase
    .from("site_issues_register")
    .update({ status: "resolved", resolved_at: nowIso })
    .eq("id", issueId);

  await supabase
    .from("client_attendance_log")
    .update({
      escalation_issue_id: null,
      escalation_severity: null,
      escalation_raised_at: null,
    })
    .eq("id", row.id);

  await writeToLedger({
    staff_id: staffId,
    category: "CLIENT",
    severity: "GREEN",
    action_type: "ATTENDANCE_YELLOW_AUTO_CLOSED",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      attendance_id: row.id,
      issue_id: issueId,
      participant_id: row.participantId,
      reason, // ≥10 chars — Compliance Shield receipt.
    },
  });
  return { kind: "yellow_closed", issueId };
}

// ---------------------------------------------------------------------------
// Check in / out (tap toggles from the Section 4.4 mobile cards).
// On check-IN, applies the YELLOW vs RED context-aware closure rules.
// ---------------------------------------------------------------------------

export async function toggleCheckIn(
  row: ClientAttendanceRow,
): Promise<ClientAttendanceRow> {
  const staffId = await resolveStaffIdWithFallback();
  const nowIso = new Date().toISOString();
  const isCheckedIn = row.status === "checked_in";
  const next = isCheckedIn
    ? { status: "expected" as AttendanceStatus, checked_in_at: null, checked_in_by: null }
    : { status: "checked_in" as AttendanceStatus, checked_in_at: nowIso, checked_in_by: staffId };

  const { data, error } = await supabase
    .from("client_attendance_log")
    .update(next)
    .eq("id", row.id)
    .select("*")
    .single();
  if (error) throw error;

  const gps = await tryGetGps();
  await writeToLedger({
    staff_id: staffId,
    category: "CLIENT",
    severity: "GREEN",
    action_type: isCheckedIn ? "ATTENDANCE_CHECKIN_UNDO" : "ATTENDANCE_CHECKIN",
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    metadata: {
      attendance_id: row.id,
      session_id: row.sessionId,
      participant_id: row.participantId,
      expected_arrival_at: row.expectedArrivalAt,
    },
  });

  // Context-aware closure: only on the check-IN direction, never on undo.
  let finalRow = toRow(data as DbRow);
  if (!isCheckedIn) {
    const outcome = await autoCloseYellowIssue(
      row,
      "System Auto-Close: Client arrived safely.",
      staffId,
    );
    if (outcome.kind === "red_left_open") {
      await writeToLedger({
        staff_id: staffId,
        category: "CLIENT",
        severity: "RED",
        action_type: "ATTENDANCE_RED_CHECKIN_WHILE_OPEN",
        gps_lat: null,
        gps_lng: null,
        metadata: {
          attendance_id: row.id,
          issue_id: outcome.issueId,
          participant_id: row.participantId,
          reason:
            "Client arrived; RED issue remains open for manager review.",
        },
      });
    } else if (
      outcome.kind === "yellow_closed" ||
      outcome.kind === "already_closed"
    ) {
      // Re-read so the returned row reflects the cleared escalation fields.
      const { data: refreshed } = await supabase
        .from("client_attendance_log")
        .select("*")
        .eq("id", row.id)
        .single();
      if (refreshed) finalRow = toRow(refreshed as DbRow);
    }
  }
  return finalRow;
}

// ---------------------------------------------------------------------------
// Per-card "Adjust Expected Time" — operator pushes a single client's
// expected arrival forward/backward. If the new time pulls the row back
// inside the YELLOW threshold and the linked issue is still YELLOW + open,
// auto-close it. RED is never auto-cleared by a time adjustment.
// ---------------------------------------------------------------------------

export async function updateExpectedArrival(
  row: ClientAttendanceRow,
  hhmm: string,
  yellowThresholdMins: number,
): Promise<ClientAttendanceRow> {
  const staffId = await resolveStaffIdWithFallback();
  const newIso = sydneyTimeTodayFromClock(hhmm);
  const prevIso = row.expectedArrivalAt;

  const { data, error } = await supabase
    .from("client_attendance_log")
    .update({ expected_arrival_at: newIso })
    .eq("id", row.id)
    .select("*")
    .single();
  if (error) throw error;

  await writeToLedger({
    staff_id: staffId,
    category: "CLIENT",
    severity: "INFO",
    action_type: "ATTENDANCE_EXPECTED_TIME_ADJUSTED",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      attendance_id: row.id,
      participant_id: row.participantId,
      previous_expected_at: prevIso,
      new_expected_at: newIso,
      reason: "Operator adjusted expected arrival time.",
    },
  });

  // Did the new time pull the row back inside the YELLOW threshold?
  const overdueMins = Math.floor((Date.now() - Date.parse(newIso)) / 60_000);
  if (overdueMins < yellowThresholdMins) {
    await autoCloseYellowIssue(
      row,
      "Expected time adjusted; client no longer overdue.",
      staffId,
    );
    const { data: refreshed } = await supabase
      .from("client_attendance_log")
      .select("*")
      .eq("id", row.id)
      .single();
    if (refreshed) return toRow(refreshed as DbRow);
  }
  return toRow(data as DbRow);
}

// ---------------------------------------------------------------------------
// Bulk Defer Group — operator advances expected_arrival_at for every
// un-arrived passenger matching an arrival_method (e.g. all 'bus' clients
// when the pickup hits traffic). YELLOW issues clearing the threshold are
// auto-closed; RED is left for manual manager review.
// ---------------------------------------------------------------------------

export interface BulkDeferResult {
  deferredCount: number;
  yellowsAutoCleared: number;
}

export async function bulkDeferGroup(
  sessionId: string,
  method: ArrivalMethod,
  minutes: number,
  yellowThresholdMins: number,
): Promise<BulkDeferResult> {
  if (!Number.isFinite(minutes) || minutes === 0) {
    return { deferredCount: 0, yellowsAutoCleared: 0 };
  }
  const staffId = await resolveStaffIdWithFallback();
  const roll = await listAttendanceRoll(sessionId);
  const targets = roll.filter(
    (r) =>
      r.arrivalMethod === method &&
      r.status !== "checked_in" &&
      r.status !== "checked_out" &&
      r.status !== "accounted",
  );
  if (!targets.length) return { deferredCount: 0, yellowsAutoCleared: 0 };

  const updates = targets.map((r) => {
    const next = new Date(Date.parse(r.expectedArrivalAt) + minutes * 60_000)
      .toISOString();
    return { id: r.id, next, prev: r.expectedArrivalAt };
  });

  for (const u of updates) {
    await supabase
      .from("client_attendance_log")
      .update({ expected_arrival_at: u.next })
      .eq("id", u.id);
  }

  let yellowsAutoCleared = 0;
  for (const r of targets) {
    const u = updates.find((x) => x.id === r.id)!;
    const overdueMins = Math.floor((Date.now() - Date.parse(u.next)) / 60_000);
    if (overdueMins < yellowThresholdMins && r.escalationIssueId) {
      const outcome = await autoCloseYellowIssue(
        r,
        "Bulk Defer cleared overdue window for this client.",
        staffId,
      );
      if (outcome.kind === "yellow_closed") yellowsAutoCleared += 1;
    }
  }

  await writeToLedger({
    staff_id: staffId,
    category: "CLIENT",
    severity: "YELLOW",
    action_type: "ATTENDANCE_BULK_DEFER",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      session_id: sessionId,
      arrival_method: method,
      minutes,
      affected_count: updates.length,
      affected_ids: updates.map((u) => u.id),
      yellows_auto_cleared: yellowsAutoCleared,
      reason: `Bulk deferred ${updates.length} ${method} passenger(s) by ${minutes} minutes.`,
    },
  });

  return { deferredCount: updates.length, yellowsAutoCleared };
}


export async function markAccounted(
  rowId: string,
  notes: string,
): Promise<ClientAttendanceRow> {
  const staffId = await resolveStaffIdWithFallback();
  const { data, error } = await supabase
    .from("client_attendance_log")
    .update({ status: "accounted", notes })
    .eq("id", rowId)
    .select("*")
    .single();
  if (error) throw error;
  await writeToLedger({
    staff_id: staffId,
    category: "CLIENT",
    severity: "INFO",
    action_type: "ATTENDANCE_ACCOUNTED",
    gps_lat: null,
    gps_lng: null,
    metadata: { attendance_id: rowId, notes },
  });
  return toRow(data as DbRow);
}

// ---------------------------------------------------------------------------
// Mark Absent — operator confirms a client will not attend today. Removes
// them from the overdue queue (status='absent'; sweeper already skips this
// status) and closes any active YELLOW *or* RED issue tied to the row with
// a uniform resolution note. Writes a permanent ledger receipt.
// ---------------------------------------------------------------------------

export interface MarkAbsentResult {
  row: ClientAttendanceRow;
  closedIssueId: string | null;
  prevSeverity: EscalationSeverity | null;
}

export interface MarkAbsentInput {
  /** Short uppercase code, e.g. "SICK". Persisted in notes + ledger. */
  reasonCode: string;
  /** Human label, e.g. "Sick / unwell". */
  reasonLabel: string;
  /** Optional free-text detail typed by the operator. */
  detail?: string | null;
  /** Verified operator staff id (from PIN re-entry). Falls back if absent. */
  operatorStaffId?: string | null;
}

export async function markAttendanceAbsent(
  row: ClientAttendanceRow,
  input: MarkAbsentInput,
): Promise<MarkAbsentResult> {
  const verifiedStaffId =
    input.operatorStaffId ?? (await resolveStaffIdWithFallback());
  const nowIso = new Date().toISOString();

  const detail = (input.detail ?? "").trim();
  const noteLine =
    `[ABSENT:${input.reasonCode}] ${input.reasonLabel}` +
    (detail ? ` — ${detail}` : "") +
    ` (verified PIN @ ${nowIso})`;

  // Keep the row visible on the roll (the sweeper already skips status='absent').
  // We retain escalation_issue_id pointer on the row in case the issue stays
  // open elsewhere, but clear the active severity so the card paints "absent",
  // not yellow/red.
  const { data, error } = await supabase
    .from("client_attendance_log")
    .update({
      status: "absent",
      checked_in_at: null,
      checked_in_by: null,
      escalation_severity: null,
      escalation_raised_at: null,
      notes: noteLine,
    })
    .eq("id", row.id)
    .select("*")
    .single();
  if (error) throw error;

  let closedIssueId: string | null = null;
  const prevSeverity = row.escalationSeverity;

  if (row.escalationIssueId) {
    const { data: issue } = await supabase
      .from("site_issues_register")
      .select("id, status")
      .eq("id", row.escalationIssueId)
      .maybeSingle();
    if (issue && issue.status === "open") {
      const { error: closeErr } = await supabase
        .from("site_issues_register")
        .update({
          status: "resolved",
          resolved_at: nowIso,
        })
        .eq("id", row.escalationIssueId);
      if (!closeErr) closedIssueId = row.escalationIssueId;
    }
  }

  await writeToLedger({
    staff_id: verifiedStaffId,
    category: "CLIENT",
    severity: "GREEN",
    action_type: "ATTENDANCE_MARKED_ABSENT",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      attendance_id: row.id,
      session_id: row.sessionId,
      participant_id: row.participantId,
      prev_severity: prevSeverity,
      closed_issue_id: closedIssueId,
      absence_reason_code: input.reasonCode,
      absence_reason_label: input.reasonLabel,
      absence_detail: detail || null,
      operator_pin_verified: true,
      reason: `Client absent (${input.reasonCode}): ${input.reasonLabel}.`,
    },
  });

  return { row: toRow(data as DbRow), closedIssueId, prevSeverity };
}

// ---------------------------------------------------------------------------
// Add Attendee — unscheduled walk-in. Eligible list = active participants
// not already on today's roll. Inject creates a fresh row checked-in NOW.
// ---------------------------------------------------------------------------

export interface EligibleAttendee {
  id: string;
  fullName: string;
}

export async function listEligibleAddAttendees(
  sessionId: string,
): Promise<EligibleAttendee[]> {
  const [{ data: parts, error: pErr }, { data: roll, error: rErr }] =
    await Promise.all([
      supabase
        .from("participants")
        .select("id, full_name, status")
        .eq("status", "active"),
      supabase
        .from("client_attendance_log")
        .select("participant_id")
        .eq("session_id", sessionId),
    ]);
  if (pErr) throw pErr;
  if (rErr) throw rErr;
  const taken = new Set(
    (roll ?? []).map((r) => (r as { participant_id: string }).participant_id),
  );
  return (parts ?? [])
    .filter((p) => !taken.has((p as { id: string }).id))
    .map((p) => ({
      id: (p as { id: string }).id,
      fullName: (p as { full_name: string }).full_name,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function addWalkInAttendee(
  sessionId: string,
  participantId: string,
): Promise<ClientAttendanceRow> {
  const staffId = await resolveStaffIdWithFallback();
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("client_attendance_log")
    .insert({
      session_id: sessionId,
      participant_id: participantId,
      expected_arrival_at: nowIso,
      arrival_method: "walk_in" as ArrivalMethod,
      status: "checked_in" as AttendanceStatus,
      checked_in_at: nowIso,
      checked_in_by: staffId,
    })
    .select("*")
    .single();
  if (error) throw error;

  await writeToLedger({
    staff_id: staffId,
    category: "CLIENT",
    severity: "INFO",
    action_type: "ATTENDANCE_WALKIN_ADDED",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      attendance_id: (data as DbRow).id,
      session_id: sessionId,
      participant_id: participantId,
      reason: "Unscheduled walk-in added to today's roll.",
    },
  });

  return toRow(data as DbRow);
}



// ---------------------------------------------------------------------------
// Single-row escalator — sweep called every 60s by useQuery refetchInterval.
//   • YELLOW → insert one site_issues_register row, persist its id on the
//     attendance row in escalation_issue_id.
//   • RED   → UPDATE the SAME issue row to severity='red', fire SMS pipeline.
// Never duplicates a row for the same participant/session.
// ---------------------------------------------------------------------------

export interface SweepResult {
  yellowRaised: number;
  redRaised: number;
}

export async function sweepOverdueArrivals(
  sessionId: string,
  yellowMins: number,
  redMins: number,
  participantNames: Record<string, string>,
): Promise<SweepResult> {
  const roll = await listAttendanceRoll(sessionId);
  const now = Date.now();
  let yellowRaised = 0;
  let redRaised = 0;

  for (const r of roll) {
    if (r.checkedInAt || r.status === "accounted" || r.status === "absent")
      continue;
    const expected = Date.parse(r.expectedArrivalAt);
    if (!Number.isFinite(expected)) continue;
    const overdueMins = Math.floor((now - expected) / 60_000);
    if (overdueMins < yellowMins) continue;

    const pName = participantNames[r.participantId] ?? "Client";
    const wantRed = overdueMins >= redMins;

    // ── No issue yet → raise YELLOW (one row). ───────────────────────────
    if (!r.escalationIssueId) {
      const description = `[ATTENDANCE] ${pName} overdue by ${overdueMins} min (expected ${new Date(r.expectedArrivalAt).toLocaleTimeString()}).`;
      const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
      const insertSeverity: EscalationSeverity = wantRed ? "red" : "yellow";

      const { data: issue, error: issueErr } = await supabase
        .from("site_issues_register")
        .insert({
          session_id: sessionId,
          reported_by: userId,
          severity: insertSeverity,
          issue_description: description,
          workaround_plan: null,
          owner: "internal",
          status: "open",
        })
        .select("id")
        .single();
      if (issueErr) {
        console.error("[client-attendance] sweep yellow insert failed", issueErr);
        continue;
      }

      await supabase
        .from("client_attendance_log")
        .update({
          escalation_issue_id: issue.id as string,
          escalation_severity: insertSeverity,
          escalation_raised_at: new Date().toISOString(),
        })
        .eq("id", r.id);

      const staffId = await resolveStaffIdWithFallback();
      await writeToLedger({
        staff_id: staffId,
        category: "CLIENT",
        severity: wantRed ? "RED" : "YELLOW",
        action_type: wantRed
          ? "ATTENDANCE_RED_ESCALATED"
          : "ATTENDANCE_YELLOW_RAISED",
        gps_lat: null,
        gps_lng: null,
        metadata: {
          attendance_id: r.id,
          issue_id: issue.id,
          participant_id: r.participantId,
          overdue_mins: overdueMins,
          threshold_mins: wantRed ? redMins : yellowMins,
        },
      });
      if (wantRed) {
        await fireRedSmsPipeline(r.id, pName, r.expectedArrivalAt, sessionId);
        redRaised += 1;
      } else {
        yellowRaised += 1;
      }
      continue;
    }

    // ── Yellow row already exists → mutate the SAME id to RED if due. ────
    if (wantRed && r.escalationSeverity !== "red") {
      const { error: upErr } = await supabase
        .from("site_issues_register")
        .update({
          severity: "red",
          issue_description: `[ATTENDANCE] ${pName} overdue by ${overdueMins} min — escalated to RED.`,
        })
        .eq("id", r.escalationIssueId);
      if (upErr) {
        console.error("[client-attendance] sweep red mutate failed", upErr);
        continue;
      }
      await supabase
        .from("client_attendance_log")
        .update({ escalation_severity: "red" })
        .eq("id", r.id);

      const staffId = await resolveStaffIdWithFallback();
      await writeToLedger({
        staff_id: staffId,
        category: "CLIENT",
        severity: "RED",
        action_type: "ATTENDANCE_RED_ESCALATED",
        gps_lat: null,
        gps_lng: null,
        metadata: {
          attendance_id: r.id,
          issue_id: r.escalationIssueId,
          participant_id: r.participantId,
          overdue_mins: overdueMins,
        },
      });
      await fireRedSmsPipeline(r.id, pName, r.expectedArrivalAt, sessionId);
      redRaised += 1;
    }
  }

  return { yellowRaised, redRaised };
}

async function fireRedSmsPipeline(
  attendanceId: string,
  participantName: string,
  expectedAt: string,
  sessionId: string,
): Promise<void> {
  // Lazy import keeps this file safe in non-DOM contexts; emitter is SSR-guarded.
  const { emitMockSms } = await import("@/lib/notifications/mock-sms");
  try {
    const res = await fetch("/api/internal/attendance-sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attendanceId, participantName, expectedAt, sessionId }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      sent?: number;
      reason?: string;
      recipients?: string[];
      message?: string;
      reference?: string;
    };
    if (!res.ok) {
      console.error("[client-attendance] SMS pipeline non-OK", res.status, json);
      emitMockSms({
        recipient: "unknown",
        body: `[RED] ${participantName} — server route returned ${res.status}.`,
        source: "attendance_red",
        reason: "pipeline_non_ok",
        reference: `att-red-${attendanceId}`,
      });
      return;
    }
    const recipients = json.recipients ?? [];
    const message =
      json.message ??
      `[RED] ${participantName} missing from Day Centre — expected ${expectedAt}.`;
    const reason = json.reason ?? "unknown";
    if (recipients.length === 0) {
      emitMockSms({
        recipient: "(no recipients resolved)",
        body: message,
        source: "attendance_red",
        reason,
        reference: json.reference,
      });
    } else {
      for (const to of recipients) {
        emitMockSms({
          recipient: to,
          body: message,
          source: "attendance_red",
          reason,
          reference: json.reference,
        });
      }
    }
    await supabase
      .from("client_attendance_log")
      .update({ red_sms_dispatched_at: new Date().toISOString() })
      .eq("id", attendanceId);
  } catch (e) {
    console.error("[client-attendance] SMS pipeline threw", e);
    emitMockSms({
      recipient: "unknown",
      body: `[RED] ${participantName} — pipeline threw before send.`,
      source: "attendance_red",
      reason: "pipeline_error",
      reference: `att-red-${attendanceId}`,
    });
  }
}
