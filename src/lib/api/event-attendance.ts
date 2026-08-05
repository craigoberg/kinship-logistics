/**
 * event_attendance_log — event-floor arrival/departure roll (§12.4.2 / Phase 8)
 *
 * Mirrors client_attendance_log for the temporary centre at the venue.
 * Seeded from event_roster_bookings when trip leader opens location.
 */
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { listParticipants, resolveStaffIdWithFallback } from "@/lib/data-store";
import { writeToLedger, tryGetGps } from "@/lib/api/ledger";
import {
  encodeLeftTripNotes,
  leftTripHubDescription,
  type LeftTripDisposition,
} from "@/lib/trip-absent";
import { operationalNowIso } from "@/lib/operational-clock";

export type EventArrivalMethod = "bus" | "private" | "walk_in" | "other";
export type EventAttendanceStatus = "expected" | "checked_in" | "checked_out" | "absent";
export type ReturnTransport = "bus" | "self";

export interface EventAttendanceRow {
  id: string;
  eventDaySessionId: string;
  participantId: string;
  expectedArrivalAt: string;
  arrivalMethod: EventArrivalMethod;
  checkedInAt: string | null;
  checkedInBy: string | null;
  checkedOutAt: string | null;
  checkedOutBy: string | null;
  status: EventAttendanceStatus;
  returnTransport: ReturnTransport | null;
  notes: string | null;
  /** BL-069 — which bus_runs.code they arrived on (when bus). */
  arrivalBusRunCode: string | null;
  /** BL-069 — which bus_runs.code for return home (when return_transport=bus). */
  returnBusRunCode: string | null;
  participantName?: string | null;
}

interface DbRow {
  id: string;
  event_day_session_id: string;
  participant_id: string;
  expected_arrival_at: string;
  arrival_method: EventArrivalMethod;
  checked_in_at: string | null;
  checked_in_by: string | null;
  checked_out_at: string | null;
  checked_out_by: string | null;
  status: EventAttendanceStatus;
  return_transport: ReturnTransport | null;
  notes: string | null;
  arrival_bus_run_code?: string | null;
  return_bus_run_code?: string | null;
}

function toRow(r: DbRow): EventAttendanceRow {
  return {
    id: r.id,
    eventDaySessionId: r.event_day_session_id,
    participantId: r.participant_id,
    expectedArrivalAt: r.expected_arrival_at,
    arrivalMethod: r.arrival_method,
    checkedInAt: r.checked_in_at,
    checkedInBy: r.checked_in_by,
    checkedOutAt: r.checked_out_at,
    checkedOutBy: r.checked_out_by,
    status: r.status,
    returnTransport: r.return_transport,
    notes: r.notes,
    arrivalBusRunCode: r.arrival_bus_run_code ?? null,
    returnBusRunCode: r.return_bus_run_code ?? null,
  };
}

function mapTransportMode(mode: string | null): EventArrivalMethod {
  if (mode === "self") return "private";
  if (mode === "bus") return "bus";
  return "other";
}

/** Default expected arrival: session date 09:00 Sydney (+10). */
function defaultExpectedArrival(sessionDate: string): string {
  return `${sessionDate}T09:00:00+10:00`;
}

export async function listEventAttendanceRoll(
  eventDaySessionId: string,
): Promise<EventAttendanceRow[]> {
  const { data, error } = await supabase
    .from("event_attendance_log")
    .select("*")
    .eq("event_day_session_id", eventDaySessionId)
    .order("expected_arrival_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => toRow(r as DbRow));
}

/** Seed from confirmed event roster bookings. Idempotent upsert. */
export async function seedEventAttendanceRoll(
  eventDaySessionId: string,
  eventId: string,
  sessionDate: string,
): Promise<number> {
  const withModes =
    "participant_id, outbound_transport_mode, return_transport_mode, outbound_bus_run_code, return_bus_run_code";
  let result = await supabase
    .from("event_roster_bookings")
    .select(withModes)
    .eq("event_id", eventId)
    .neq("booking_status", "Cancelled");

  if (result.error && isSchemaMismatchError(result.error)) {
    result = await supabase
      .from("event_roster_bookings")
      .select("participant_id, outbound_transport_mode, return_transport_mode")
      .eq("event_id", eventId)
      .neq("booking_status", "Cancelled");
  }
  if (result.error && isSchemaMismatchError(result.error)) {
    result = await supabase
      .from("event_roster_bookings")
      .select("participant_id")
      .eq("event_id", eventId)
      .neq("booking_status", "Cancelled");
  }
  if (result.error) throw result.error;

  const bookings = result.data ?? [];

  const expectedAt = defaultExpectedArrival(sessionDate);
  const payload = (bookings ?? []).map((b) => {
    const row = b as {
      participant_id: string;
      outbound_transport_mode?: string | null;
      return_transport_mode?: string | null;
      outbound_bus_run_code?: string | null;
      return_bus_run_code?: string | null;
    };
    const outboundMode = row.outbound_transport_mode ?? "bus";
    const returnMode = (row.return_transport_mode ?? "bus") as ReturnTransport;
    return {
      event_day_session_id: eventDaySessionId,
      participant_id: row.participant_id,
      expected_arrival_at: expectedAt,
      arrival_method: mapTransportMode(outboundMode),
      status: "expected",
      return_transport: returnMode,
      arrival_bus_run_code:
        outboundMode === "bus" ? row.outbound_bus_run_code?.trim() || null : null,
      return_bus_run_code:
        returnMode === "bus" ? row.return_bus_run_code?.trim() || null : null,
    };
  });

  if (payload.length === 0) return 0;

  const isMissingOnConflictTarget = (err: {
    code?: string;
    message?: string;
  }) =>
    err.code === "42P10" ||
    /no unique|exclusion constraint matching the ON CONFLICT/i.test(
      err.message ?? "",
    );

  let { data: inserted, error: insErr } = await supabase
    .from("event_attendance_log")
    .upsert(payload, {
      onConflict: "event_day_session_id,participant_id",
      ignoreDuplicates: true,
    })
    .select("id");

  if (insErr && isSchemaMismatchError(insErr)) {
    const legacy = payload.map((row) => {
      const {
        arrival_bus_run_code: _a,
        return_bus_run_code: _r,
        ...rest
      } = row;
      return rest;
    });
    const retry = await supabase
      .from("event_attendance_log")
      .upsert(legacy, {
        onConflict: "event_day_session_id,participant_id",
        ignoreDuplicates: true,
      })
      .select("id");
    inserted = retry.data;
    insErr = retry.error;
  }

  // TEST bootstrap may lack UNIQUE — insert only people not already on the roll
  if (insErr && isMissingOnConflictTarget(insErr)) {
    const existing = await listEventAttendanceRoll(eventDaySessionId);
    const have = new Set(existing.map((r) => r.participantId));
    const missing = payload.filter((r) => !have.has(r.participant_id));
    if (missing.length === 0) return 0;
    const { data: plain, error: plainErr } = await supabase
      .from("event_attendance_log")
      .insert(missing)
      .select("id");
    if (plainErr && isSchemaMismatchError(plainErr)) {
      const legacy = missing.map((row) => {
        const {
          arrival_bus_run_code: _a,
          return_bus_run_code: _r,
          ...rest
        } = row;
        return rest;
      });
      const retry = await supabase
        .from("event_attendance_log")
        .insert(legacy)
        .select("id");
      if (retry.error) throw retry.error;
      return retry.data?.length ?? 0;
    }
    if (plainErr) throw plainErr;
    return plain?.length ?? 0;
  }

  if (insErr) throw insErr;
  return inserted?.length ?? 0;
}

/**
 * Add any roster bookings missing from open (non-closed) day rolls.
 * Idempotent — uses seed upsert with ignoreDuplicates.
 * Call after late Add guest / roster changes while location is already open.
 */
export async function syncEventAttendanceFromRoster(
  eventId: string,
): Promise<number> {
  const { listEventDaySessions } = await import("@/lib/api/event-outing");
  const { isDaySessionClosed } = await import(
    "@/lib/api/event-lifecycle-gates"
  );
  const sessions = await listEventDaySessions(eventId);
  let added = 0;
  for (const s of sessions) {
    if (isDaySessionClosed(s.phase)) continue;
    added += await seedEventAttendanceRoll(s.id, eventId, s.session_date);
  }
  return added;
}

/** Tap toggle: expected ↔ checked_in (§4.4 fat-finger cards). */
export async function toggleEventCheckIn(
  row: EventAttendanceRow,
): Promise<EventAttendanceRow> {
  const staffId = await resolveStaffIdWithFallback();
  const nowIso = new Date().toISOString();
  const isIn = row.status === "checked_in";
  if (!isIn && row.participantId) {
    const { assertNotInfectiousExcluded } = await import(
      "@/lib/api/infectious-exclusion"
    );
    await assertNotInfectiousExcluded(row.participantId, "trips");
  }
  const patch = isIn
    ? {
        status: "expected" as EventAttendanceStatus,
        checked_in_at: null,
        checked_in_by: null,
      }
    : {
        status: "checked_in" as EventAttendanceStatus,
        checked_in_at: nowIso,
        checked_in_by: staffId,
      };

  const { data, error } = await supabase
    .from("event_attendance_log")
    .update(patch)
    .eq("id", row.id)
    .select("*")
    .single();
  if (error) throw error;

  const gps = await tryGetGps();
  await writeToLedger({
    staff_id: staffId,
    category: "CLIENT",
    severity: "GREEN",
    action_type: isIn ? "EVENT_FLOOR_CHECKIN_UNDO" : "EVENT_FLOOR_CHECKIN",
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    metadata: {
      event_day_session_id: row.eventDaySessionId,
      participant_id: row.participantId,
      attendance_id: row.id,
      arrival_method: isIn ? null : row.arrivalMethod,
      arrival_bus_run_code: isIn ? null : row.arrivalBusRunCode,
    },
  });

  return toRow(data as DbRow);
}

export type EventArrivalChoice = "bus" | "self";

/**
 * BL-013 — Record actual arrival method (bus vs self), optionally checking in.
 * Mirrors Check-Out return assignment: roster seed is planning only.
 */
export async function recordEventArrival(
  row: EventAttendanceRow,
  input: {
    arrival: EventArrivalChoice;
    busRunCode?: string | null;
    notes?: string;
    /** When true (default for expected), also stamp checked_in. */
    alsoCheckIn?: boolean;
  },
): Promise<EventAttendanceRow> {
  if (row.status === "absent") {
    throw new Error("Reinstate the participant before recording arrival.");
  }
  if (row.status === "checked_out") {
    throw new Error("Participant already handed to return transport.");
  }

  const staffId = await resolveStaffIdWithFallback();
  const nowIso = operationalNowIso();
  const isSelf = input.arrival === "self";
  const runCode = isSelf
    ? null
    : (input.busRunCode ?? "").trim() || null;
  const alsoCheckIn = input.alsoCheckIn ?? row.status === "expected";

  if (alsoCheckIn && row.status === "expected" && row.participantId) {
    const { assertNotInfectiousExcluded } = await import(
      "@/lib/api/infectious-exclusion"
    );
    await assertNotInfectiousExcluded(row.participantId, "trips");
  }

  const patch: Record<string, unknown> = {
    arrival_method: (isSelf ? "walk_in" : "bus") as EventArrivalMethod,
    arrival_bus_run_code: runCode,
  };
  if (input.notes && input.notes.trim()) {
    patch.notes = input.notes.trim();
  }
  if (alsoCheckIn && row.status === "expected") {
    patch.status = "checked_in" as EventAttendanceStatus;
    patch.checked_in_at = nowIso;
    patch.checked_in_by = staffId;
  }

  let { data, error } = await supabase
    .from("event_attendance_log")
    .update(patch)
    .eq("id", row.id)
    .select("*")
    .single();
  if (error && isSchemaMismatchError(error)) {
    const { arrival_bus_run_code: _omit, ...legacy } = patch;
    const retry = await supabase
      .from("event_attendance_log")
      .update(legacy)
      .eq("id", row.id)
      .select("*")
      .single();
    data = retry.data;
    error = retry.error;
  }
  if (error) throw error;

  const gps = await tryGetGps();
  const checkedInNow = alsoCheckIn && row.status === "expected";
  await writeToLedger({
    staff_id: staffId,
    category: "CLIENT",
    severity: "GREEN",
    action_type: checkedInNow
      ? "EVENT_FLOOR_CHECKIN"
      : "EVENT_FLOOR_ARRIVAL_METHOD",
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    metadata: {
      event_day_session_id: row.eventDaySessionId,
      participant_id: row.participantId,
      attendance_id: row.id,
      arrival_method: isSelf ? "walk_in" : "bus",
      arrival_bus_run_code: runCode,
      prior_arrival_method: row.arrivalMethod,
    },
  });

  return toRow(data as DbRow);
}

/** Departure handover — assign return transport and check out. */
export async function checkoutEventParticipant(
  row: EventAttendanceRow,
  returnTransport: ReturnTransport,
  returnBusRunCode?: string | null,
): Promise<EventAttendanceRow> {
  if (row.status !== "checked_in") {
    throw new Error("Participant must be checked in before departure handover.");
  }
  const staffId = await resolveStaffIdWithFallback();
  const nowIso = new Date().toISOString();
  const runCode =
    returnTransport === "bus" ? (returnBusRunCode ?? "").trim() || null : null;

  const patch: Record<string, unknown> = {
    status: "checked_out",
    checked_out_at: nowIso,
    checked_out_by: staffId,
    return_transport: returnTransport,
    return_bus_run_code: runCode,
  };

  let { data, error } = await supabase
    .from("event_attendance_log")
    .update(patch)
    .eq("id", row.id)
    .select("*")
    .single();
  if (error && isSchemaMismatchError(error)) {
    const { return_bus_run_code: _omit, ...legacy } = patch;
    const retry = await supabase
      .from("event_attendance_log")
      .update(legacy)
      .eq("id", row.id)
      .select("*")
      .single();
    data = retry.data;
    error = retry.error;
  }
  if (error) throw error;

  const gps = await tryGetGps();
  await writeToLedger({
    staff_id: staffId,
    category: "CLIENT",
    severity: "GREEN",
    action_type: "EVENT_FLOOR_CHECKOUT",
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    metadata: {
      event_day_session_id: row.eventDaySessionId,
      participant_id: row.participantId,
      return_transport: returnTransport,
      return_bus_run_code: runCode,
    },
  });

  return toRow(data as DbRow);
}

/**
 * Floor override: which bus the person arrived on (Check-In / BL-013).
 * Sets arrival_method to bus when a run is chosen (clears walk-in/self).
 */
export async function setEventArrivalBusRun(
  row: EventAttendanceRow,
  arrivalBusRunCode: string | null,
): Promise<EventAttendanceRow> {
  const runCode = (arrivalBusRunCode ?? "").trim() || null;
  const patch: Record<string, unknown> = {
    arrival_bus_run_code: runCode,
    arrival_method: ("bus" as EventArrivalMethod),
  };

  let { data, error } = await supabase
    .from("event_attendance_log")
    .update(patch)
    .eq("id", row.id)
    .select("*")
    .single();
  if (error && isSchemaMismatchError(error)) {
    throw new Error(
      "Arrival bus run columns are not on the database yet. Run docs/sql/2026-07-23_event_multi_bus_runs.sql first.",
    );
  }
  if (error) throw error;

  const staffId = await resolveStaffIdWithFallback();
  const gps = await tryGetGps();
  await writeToLedger({
    staff_id: staffId,
    category: "CLIENT",
    severity: "GREEN",
    action_type: "EVENT_FLOOR_ARRIVAL_BUS_RUN",
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    metadata: {
      event_day_session_id: row.eventDaySessionId,
      participant_id: row.participantId,
      arrival_bus_run_code: runCode,
    },
  });

  return toRow(data as DbRow);
}

/**
 * Fat-finger undo (§4.4): checked_out → checked_in again so return transport
 * can be reassigned. Clears checkout stamps and return_transport.
 */
export async function undoCheckoutEventParticipant(
  row: EventAttendanceRow,
): Promise<EventAttendanceRow> {
  if (row.status !== "checked_out") {
    throw new Error("Only checked-out assignments can be undone.");
  }

  const staffId = await resolveStaffIdWithFallback();
  const { data, error } = await supabase
    .from("event_attendance_log")
    .update({
      status: "checked_in",
      checked_out_at: null,
      checked_out_by: null,
      return_transport: null,
      return_bus_run_code: null,
    })
    .eq("id", row.id)
    .select("*")
    .single();
  if (error) throw error;

  const gps = await tryGetGps();
  await writeToLedger({
    staff_id: staffId,
    category: "CLIENT",
    severity: "GREEN",
    action_type: "EVENT_FLOOR_CHECKOUT_UNDO",
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    metadata: {
      event_day_session_id: row.eventDaySessionId,
      participant_id: row.participantId,
      prior_return_transport: row.returnTransport,
    },
  });

  return toRow(data as DbRow);
}

// ─── Walk-in ──────────────────────────────────────────────────────────────────

/**
 * Mark self / meeting-at-venue arrival (BL-013).
 * Clears arrival bus run. Checks in when still expected.
 */
export async function markEventWalkIn(
  row: EventAttendanceRow,
  notes?: string,
): Promise<EventAttendanceRow> {
  return recordEventArrival(row, {
    arrival: "self",
    notes,
    alsoCheckIn: row.status === "expected",
  });
}

// ─── Absent (left trip / not attending — BL-090) ─────────────────────────────

export interface MarkAbsentParams {
  row: EventAttendanceRow;
  disposition: LeftTripDisposition;
  safetyPlan: string;
  severity: "yellow" | "red";
  eventId: string;
  joiningDay2?: boolean;
  participantName: string;
}

/**
 * Mark a participant absent for this session day (Check-In Not Attending / left trip).
 * Sets status="absent", encodes disposition + safety plan, opens Hub [LEFT TRIP] issue.
 * Hub issue creation is NON-FATAL — the attendance update is the source of truth.
 * Requires leader PIN before calling (caller is responsible).
 */
export async function markEventAttendanceAbsent({
  row,
  disposition,
  safetyPlan,
  severity,
  eventId,
  joiningDay2 = false,
  participantName,
}: MarkAbsentParams): Promise<{ hubIssueCreated: boolean }> {
  const staffId = await resolveStaffIdWithFallback();
  const plan = safetyPlan.trim();
  if (plan.length < 20) {
    throw new Error("Reason / safety plan must be at least 20 characters.");
  }
  const notes = encodeLeftTripNotes({ disposition, safetyPlan: plan, joiningDay2 });

  const { error: updateErr } = await supabase
    .from("event_attendance_log")
    .update({ status: "absent" as EventAttendanceStatus, notes })
    .eq("id", row.id);
  if (updateErr) throw updateErr;

  await excludeFromOpenActivityAndBus(row.eventDaySessionId, row.participantId);

  const issueDescription = leftTripHubDescription(participantName, disposition, plan);
  const { error: issueErr } = await supabase.from("site_issues_register").insert({
    session_id: null,
    event_id: eventId,
    event_day_session_id: row.eventDaySessionId,
    reported_by: staffId,
    severity,
    issue_description: issueDescription,
    workaround_plan: plan,
    owner: "internal",
    status: "open",
    update_log: "",
  });
  if (issueErr) {
    console.warn("[markEventAttendanceAbsent] Hub issue creation failed (non-fatal):", issueErr.message);
  }

  const gps = await tryGetGps();
  await writeToLedger({
    staff_id: staffId,
    category: "CLIENT",
    severity: severity === "red" ? "RED" : "YELLOW",
    action_type: "EVENT_FLOOR_ABSENT",
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    metadata: {
      event_day_session_id: row.eventDaySessionId,
      participant_id: row.participantId,
      disposition,
      safety_plan: plan,
      severity,
      joining_day2: joiningDay2,
    },
  });

  return { hubIssueCreated: !issueErr };
}

export interface ReinstateFromAbsentOpts {
  /** Short reinstate reason (min 10). Stored on attendance notes. */
  reason: string;
  /**
   * Check-In Not Attending → expected (still need to arrive).
   * Left-trip after they were with the group → checked_in.
   */
  toStatus?: "expected" | "checked_in";
  /** Used to resolve only this person's Hub [LEFT TRIP] row. */
  participantName?: string;
}

/**
 * Reinstate a participant from absent.
 * Clears open [LEFT TRIP] / legacy [TRIP ABSENT] Hub issues for this person (non-fatal).
 */
export async function reinstateFromAbsent(
  row: EventAttendanceRow,
  opts: ReinstateFromAbsentOpts,
): Promise<void> {
  const staffId = await resolveStaffIdWithFallback();
  const reason = opts.reason.trim();
  if (reason.length < 10) {
    throw new Error("Reinstate reason must be at least 10 characters.");
  }
  const toStatus = opts.toStatus ?? "expected";
  const nowIso = operationalNowIso();

  const patch: Record<string, unknown> = {
    status: toStatus as EventAttendanceStatus,
    notes: `[REINSTATED] ${reason}`,
  };
  if (toStatus === "checked_in") {
    patch.checked_in_at = row.checkedInAt ?? nowIso;
    patch.checked_in_by = row.checkedInBy ?? staffId;
    patch.checked_out_at = null;
    patch.checked_out_by = null;
    patch.return_transport = null;
  }

  const { error: updateErr } = await supabase
    .from("event_attendance_log")
    .update(patch)
    .eq("id", row.id);
  if (updateErr) throw updateErr;

  const { data: openIssues } = await supabase
    .from("site_issues_register")
    .select("id, issue_description")
    .eq("event_day_session_id", row.eventDaySessionId)
    .eq("status", "open");
  const nameHint = (opts.participantName ?? "").trim();
  for (const issue of openIssues ?? []) {
    const desc = String((issue as { issue_description?: string }).issue_description ?? "");
    const isLeftTrip =
      desc.startsWith("[LEFT TRIP]") || desc.startsWith("[TRIP ABSENT]");
    if (!isLeftTrip) continue;
    if (nameHint && !desc.includes(nameHint)) continue;
    const { error: resolveErr } = await supabase
      .from("site_issues_register")
      .update({ status: "resolved", resolved_at: nowIso })
      .eq("id", (issue as { id: string }).id);
    if (resolveErr) {
      console.warn("[reinstateFromAbsent] Could not auto-resolve Hub issue (non-fatal):", resolveErr.message);
    }
  }

  const gps = await tryGetGps();
  await writeToLedger({
    staff_id: staffId,
    category: "CLIENT",
    severity: "GREEN",
    action_type: "EVENT_FLOOR_REINSTATE",
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    metadata: {
      event_day_session_id: row.eventDaySessionId,
      participant_id: row.participantId,
      attendance_id: row.id,
      to_status: toStatus,
      reason,
    },
  });
}

/**
 * Sync floor attendance to absent when morning/evening left-trip marks someone
 * (without creating a second Hub issue — caller owns Hub).
 */
export async function syncFloorAttendanceLeftTrip(opts: {
  eventDaySessionId: string;
  participantId: string;
  notes: string;
}): Promise<void> {
  const { error } = await supabase
    .from("event_attendance_log")
    .update({ status: "absent" as EventAttendanceStatus, notes: opts.notes })
    .eq("event_day_session_id", opts.eventDaySessionId)
    .eq("participant_id", opts.participantId)
    .in("status", ["expected", "checked_in"]);
  if (error) {
    console.warn("[syncFloorAttendanceLeftTrip] floor sync failed (non-fatal):", error.message);
  }

  await excludeFromOpenActivityAndBus(opts.eventDaySessionId, opts.participantId);
}

/**
 * BL-084 A.1 — release from trip care for infectious exclusion (home-safe).
 * Marks floor absent + clears activity/bus assignment. Does NOT open a second
 * Hub [LEFT TRIP] ticket — the infectious exclusion Hub issue is the record.
 */
export async function releaseEventParticipantInfectiousHome(opts: {
  eventDaySessionId: string;
  participantId: string;
  disposition: string;
  handoverTo: string;
  note?: string | null;
}): Promise<void> {
  const staffId = await resolveStaffIdWithFallback();
  const handover = opts.handoverTo.trim();
  const note = (opts.note ?? "").trim();
  const notes =
    `[INFECTIOUS HOME SAFE:${opts.disposition}] Handover: ${handover}` +
    (note ? `. ${note}` : "");

  const { data: row, error: findErr } = await supabase
    .from("event_attendance_log")
    .select("id, status")
    .eq("event_day_session_id", opts.eventDaySessionId)
    .eq("participant_id", opts.participantId)
    .maybeSingle();
  if (findErr) throw findErr;
  if (!row) {
    throw new Error("No trip attendance row for this participant today.");
  }
  if ((row as { status: string }).status !== "checked_in") {
    throw new Error("Participant is not checked in on this trip day.");
  }

  const { error: updateErr } = await supabase
    .from("event_attendance_log")
    .update({
      status: "absent" as EventAttendanceStatus,
      notes,
    })
    .eq("id", (row as { id: string }).id);
  if (updateErr) throw updateErr;

  await excludeFromOpenActivityAndBus(opts.eventDaySessionId, opts.participantId);

  const gps = await tryGetGps();
  await writeToLedger({
    staff_id: staffId,
    category: "CLIENT",
    severity: "YELLOW",
    action_type: "health.infectious_home_safe_trip",
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    metadata: {
      event_day_session_id: opts.eventDaySessionId,
      participant_id: opts.participantId,
      disposition: opts.disposition,
      handover_to: handover,
    },
  });
}

/** Mark open activity / bus expected rows so left-trip people are not assigned. */
async function excludeFromOpenActivityAndBus(
  eventDaySessionId: string,
  participantId: string,
): Promise<void> {
  const now = operationalNowIso();

  const { error: actErr } = await supabase
    .from("event_activity_rolls")
    .update({ status: "absent", marked_absent_at: now })
    .eq("event_day_session_id", eventDaySessionId)
    .eq("participant_id", participantId)
    .eq("status", "expected");
  if (actErr) {
    console.warn("[excludeFromOpenActivityAndBus] activity roll failed (non-fatal):", actErr.message);
  }

  // Insert Absent placeholders on any activity rolls already open for this session
  // where this person was never seeded (opened after they left the trip).
  const { data: existingStops } = await supabase
    .from("event_activity_rolls")
    .select("venue_stop_id")
    .eq("event_day_session_id", eventDaySessionId);
  const stopIds = [
    ...new Set(
      (existingStops ?? []).map(
        (r) => (r as { venue_stop_id: string }).venue_stop_id,
      ),
    ),
  ];
  if (stopIds.length > 0) {
    const placeholders = stopIds.map((venueStopId) => ({
      venue_stop_id: venueStopId,
      event_day_session_id: eventDaySessionId,
      participant_id: participantId,
      status: "absent" as const,
      marked_absent_at: now,
    }));
    try {
      const { upsertActivityRollIgnoreDuplicates } = await import(
        "@/lib/api/event-activity-roll"
      );
      await upsertActivityRollIgnoreDuplicates(placeholders);
    } catch (insErr) {
      const msg = insErr instanceof Error ? insErr.message : String(insErr);
      console.warn("[excludeFromOpenActivityAndBus] placeholder insert failed:", msg);
    }
  }

  const { error: busErr } = await supabase
    .from("event_bus_manifest")
    .update({ status: "not_travelling", expected_on_bus: false })
    .eq("event_day_session_id", eventDaySessionId)
    .eq("participant_id", participantId)
    .eq("status", "expected");
  if (busErr) {
    console.warn("[excludeFromOpenActivityAndBus] bus manifest failed (non-fatal):", busErr.message);
  }
}

/** Floor-absent notes keyed by participant_id — for Absent · Sick style labels. */
export async function listFloorAbsentNotes(
  eventDaySessionId: string,
): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from("event_attendance_log")
    .select("participant_id, notes")
    .eq("event_day_session_id", eventDaySessionId)
    .eq("status", "absent");
  if (error) throw error;
  return Object.fromEntries(
    (data ?? []).map((r) => {
      const row = r as { participant_id: string; notes: string | null };
      return [row.participant_id, row.notes ?? ""];
    }),
  );
}

export async function getEventAttendanceRow(
  eventDaySessionId: string,
  participantId: string,
): Promise<EventAttendanceRow | null> {
  const { data, error } = await supabase
    .from("event_attendance_log")
    .select("*")
    .eq("event_day_session_id", eventDaySessionId)
    .eq("participant_id", participantId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return toRow(data as DbRow);
}

/**
 * Reinstate from Programme / Check-Out / anywhere: restore floor to checked_in,
 * clear morning/evening Absent placeholders, restore activity roll rows to expected.
 */
export async function reinstateLeftTripEverywhere(opts: {
  eventDaySessionId: string;
  participantId: string;
  participantName: string;
  reason: string;
}): Promise<void> {
  const reason = opts.reason.trim();
  if (reason.length < 10) {
    throw new Error("Reinstate reason must be at least 10 characters.");
  }
  const nowIso = operationalNowIso();
  const reinstateNote = `[REINSTATED] ${reason}`;

  const floor = await getEventAttendanceRow(opts.eventDaySessionId, opts.participantId);
  if (floor?.status === "absent") {
    await reinstateFromAbsent(floor, {
      reason,
      toStatus: "checked_in",
      participantName: opts.participantName,
    });
  }

  // Morning / evening Absent → expected (placeholders cleared).
  for (const table of ["event_morning_log", "event_curfew_log"] as const) {
    const { error } = await supabase
      .from(table)
      .update({
        status: "expected",
        notes: reinstateNote,
        accounted_at: null,
        accounted_by: null,
        escalation_issue_id: null,
        escalation_severity: null,
        escalation_raised_at: null,
      })
      .eq("event_day_session_id", opts.eventDaySessionId)
      .eq("participant_id", opts.participantId)
      .eq("status", "absent");
    if (error) {
      console.warn(`[reinstateLeftTripEverywhere] ${table} failed (non-fatal):`, error.message);
    }
  }

  // Activity Absent → expected so they can be confirmed again.
  const { error: actErr } = await supabase
    .from("event_activity_rolls")
    .update({
      status: "expected",
      marked_absent_at: null,
      marked_absent_by_id: null,
      checked_in_at: null,
      checked_in_by_id: null,
    })
    .eq("event_day_session_id", opts.eventDaySessionId)
    .eq("participant_id", opts.participantId)
    .eq("status", "absent");
  if (actErr) {
    console.warn("[reinstateLeftTripEverywhere] activity roll failed (non-fatal):", actErr.message);
  }

  // Activity-only Absent (floor still checked_in): note reinstate on floor.
  if (floor?.status === "checked_in") {
    await supabase
      .from("event_attendance_log")
      .update({ notes: reinstateNote })
      .eq("id", floor.id);
  }

  void nowIso;
}

// ─── Prior-session absences (Day 2 carryover badge) ───────────────────────────

/**
 * Returns a map of participantId → eventDaySessionId for any "absent" rows in
 * the given prior session IDs. Used to render "Absent [Day X]" badges.
 */
export async function listPriorAbsences(
  priorSessionIds: string[],
): Promise<Record<string, string>> {
  if (priorSessionIds.length === 0) return {};
  const { data, error } = await supabase
    .from("event_attendance_log")
    .select("participant_id, event_day_session_id")
    .in("event_day_session_id", priorSessionIds)
    .eq("status", "absent");
  if (error) throw error;
  return Object.fromEntries(
    (data ?? []).map((r) => {
      const row = r as { participant_id: string; event_day_session_id: string };
      return [row.participant_id, row.event_day_session_id];
    }),
  );
}

/** Returns names still checked in (blocks close location). */
export async function listStillCheckedIn(
  eventDaySessionId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("event_attendance_log")
    .select("participant_id")
    .eq("event_day_session_id", eventDaySessionId)
    .eq("status", "checked_in");
  if (error) throw error;
  const ids = (data ?? []).map((r) => (r as { participant_id: string }).participant_id);
  if (ids.length === 0) return [];

  const participants = await listParticipants();
  const nameById = Object.fromEntries(
    participants.map((p) => [p.id, `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Participant"]),
  );
  return ids.map((id) => nameById[id] ?? "Participant");
}
