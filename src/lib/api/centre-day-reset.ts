/**
 * TEST rewind — clear today's Day Centre floor so Start of Day is empty again.
 * Weekly schedules stay. The roll is seeded again from those schedules.
 */
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { seedRollFromSchedules } from "@/lib/api/client-attendance";
import { seedSupportRollFromSchedules } from "@/lib/api/support-attendance";
import { getSydneyTimeTodayIso } from "@/lib/operational-time";
import { operationalNowIso } from "@/lib/operational-clock";

export type CentreFloorResetCounts = {
  clientAttendance: number;
  supportAttendance: number;
  visitors: number;
  mealRolls: number;
  issues: number;
  rosterLogs: number;
  supportRosterLogs: number;
  trips: number;
  medicationLogs: number;
  clientReseeded: number;
  supportReseeded: number;
};

const MED_ACTIONS = [
  "MEDICATION_ADMIN_QUICK",
  "MEDICATION_ADMIN_DUAL",
  "MEDICATION_ADMIN_SOLE",
];

const REWIND_STAMPS = {
  status: "expected",
  checked_in_at: null,
  checked_in_by: null,
  checked_out_at: null,
  checked_out_by: null,
} as const;

async function tryUpdateIds(
  table: string,
  ids: string[],
  patch: Record<string, unknown>,
): Promise<number | "mismatch"> {
  let updated = 0;
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const { data, error } = await supabase
      .from(table)
      .update(patch)
      .in("id", chunk)
      .select("id");
    if (error) {
      if (isSchemaMismatchError(error)) return "mismatch";
      throw new Error(`${table}: ${error.message}`);
    }
    updated += data?.length ?? 0;
  }
  return updated;
}

async function clearSessionRows(
  table: string,
  sessionId: string,
  patch: Record<string, unknown>,
): Promise<number> {
  const { data: existing, error: readErr } = await supabase
    .from(table)
    .select("id")
    .eq("session_id", sessionId);
  if (readErr) {
    if (isSchemaMismatchError(readErr)) return 0;
    throw new Error(`${table}: ${readErr.message}`);
  }
  const ids = (existing ?? []).map((row) => String((row as { id: string }).id));
  if (ids.length === 0) return 0;

  let updated = await tryUpdateIds(table, ids, {
    ...patch,
    updated_at: operationalNowIso(),
  });
  if (updated === "mismatch") {
    updated = await tryUpdateIds(table, ids, { ...REWIND_STAMPS });
  }
  if (updated === "mismatch") {
    throw new Error(`${table}: could not rewind attendance.`);
  }
  if (updated !== ids.length) {
    throw new Error(`${table}: rewind updated ${updated} of ${ids.length} people.`);
  }

  const { data: still, error: stillErr } = await supabase
    .from(table)
    .select("id")
    .eq("session_id", sessionId)
    .neq("status", "expected");
  if (stillErr) throw new Error(`${table}: ${stillErr.message}`);
  if ((still ?? []).length > 0) {
    throw new Error(
      `${table}: ${still.length} people are still not back to expected.`,
    );
  }
  return updated;
}

async function deleteEq(
  table: string,
  column: string,
  value: string,
): Promise<number> {
  const { data, error } = await supabase
    .from(table)
    .delete()
    .eq(column, value)
    .select("id");
  if (error) {
    if (isSchemaMismatchError(error)) return 0;
    throw new Error(`${table}: ${error.message}`);
  }
  return data?.length ?? 0;
}

async function deleteIn(table: string, column: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await supabase
    .from(table)
    .delete()
    .in(column, ids)
    .select("id");
  if (error) {
    if (isSchemaMismatchError(error)) return 0;
    throw new Error(`${table}: ${error.message}`);
  }
  return data?.length ?? 0;
}

function issueIdsFrom(rows: Array<Record<string, unknown>>): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    for (const key of ["escalation_issue_id", "departure_issue_id"]) {
      const id = row[key];
      if (typeof id === "string" && id) ids.add(id);
    }
  }
  return [...ids];
}

export async function resetCentreFloorForSession(
  sessionId: string,
  dateIso: string,
): Promise<CentreFloorResetCounts> {
  const { data: clientRows, error: clientErr } = await supabase
    .from("client_attendance_log")
    .select("id, escalation_issue_id, departure_issue_id")
    .eq("session_id", sessionId);
  if (clientErr) throw new Error(`client_attendance_log: ${clientErr.message}`);

  const { data: supportRows, error: supportErr } = await supabase
    .from("support_attendance_log")
    .select("id, escalation_issue_id")
    .eq("session_id", sessionId);
  const supportList = supportErr && isSchemaMismatchError(supportErr) ? [] : (supportRows ?? []);
  if (supportErr && !isSchemaMismatchError(supportErr)) {
    throw new Error(`support_attendance_log: ${supportErr.message}`);
  }

  const linkedIssueIds = issueIdsFrom([
    ...((clientRows ?? []) as Array<Record<string, unknown>>),
    ...(supportList as Array<Record<string, unknown>>),
  ]);

  const clientAttendance = await clearSessionRows("client_attendance_log", sessionId, {
    status: "expected",
    checked_in_at: null,
    checked_in_by: null,
    checked_out_at: null,
    checked_out_by: null,
    notes: null,
    escalation_issue_id: null,
    escalation_severity: null,
    escalation_raised_at: null,
    red_sms_dispatched_at: null,
    departure_issue_id: null,
    departure_severity: null,
    departure_raised_at: null,
    departure_red_sms_dispatched_at: null,
  });
  const supportAttendance = await clearSessionRows("support_attendance_log", sessionId, {
    status: "expected",
    checked_in_at: null,
    checked_in_by: null,
    checked_out_at: null,
    checked_out_by: null,
    notes: null,
    escalation_issue_id: null,
    escalation_severity: null,
  });
  const visitors = await deleteEq("site_day_visitors", "session_id", sessionId);

  const { data: activities, error: actErr } = await supabase
    .from("site_day_activities")
    .select("id")
    .eq("session_id", sessionId);
  if (actErr && !isSchemaMismatchError(actErr)) {
    throw new Error(`site_day_activities: ${actErr.message}`);
  }
  const activityIds = (activities ?? []).map((r) => (r as { id: string }).id);
  const mealRolls = await deleteIn("site_day_meal_service_rolls", "activity_id", activityIds);

  const sessionIssues = await deleteEq("site_issues_register", "session_id", sessionId);
  const linkedIssues = await deleteIn("site_issues_register", "id", linkedIssueIds);

  const rosterLogs = await deleteEq("attendance_roster_logs", "roster_date", dateIso);
  const supportRosterLogs = await deleteEq("support_roster_logs", "roster_date", dateIso);

  const { data: trips, error: tripErr } = await supabase
    .from("transport_trips")
    .select("id")
    .eq("trip_date", dateIso)
    .is("event_id", null);
  if (tripErr && !isSchemaMismatchError(tripErr)) {
    throw new Error(`transport_trips: ${tripErr.message}`);
  }
  const tripIds = (trips ?? []).map((r) => (r as { id: string }).id);
  await deleteIn("trip_run_notices", "trip_id", tripIds);
  await deleteIn("trip_legs", "trip_id", tripIds);
  const tripsDeleted = await deleteIn("transport_trips", "id", tripIds);

  const since = getSydneyTimeTodayIso(0, 0);
  const { data: meds, error: medErr } = await supabase
    .from("compliance_audit_logs")
    .select("id, metadata")
    .gte("timestamp", since)
    .in("action_performed", MED_ACTIONS)
    .limit(1000);
  let medicationLogs = 0;
  if (medErr && !isSchemaMismatchError(medErr)) {
    throw new Error(`compliance_audit_logs: ${medErr.message}`);
  }
  if (!medErr) {
    const medIds = (meds ?? [])
      .filter((raw) => {
        const meta = (raw as { metadata?: Record<string, unknown> | null }).metadata ?? {};
        return !meta.event_id && !meta.event_day_session_id;
      })
      .map((raw) => (raw as { id: string }).id);
    medicationLogs = await deleteIn("compliance_audit_logs", "id", medIds);
  }

  const clientReseeded = await seedRollFromSchedules(sessionId);
  const supportReseeded = await seedSupportRollFromSchedules(sessionId);

  return {
    clientAttendance,
    supportAttendance,
    visitors,
    mealRolls,
    issues: sessionIssues + linkedIssues,
    rosterLogs,
    supportRosterLogs,
    trips: tripsDeleted,
    medicationLogs,
    clientReseeded,
    supportReseeded,
  };
}
