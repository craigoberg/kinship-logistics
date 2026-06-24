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
  getSydneyTimeTodayIso,
  sydneyTimeTodayFromClock,
} from "@/lib/operational-time";


export type ArrivalMethod = "bus" | "private" | "walk_in" | "other";
export type AttendanceStatus =
  | "expected"
  | "checked_in"
  | "checked_out"
  | "absent"
  | "accounted";
export type EscalationSeverity = "yellow" | "red";

export interface ClientAttendanceRow {
  id: string;
  sessionId: string;
  participantId: string;
  expectedArrivalAt: string;
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
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DbRow {
  id: string;
  session_id: string;
  participant_id: string;
  expected_arrival_at: string;
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

function defaultExpectedToday(): string {
  // 09:00 Sydney local — sensible Day Centre default. Threshold tunables remain
  // configurable via system_parameters.
  return getSydneyTimeTodayIso(9, 0);
}

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
// ---------------------------------------------------------------------------

export async function seedRollFromSchedules(sessionId: string): Promise<number> {
  const dow = getSydneyDayIndex();
  const expectedIso = defaultExpectedToday();

  const { data: scheds, error } = await supabase
    .from("participant_attendance_schedules")
    .select("participant_id, day_of_week, transport_required, active");
  if (error) throw error;

  const todays = (scheds ?? []).filter(
    (s) =>
      s.active && WEEKDAY_INDEX[s.day_of_week as string] === dow,
  );
  if (!todays.length) return 0;

  const payload = todays.map((s) => ({
    session_id: sessionId,
    participant_id: s.participant_id as string,
    expected_arrival_at: expectedIso,
    arrival_method: mapTransportToMethod(s.transport_required as string | null),
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
// Check in / out (tap toggles from the Section 4.4 mobile cards).
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
  return toRow(data as DbRow);
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
  try {
    const res = await fetch("/api/internal/attendance-sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attendanceId, participantName, expectedAt, sessionId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("[client-attendance] SMS pipeline non-OK", res.status, json);
      return;
    }
    await supabase
      .from("client_attendance_log")
      .update({ red_sms_dispatched_at: new Date().toISOString() })
      .eq("id", attendanceId);
  } catch (e) {
    console.error("[client-attendance] SMS pipeline threw", e);
  }
}
