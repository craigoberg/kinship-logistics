/**
 * BL-125 — Day Centre support people (staff / volunteer / carer).
 * Weekly plan + floor presence. Not meal / med / NDIS billing.
 */
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { writeToLedger, writeToLedgerOrThrow } from "@/lib/api/ledger";
import { resolveStaffIdWithFallback } from "@/lib/data-store";
import {
  getOperationalTodayIso,
  operationalNowIso,
  operationalNowMs,
} from "@/lib/operational-clock";
import { getSydneyDayIndex, sydneyTimeTodayFromClock } from "@/lib/operational-time";
import { getTodayCentreHours } from "@/lib/api/centre-hours";
import type {
  ArrivalMethod,
  AttendanceStatus,
  DepartureVector,
  EscalationSeverity,
} from "@/lib/api/client-attendance";
import {
  skipActiveTripPickupsForExemption,
  type OfficeRunExemptionResult,
} from "@/lib/api/office-run-exemption";
import {
  classifyWorkforceKind,
  supportPersonKey,
  supportRosterPerson,
  type SupportPersonKind,
  type TransportRosterPerson,
} from "@/lib/support-person";

const WEEKDAY_INDEX: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  "DAY-SUN": 0,
  "DAY-MON": 1,
  "DAY-TUE": 2,
  "DAY-WED": 3,
  "DAY-THU": 4,
  "DAY-FRI": 5,
  "DAY-SAT": 6,
};

export const SUPPORT_ROLL_KEY = (sessionId: string) =>
  ["support-attendance-roll", sessionId] as const;

export interface SupportSchedule {
  id: string;
  personKind: SupportPersonKind;
  staffId: string | null;
  carerId: string | null;
  linkedParticipantId: string | null;
  dayOfWeek: string;
  inboundTransport: string | null;
  outboundTransport: string | null;
  expectedArrivalTime: string;
  expectedDepartureTime: string;
  pickupAddressOverride: string | null;
  active: boolean;
  displayName: string;
}

export interface SupportAttendanceRow {
  id: string;
  sessionId: string;
  personKind: SupportPersonKind;
  staffId: string | null;
  carerId: string | null;
  linkedParticipantId: string | null;
  displayName: string;
  expectedArrivalAt: string | null;
  expectedDepartureAt: string | null;
  arrivalMethod: ArrivalMethod;
  arrivalBusRunCode: string | null;
  departureVector: DepartureVector | null;
  departureBusRunCode: string | null;
  checkedInAt: string | null;
  checkedInBy: string | null;
  checkedOutAt: string | null;
  checkedOutBy: string | null;
  status: Extract<AttendanceStatus, "expected" | "checked_in" | "checked_out" | "absent">;
  notes: string | null;
  escalationIssueId: string | null;
  escalationSeverity: EscalationSeverity | null;
}

interface ScheduleDb {
  id: string;
  person_kind: SupportPersonKind;
  staff_id: string | null;
  carer_id: string | null;
  linked_participant_id: string | null;
  day_of_week: string;
  inbound_transport: string | null;
  outbound_transport: string | null;
  expected_arrival_time: string | null;
  expected_departure_time: string | null;
  pickup_address_override: string | null;
  active: boolean;
}

interface LogDb {
  id: string;
  session_id: string;
  person_kind: SupportPersonKind;
  staff_id: string | null;
  carer_id: string | null;
  linked_participant_id: string | null;
  expected_arrival_at: string | null;
  expected_departure_at: string | null;
  arrival_method: ArrivalMethod;
  arrival_bus_run_code: string | null;
  departure_vector: string | null;
  departure_bus_run_code: string | null;
  checked_in_at: string | null;
  checked_in_by: string | null;
  checked_out_at: string | null;
  checked_out_by: string | null;
  status: SupportAttendanceRow["status"];
  notes: string | null;
  escalation_issue_id?: string | null;
  escalation_severity?: EscalationSeverity | null;
}

function mapTransportToMethod(transportRule: string | null): ArrivalMethod {
  const v = (transportRule ?? "").trim().toLowerCase();
  if (!v) return "other";
  if (v.includes("bus") || v.includes("pickup") || v.includes("run") || /^r\d+\b/.test(v)) {
    return "bus";
  }
  if (v.includes("private") || v.includes("self") || v.includes("family")) return "private";
  if (v.includes("walk")) return "walk_in";
  return "other";
}

async function resolveSupportNames(): Promise<{
  staff: Map<string, string>;
  carer: Map<string, string>;
}> {
  const [{ data: staffRows }, { data: carerRows }] = await Promise.all([
    supabase.from("staff_registry").select("id, full_name"),
    supabase.from("carers_registry").select("id, full_name"),
  ]);
  const staff = new Map<string, string>();
  for (const r of staffRows ?? []) {
    const row = r as { id: string; full_name: string };
    staff.set(row.id, row.full_name);
  }
  const carer = new Map<string, string>();
  for (const r of carerRows ?? []) {
    const row = r as { id: string; full_name: string };
    carer.set(row.id, row.full_name);
  }
  return { staff, carer };
}

function displayNameFor(
  kind: SupportPersonKind,
  staffId: string | null,
  carerId: string | null,
  names: { staff: Map<string, string>; carer: Map<string, string> },
): string {
  if (kind === "carer") return names.carer.get(carerId ?? "") ?? "Carer";
  return names.staff.get(staffId ?? "") ?? (kind === "volunteer" ? "Volunteer" : "Staff");
}

function toSchedule(
  r: ScheduleDb,
  names: { staff: Map<string, string>; carer: Map<string, string> },
): SupportSchedule {
  return {
    id: r.id,
    personKind: r.person_kind,
    staffId: r.staff_id,
    carerId: r.carer_id,
    linkedParticipantId: r.linked_participant_id,
    dayOfWeek: r.day_of_week,
    inboundTransport: r.inbound_transport,
    outboundTransport: r.outbound_transport,
    expectedArrivalTime: (r.expected_arrival_time ?? "09:00").slice(0, 5),
    expectedDepartureTime: (r.expected_departure_time ?? "15:00").slice(0, 5),
    pickupAddressOverride: r.pickup_address_override,
    active: r.active,
    displayName: displayNameFor(r.person_kind, r.staff_id, r.carer_id, names),
  };
}

function toLog(
  r: LogDb,
  names: { staff: Map<string, string>; carer: Map<string, string> },
): SupportAttendanceRow {
  const vector =
    r.departure_vector === "bus" ||
    r.departure_vector === "family" ||
    r.departure_vector === "independent"
      ? r.departure_vector
      : null;
  return {
    id: r.id,
    sessionId: r.session_id,
    personKind: r.person_kind,
    staffId: r.staff_id,
    carerId: r.carer_id,
    linkedParticipantId: r.linked_participant_id,
    displayName: displayNameFor(r.person_kind, r.staff_id, r.carer_id, names),
    expectedArrivalAt: r.expected_arrival_at,
    expectedDepartureAt: r.expected_departure_at,
    arrivalMethod: r.arrival_method,
    arrivalBusRunCode: r.arrival_bus_run_code,
    departureVector: vector,
    departureBusRunCode: r.departure_bus_run_code,
    checkedInAt: r.checked_in_at,
    checkedInBy: r.checked_in_by,
    checkedOutAt: r.checked_out_at,
    checkedOutBy: r.checked_out_by,
    status: r.status,
    notes: r.notes,
    escalationIssueId: r.escalation_issue_id ?? null,
    escalationSeverity: r.escalation_severity ?? null,
  };
}

export const SUPPORT_SCHEDULES_KEY = ["support-attendance-schedules"] as const;

export async function listSupportSchedulesForPerson(input: {
  staffId?: string | null;
  carerId?: string | null;
}): Promise<SupportSchedule[]> {
  const all = await listSupportSchedules();
  if (input.carerId) return all.filter((s) => s.carerId === input.carerId);
  if (input.staffId) return all.filter((s) => s.staffId === input.staffId);
  return [];
}

export async function listSupportSchedules(): Promise<SupportSchedule[]> {
  const { data, error } = await supabase
    .from("support_attendance_schedules")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: true });
  if (error) {
    if (isSchemaMismatchError(error)) return [];
    throw new Error(error.message);
  }
  const names = await resolveSupportNames();
  return (data ?? []).map((r) => toSchedule(r as ScheduleDb, names));
}

export async function upsertSupportSchedule(input: {
  id?: string;
  personKind: SupportPersonKind;
  staffId?: string | null;
  carerId?: string | null;
  linkedParticipantId?: string | null;
  dayOfWeek: string;
  inboundTransport: string | null;
  outboundTransport: string | null;
  expectedArrivalTime: string;
  expectedDepartureTime: string;
  pickupAddressOverride?: string | null;
}): Promise<SupportSchedule> {
  const row = {
    person_kind: input.personKind,
    staff_id: input.personKind === "carer" ? null : input.staffId ?? null,
    carer_id: input.personKind === "carer" ? input.carerId ?? null : null,
    linked_participant_id: input.linkedParticipantId ?? null,
    day_of_week: input.dayOfWeek,
    inbound_transport: input.inboundTransport,
    outbound_transport: input.outboundTransport,
    expected_arrival_time: input.expectedArrivalTime.length === 5
      ? `${input.expectedArrivalTime}:00`
      : input.expectedArrivalTime,
    expected_departure_time: input.expectedDepartureTime.length === 5
      ? `${input.expectedDepartureTime}:00`
      : input.expectedDepartureTime,
    pickup_address_override: (input.pickupAddressOverride ?? "").trim() || null,
    active: true,
  };
  const q = input.id
    ? supabase.from("support_attendance_schedules").update(row).eq("id", input.id)
    : supabase.from("support_attendance_schedules").insert(row);
  const { data, error } = await q.select("*").single();
  if (error) throw new Error(error.message);
  const names = await resolveSupportNames();
  return toSchedule(data as ScheduleDb, names);
}

export async function deactivateSupportSchedule(id: string): Promise<void> {
  const { error } = await supabase
    .from("support_attendance_schedules")
    .update({ active: false })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function loadExemptSupportKeysForDate(dateIso: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("support_roster_logs")
    .select("person_kind, staff_id, carer_id, actual_status")
    .eq("roster_date", dateIso);
  if (error) {
    if (isSchemaMismatchError(error)) return new Set();
    return new Set();
  }
  const out = new Set<string>();
  for (const raw of data ?? []) {
    const row = raw as {
      person_kind: SupportPersonKind;
      staff_id: string | null;
      carer_id: string | null;
      actual_status: string;
    };
    if (!row.actual_status || row.actual_status === "Attended") continue;
    if (row.staff_id) out.add(supportPersonKey(row.person_kind, row.staff_id));
    if (row.carer_id) out.add(supportPersonKey("carer", row.carer_id));
  }
  return out;
}

export async function applySupportDayExemption(input: {
  personKind: SupportPersonKind;
  staffId?: string | null;
  carerId?: string | null;
  dateIso?: string;
  notes?: string | null;
  displayName?: string;
  runCodes?: string[];
}): Promise<OfficeRunExemptionResult> {
  const dateIso = input.dateIso ?? getOperationalTodayIso();
  const operatorId = await resolveStaffIdWithFallback();
  const row = {
    roster_date: dateIso,
    person_kind: input.personKind,
    staff_id: input.personKind === "carer" ? null : input.staffId ?? null,
    carer_id: input.personKind === "carer" ? input.carerId ?? null : null,
    actual_status: "absent",
    notes: input.notes ?? null,
    created_by_staff_id: operatorId || null,
  };
  const { error } = await supabase.from("support_roster_logs").upsert(row, {
    onConflict: input.personKind === "carer" ? "roster_date,carer_id" : "roster_date,staff_id",
  });
  if (error) {
    const { error: insErr } = await supabase.from("support_roster_logs").insert(row);
    if (insErr && !isSchemaMismatchError(insErr)) throw new Error(insErr.message);
  }
  return skipActiveTripPickupsForExemption({
    staffId: input.personKind === "carer" ? null : input.staffId,
    carerId: input.personKind === "carer" ? input.carerId : null,
    participantName: input.displayName ?? "Support person",
    rosterDate: dateIso,
    status: "Cancelled",
    notes: input.notes ?? "Off today / absent.",
    runCodes: input.runCodes,
  });
}

export async function clearSupportDayExemption(input: {
  staffId?: string | null;
  carerId?: string | null;
  dateIso?: string;
}): Promise<number> {
  const dateIso = input.dateIso ?? getOperationalTodayIso();
  let q = supabase.from("support_roster_logs").delete().eq("roster_date", dateIso);
  if (input.carerId) q = q.eq("carer_id", input.carerId);
  else if (input.staffId) q = q.eq("staff_id", input.staffId);
  else return 0;
  const { data, error } = await q.select("id");
  if (error) {
    if (isSchemaMismatchError(error)) return 0;
    throw new Error(error.message);
  }
  return data?.length ?? 0;
}

export async function listSupportAttendanceRoll(
  sessionId: string,
): Promise<SupportAttendanceRow[]> {
  const { data, error } = await supabase
    .from("support_attendance_log")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) {
    if (isSchemaMismatchError(error)) return [];
    throw new Error(error.message);
  }
  const names = await resolveSupportNames();
  return (data ?? []).map((r) => toLog(r as LogDb, names));
}

export async function seedSupportRollFromSchedules(sessionId: string): Promise<number> {
  const dow = getSydneyDayIndex();
  let masterOpen: string | null = null;
  let masterClose: string | null = null;
  try {
    const today = await getTodayCentreHours(dow);
    if (today) {
      masterOpen = today.openTime || null;
      masterClose = today.closeTime || null;
    }
  } catch {
    /* fall through */
  }

  const { data: scheds, error } = await supabase
    .from("support_attendance_schedules")
    .select("*")
    .eq("active", true);
  if (error) {
    if (isSchemaMismatchError(error)) return 0;
    throw new Error(error.message);
  }

  const todays = (scheds ?? []).filter(
    (s) => WEEKDAY_INDEX[String((s as ScheduleDb).day_of_week)] === dow,
  ) as ScheduleDb[];
  const exempt = await loadExemptSupportKeysForDate(getOperationalTodayIso());
  const attending = todays.filter((s) => {
    const key = s.carer_id
      ? supportPersonKey("carer", s.carer_id)
      : supportPersonKey(s.person_kind, s.staff_id ?? "");
    return !exempt.has(key);
  });
  if (!attending.length) return 0;

  const payload = attending.map((s) => {
    const arrival = sydneyTimeTodayFromClock(
      (s.expected_arrival_time ?? masterOpen ?? "09:00").slice(0, 5),
    );
    const departure = sydneyTimeTodayFromClock(
      (s.expected_departure_time ?? masterClose ?? "15:00").slice(0, 5),
    );
    const inbound = s.inbound_transport;
    return {
      session_id: sessionId,
      person_kind: s.person_kind,
      staff_id: s.staff_id,
      carer_id: s.carer_id,
      linked_participant_id: s.linked_participant_id,
      expected_arrival_at: arrival,
      expected_departure_at: departure,
      arrival_method: mapTransportToMethod(inbound),
      arrival_bus_run_code: mapTransportToMethod(inbound) === "bus" ? inbound : null,
      status: "expected" as const,
    };
  });

  const { error: upsertErr } = await supabase
    .from("support_attendance_log")
    .upsert(payload, { onConflict: "session_id,staff_id", ignoreDuplicates: true });
  if (upsertErr && !isSchemaMismatchError(upsertErr)) {
    const { error: insErr } = await supabase.from("support_attendance_log").insert(payload);
    if (insErr && insErr.code !== "23505" && !isSchemaMismatchError(insErr)) {
      throw new Error(insErr.message);
    }
  }
  return payload.length;
}

export async function recordSupportArrival(input: {
  rowId: string;
  arrivalMethod: ArrivalMethod;
  arrivalBusRunCode?: string | null;
}): Promise<SupportAttendanceRow> {
  const staffId = await resolveStaffIdWithFallback();
  const now = operationalNowIso();
  const { data: existing } = await supabase
    .from("support_attendance_log")
    .select("status, staff_id, carer_id")
    .eq("id", input.rowId)
    .maybeSingle();
  const prior = existing as { status?: string; staff_id?: string | null; carer_id?: string | null } | null;
  if (prior?.status === "absent") {
    await clearSupportDayExemption({
      staffId: prior.staff_id,
      carerId: prior.carer_id,
    });
  }
  const { data, error } = await supabase
    .from("support_attendance_log")
    .update({
      status: "checked_in",
      arrival_method: input.arrivalMethod,
      arrival_bus_run_code:
        input.arrivalMethod === "bus" ? input.arrivalBusRunCode ?? null : null,
      checked_in_at: now,
      checked_in_by: staffId || null,
      escalation_issue_id: null,
      escalation_severity: null,
      updated_at: now,
    })
    .eq("id", input.rowId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "GREEN",
    action_type: "SUPPORT_CHECKIN",
    gps_lat: null,
    gps_lng: null,
    metadata: { row_id: input.rowId, arrival_method: input.arrivalMethod },
  });
  const names = await resolveSupportNames();
  return toLog(data as LogDb, names);
}

export async function checkOutSupport(input: {
  rowId: string;
  departureVector?: DepartureVector | null;
  departureBusRunCode?: string | null;
}): Promise<SupportAttendanceRow> {
  const staffId = await resolveStaffIdWithFallback();
  const now = operationalNowIso();
  const { data, error } = await supabase
    .from("support_attendance_log")
    .update({
      status: "checked_out",
      departure_vector: input.departureVector ?? null,
      departure_bus_run_code: input.departureBusRunCode ?? null,
      checked_out_at: now,
      checked_out_by: staffId || null,
      updated_at: now,
    })
    .eq("id", input.rowId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "GREEN",
    action_type: "SUPPORT_CHECKOUT",
    gps_lat: null,
    gps_lng: null,
    metadata: { row_id: input.rowId },
  });
  const names = await resolveSupportNames();
  return toLog(data as LogDb, names);
}

export async function persistSupportDepartureMethod(input: {
  rowId: string;
  departureVector: DepartureVector | null;
  departureBusRunCode: string | null;
}): Promise<void> {
  const now = operationalNowIso();
  const { error } = await supabase
    .from("support_attendance_log")
    .update({
      departure_vector: input.departureVector,
      departure_bus_run_code: input.departureBusRunCode,
      updated_at: now,
    })
    .eq("id", input.rowId);
  if (error) throw new Error(error.message);
}

export async function markSupportAbsent(
  row: SupportAttendanceRow,
  opts?: { reasonCode?: string; reasonLabel?: string; detail?: string },
): Promise<SupportAttendanceRow> {
  const staffId = await resolveStaffIdWithFallback();
  const now = operationalNowIso();
  const reasonCode = (opts?.reasonCode ?? "OTHER").trim().toUpperCase();
  const reasonLabel = opts?.reasonLabel ?? "Absent";
  const detail = (opts?.detail ?? "").trim();
  const notes =
    `[FLOOR ABSENT:${reasonCode}] ${reasonLabel}` +
    (detail ? ` — ${detail}` : "") +
    " (PIN verified).";
  const { data, error } = await supabase
    .from("support_attendance_log")
    .update({
      status: "absent",
      notes,
      escalation_issue_id: null,
      escalation_severity: null,
      updated_at: now,
    })
    .eq("id", row.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  const runCodes = [row.arrivalBusRunCode, row.departureBusRunCode]
    .map((c) => (c ?? "").trim())
    .filter(Boolean);
  await applySupportDayExemption({
    personKind: row.personKind,
    staffId: row.staffId,
    carerId: row.carerId,
    notes,
    displayName: row.displayName,
    runCodes: runCodes.length > 0 ? runCodes : undefined,
  });
  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "GREEN",
    action_type: "SUPPORT_ABSENT",
    gps_lat: null,
    gps_lng: null,
    metadata: { row_id: row.id, reason: reasonCode },
  });
  const names = await resolveSupportNames();
  return toLog(data as LogDb, names);
}

export async function updateSupportExpectedArrival(
  row: SupportAttendanceRow,
  hhmm: string,
  yellowThresholdMins: number,
): Promise<SupportAttendanceRow> {
  const staffId = await resolveStaffIdWithFallback();
  const newIso = sydneyTimeTodayFromClock(hhmm);
  const { data, error } = await supabase
    .from("support_attendance_log")
    .update({ expected_arrival_at: newIso, updated_at: operationalNowIso() })
    .eq("id", row.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "INFO",
    action_type: "SUPPORT_EXPECTED_TIME_ADJUSTED",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      attendance_id: row.id,
      previous_expected_at: row.expectedArrivalAt,
      new_expected_at: newIso,
    },
  });
  const overdueMins = Math.floor((operationalNowMs() - Date.parse(newIso)) / 60_000);
  if (overdueMins < yellowThresholdMins && row.escalationIssueId && row.escalationSeverity === "yellow") {
    await supabase
      .from("site_issues_register")
      .update({ status: "resolved", resolved_at: operationalNowIso() })
      .eq("id", row.escalationIssueId)
      .eq("status", "open")
      .eq("severity", "yellow");
    await supabase
      .from("support_attendance_log")
      .update({ escalation_issue_id: null, escalation_severity: null })
      .eq("id", row.id);
  }
  const names = await resolveSupportNames();
  return toLog(data as LogDb, names);
}

export async function bulkDeferSupportGroup(
  sessionId: string,
  method: ArrivalMethod,
  minutes: number,
  yellowThresholdMins: number,
): Promise<{ deferredCount: number }> {
  if (!Number.isFinite(minutes) || minutes === 0) return { deferredCount: 0 };
  const roll = await listSupportAttendanceRoll(sessionId);
  const targets = roll.filter(
    (r) =>
      r.arrivalMethod === method &&
      r.status !== "checked_in" &&
      r.status !== "checked_out" &&
      r.status !== "absent",
  );
  for (const r of targets) {
    if (!r.expectedArrivalAt) continue;
    const next = new Date(Date.parse(r.expectedArrivalAt) + minutes * 60_000).toISOString();
    await supabase
      .from("support_attendance_log")
      .update({ expected_arrival_at: next, updated_at: operationalNowIso() })
      .eq("id", r.id);
    const overdueMins = Math.floor((operationalNowMs() - Date.parse(next)) / 60_000);
    if (overdueMins < yellowThresholdMins && r.escalationIssueId && r.escalationSeverity === "yellow") {
      await supabase
        .from("site_issues_register")
        .update({ status: "resolved", resolved_at: operationalNowIso() })
        .eq("id", r.escalationIssueId)
        .eq("status", "open")
        .eq("severity", "yellow");
      await supabase
        .from("support_attendance_log")
        .update({ escalation_issue_id: null, escalation_severity: null })
        .eq("id", r.id);
    }
  }
  return { deferredCount: targets.length };
}

export async function sweepOverdueSupportArrivals(
  sessionId: string,
  yellowMins: number,
  redMins: number,
): Promise<{ yellowRaised: number; redRaised: number }> {
  const roll = await listSupportAttendanceRoll(sessionId);
  const now = operationalNowMs();
  let yellowRaised = 0;
  let redRaised = 0;
  for (const r of roll) {
    if (r.status === "checked_in" || r.status === "checked_out" || r.status === "absent") continue;
    if (!r.expectedArrivalAt) continue;
    const expected = Date.parse(r.expectedArrivalAt);
    if (!Number.isFinite(expected)) continue;
    const overdueMins = Math.floor((now - expected) / 60_000);
    if (overdueMins < yellowMins) continue;
    const wantRed = overdueMins >= redMins;
    const pName = r.displayName;
    if (!r.escalationIssueId) {
      const insertSeverity: EscalationSeverity = wantRed ? "red" : "yellow";
      const staffId = await resolveStaffIdWithFallback();
      if (wantRed) {
        try {
          await writeToLedgerOrThrow({
            staff_id: staffId,
            category: "CENTRE",
            severity: "RED",
            action_type: "SUPPORT_ATTENDANCE_RED_ESCALATED",
            gps_lat: null,
            gps_lng: null,
            metadata: { attendance_id: r.id, overdue_mins: overdueMins, automated: true },
          });
        } catch {
          continue;
        }
      } else {
        await writeToLedger({
          staff_id: staffId,
          category: "CENTRE",
          severity: "YELLOW",
          action_type: "SUPPORT_ATTENDANCE_YELLOW_RAISED",
          gps_lat: null,
          gps_lng: null,
          metadata: { attendance_id: r.id, overdue_mins: overdueMins, automated: true },
        });
      }
      const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
      const { data: issue, error: issueErr } = await supabase
        .from("site_issues_register")
        .insert({
          session_id: sessionId,
          reported_by: userId,
          severity: insertSeverity,
          issue_description: `${wantRed ? "[AUTOMATED_RED]" : "[ATTENDANCE]"} ${pName} (support) overdue by ${overdueMins} min.`,
          workaround_plan: null,
          owner: "internal",
          status: "open",
          update_log: "",
        })
        .select("id")
        .single();
      if (issueErr || !issue) continue;
      await supabase
        .from("support_attendance_log")
        .update({
          escalation_issue_id: issue.id as string,
          escalation_severity: insertSeverity,
          escalation_raised_at: operationalNowIso(),
        })
        .eq("id", r.id);
      if (wantRed) redRaised += 1;
      else yellowRaised += 1;
      continue;
    }
    if (wantRed && r.escalationSeverity !== "red") {
      const staffId = await resolveStaffIdWithFallback();
      try {
        await writeToLedgerOrThrow({
          staff_id: staffId,
          category: "CENTRE",
          severity: "RED",
          action_type: "SUPPORT_ATTENDANCE_RED_ESCALATED",
          gps_lat: null,
          gps_lng: null,
          metadata: { attendance_id: r.id, overdue_mins: overdueMins, automated: true },
        });
      } catch {
        continue;
      }
      await supabase
        .from("site_issues_register")
        .update({ severity: "red" })
        .eq("id", r.escalationIssueId);
      await supabase
        .from("support_attendance_log")
        .update({ escalation_severity: "red" })
        .eq("id", r.id);
      redRaised += 1;
    }
  }
  return { yellowRaised, redRaised };
}

export async function reinstateSupportArrival(input: {
  rowId: string;
  arrivalMethod: ArrivalMethod;
  arrivalBusRunCode?: string | null;
}): Promise<SupportAttendanceRow> {
  return recordSupportArrival(input);
}

export type SupportFloorHome = {
  key: string;
  status: string;
  departureVector: DepartureVector | null;
  departureBusRunCode: string | null;
};

export async function loadSupportFloorHomeForDate(
  dateIso: string,
): Promise<Map<string, SupportFloorHome>> {
  const out = new Map<string, SupportFloorHome>();
  const { data: session, error: sessErr } = await supabase
    .from("site_day_sessions")
    .select("id")
    .eq("session_date", dateIso)
    .maybeSingle();
  if (sessErr || !session) return out;
  const { data, error } = await supabase
    .from("support_attendance_log")
    .select("person_kind, staff_id, carer_id, status, departure_vector, departure_bus_run_code")
    .eq("session_id", (session as { id: string }).id);
  if (error) {
    if (isSchemaMismatchError(error)) return out;
    return out;
  }
  for (const raw of data ?? []) {
    const row = raw as {
      person_kind: SupportPersonKind;
      staff_id: string | null;
      carer_id: string | null;
      status: string;
      departure_vector?: string | null;
      departure_bus_run_code?: string | null;
    };
    const key = row.carer_id
      ? supportPersonKey("carer", row.carer_id)
      : supportPersonKey(row.person_kind, row.staff_id ?? "");
    const vector =
      row.departure_vector === "bus" ||
      row.departure_vector === "family" ||
      row.departure_vector === "independent"
        ? row.departure_vector
        : null;
    out.set(key, {
      key,
      status: row.status,
      departureVector: vector,
      departureBusRunCode: (row.departure_bus_run_code ?? "").trim() || null,
    });
  }
  return out;
}

async function supportAddressFor(s: ScheduleDb): Promise<string | null> {
  const override = (s.pickup_address_override ?? "").trim();
  if (override) return override;
  if (s.staff_id) {
    const { data } = await supabase
      .from("staff_registry")
      .select("street_address")
      .eq("id", s.staff_id)
      .maybeSingle();
    return ((data as { street_address?: string | null } | null)?.street_address ?? "").trim() || null;
  }
  if (s.carer_id) {
    const { data } = await supabase
      .from("carers_registry")
      .select("street_address")
      .eq("id", s.carer_id)
      .maybeSingle();
    return ((data as { street_address?: string | null } | null)?.street_address ?? "").trim() || null;
  }
  return null;
}

export async function listSupportRosterForDayCentreRun(input: {
  busRunCode: string;
  dayCode: string;
  direction: "morning" | "afternoon";
}): Promise<TransportRosterPerson[]> {
  const transportCol = input.direction === "morning" ? "inbound_transport" : "outbound_transport";
  const { data, error } = await supabase
    .from("support_attendance_schedules")
    .select("*")
    .eq("active", true)
    .eq("day_of_week", input.dayCode)
    .eq(transportCol, input.busRunCode);
  if (error) {
    if (isSchemaMismatchError(error)) return [];
    throw new Error(error.message);
  }
  const names = await resolveSupportNames();
  const exempt = await loadExemptSupportKeysForDate(getOperationalTodayIso());
  const out: TransportRosterPerson[] = [];
  for (const raw of data ?? []) {
    const s = raw as ScheduleDb;
    const key = s.carer_id
      ? supportPersonKey("carer", s.carer_id)
      : supportPersonKey(s.person_kind, s.staff_id ?? "");
    if (exempt.has(key)) continue;
    const address = await supportAddressFor(s);
    out.push(
      supportRosterPerson({
        kind: s.person_kind,
        staffId: s.staff_id,
        carerId: s.carer_id,
        name: displayNameFor(s.person_kind, s.staff_id, s.carer_id, names),
        address,
      }),
    );
  }
  return out;
}

export async function applyAfternoonSupportHomeTransport(
  roster: TransportRosterPerson[],
  busRunCode: string,
  dateIso: string,
): Promise<TransportRosterPerson[]> {
  const floor = await loadSupportFloorHomeForDate(dateIso);
  if (floor.size === 0) return roster;
  const byId = new Map(roster.map((r) => [r.id, r]));
  for (const [key, f] of floor) {
    if (f.status === "absent" || f.status === "checked_out") {
      byId.delete(key);
      continue;
    }
    if (f.departureVector === "family" || f.departureVector === "independent") {
      byId.delete(key);
      continue;
    }
    if (f.departureVector === "bus" && f.departureBusRunCode) {
      if (f.departureBusRunCode !== busRunCode) byId.delete(key);
    }
  }
  return [...byId.values()];
}

export function workforceKindFromStaff(personnelType: string | null, role: string | null): SupportPersonKind {
  return classifyWorkforceKind(personnelType, role);
}
