/**
 * Office "Off today" — date-scoped exception + live Manifest skip + driver notice.
 * Recurring schedule is never mutated.
 */
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { writeToLedger } from "@/lib/api/ledger";
import { getOperationalTodayIso, operationalNowIso } from "@/lib/operational-clock";
import {
  cancelChargesForDate,
  insertAttendanceLog,
  isCancelledPickupLeg,
  isPassengerPickupLeg,
  listAttendanceSchedules,
  mapTripLegFromDb,
  mapTransportTripFromDb,
  NON_CHARGEABLE_STATUSES,
  patchTripLeg,
  rebuildTripPickupChain,
  resolveStaffIdWithFallback,
  type AttendanceSchedule,
  type AttendanceStatus,
} from "@/lib/data-store";
import { getSydneyDayIndex } from "@/lib/operational-time";

export interface OfficeRunExemptionInput {
  schedule: AttendanceSchedule;
  participantName: string;
  rosterDate: string;
  status: AttendanceStatus;
  notes: string;
}

export interface OfficeRunExemptionResult {
  skippedTripCount: number;
  alreadyOnBoard: boolean;
}

export interface TripRunNotice {
  id: string;
  tripId: string;
  participantId: string | null;
  noticeType: string;
  message: string;
  createdAt: string;
}

export async function listOpenTripRunNotices(tripId: string): Promise<TripRunNotice[]> {
  const { data, error } = await supabase
    .from("trip_run_notices")
    .select("id, trip_id, participant_id, notice_type, message, created_at")
    .eq("trip_id", tripId)
    .is("acknowledged_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    if (isSchemaMismatchError(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => {
    const row = r as {
      id: string;
      trip_id: string;
      participant_id: string | null;
      notice_type: string;
      message: string;
      created_at: string;
    };
    return {
      id: row.id,
      tripId: row.trip_id,
      participantId: row.participant_id,
      noticeType: row.notice_type,
      message: row.message,
      createdAt: row.created_at,
    };
  });
}

export async function acknowledgeTripRunNotice(noticeId: string): Promise<void> {
  const { error } = await supabase
    .from("trip_run_notices")
    .update({ acknowledged_at: operationalNowIso() })
    .eq("id", noticeId);
  if (error) throw new Error(error.message);
}

async function insertTripRunNotice(
  tripId: string,
  participantId: string | null,
  message: string,
): Promise<void> {
  const { error } = await supabase.from("trip_run_notices").insert({
    trip_id: tripId,
    participant_id: participantId,
    notice_type: "run_exemption",
    message,
  });
  if (error && !isSchemaMismatchError(error)) throw new Error(error.message);
}

function legMatchesExemptionPerson(
  toParticipantId: string | null,
  toStaffId: string | null,
  toCarerId: string | null,
  input: { participantId?: string | null; staffId?: string | null; carerId?: string | null },
): boolean {
  if (input.participantId && toParticipantId === input.participantId) return true;
  if (input.staffId && toStaffId === input.staffId) return true;
  if (input.carerId && toCarerId === input.carerId) return true;
  return false;
}

/** Skip this person on any open Day Centre Manifest for the date. */
export async function skipActiveTripPickupsForExemption(input: {
  participantId?: string | null;
  staffId?: string | null;
  carerId?: string | null;
  participantName: string;
  rosterDate: string;
  status: AttendanceStatus;
  notes: string;
  /** When set, only those run codes. Empty = any run they are on. */
  runCodes?: string[];
}): Promise<OfficeRunExemptionResult> {
  const staffId = await resolveStaffIdWithFallback();
  let participantName = input.participantName.trim();
  if (!participantName && input.participantId) {
    const { data } = await supabase
      .from("participants")
      .select("first_name, last_name")
      .eq("id", input.participantId)
      .maybeSingle();
    const row = data as { first_name?: string; last_name?: string } | null;
    participantName =
      `${row?.first_name ?? ""} ${row?.last_name ?? ""}`.trim() || "Participant";
  }
  if (!participantName) participantName = "Person";
  const runFilter = (input.runCodes ?? []).map((c) => c.trim()).filter(Boolean);
  const { data: tripRows, error: tripErr } = await supabase
    .from("transport_trips")
    .select("*")
    .eq("trip_date", input.rosterDate)
    .eq("status", "active")
    .not("bus_run_code", "is", null);
  if (tripErr && !isSchemaMismatchError(tripErr)) throw new Error(tripErr.message);

  let skippedTripCount = 0;
  let alreadyOnBoard = false;
  const banner = `Office: ${participantName} is Off today (${input.status}). ${input.notes}`.trim();

  for (const raw of tripRows ?? []) {
    const trip = mapTransportTripFromDb(raw);
    if (!trip.busRunCode) continue;
    if (runFilter.length > 0 && !runFilter.includes(trip.busRunCode)) continue;

    const { data: legRows, error: legErr } = await supabase
      .from("trip_legs")
      .select("*")
      .eq("trip_id", trip.id);
    if (legErr) continue;
    const legs = (legRows ?? []).map(mapTripLegFromDb);
    const target = legs.find(
      (l) =>
        isPassengerPickupLeg(l) &&
        legMatchesExemptionPerson(
          l.toParticipantId,
          l.toStaffId,
          l.toCarerId,
          input,
        ),
    );
    if (!target) continue;

    if (target.status === "completed" && target.passengerPresent === true) {
      alreadyOnBoard = true;
      await insertTripRunNotice(trip.id, input.participantId ?? null, banner);
      continue;
    }
    if (target.status === "completed") {
      await insertTripRunNotice(trip.id, input.participantId ?? null, banner);
      continue;
    }

    await writeToLedger({
      staff_id: staffId,
      category: "TRIP",
      severity: "YELLOW",
      action_type: "OFFICE_RUN_EXEMPTION",
      gps_lat: null,
      gps_lng: null,
      metadata: {
        trip_id: trip.id,
        leg_id: target.id,
        participant_id: input.participantId,
        participant_name: participantName,
        status: input.status,
        reason: input.notes,
      },
    });

    await patchTripLeg(target.id, {
      status: "completed",
      passengerPresent: false,
      medicationHandoverStatus: "not_required",
      medicationHandoverConfirmed: false,
      completedAt: operationalNowIso(),
    });
    await rebuildTripPickupChain(trip.id);
    await insertTripRunNotice(trip.id, input.participantId ?? null, banner);
    skippedTripCount += 1;
  }

  return { skippedTripCount, alreadyOnBoard };
}

export async function applyOfficeRunExemption(
  input: OfficeRunExemptionInput,
): Promise<OfficeRunExemptionResult> {
  const notes = input.notes.trim();
  if (notes.length < 20) {
    throw new Error("Reason must be at least 20 characters so the driver can see why.");
  }
  if (!NON_CHARGEABLE_STATUSES.includes(input.status)) {
    throw new Error("Off today must be Sick, Cancelled, Suspended, or No-Show.");
  }

  await insertAttendanceLog({
    participantId: input.schedule.participantId,
    scheduleId: input.schedule.id,
    rosterDate: input.rosterDate,
    expectedService: input.schedule.serviceType,
    actualStatus: input.status,
    driverNotes: notes,
  });
  await cancelChargesForDate(input.schedule.participantId, input.rosterDate);

  const runCodes = [input.schedule.inboundTransport, input.schedule.outboundTransport]
    .map((c) => (c ?? "").trim())
    .filter(Boolean);

  return skipActiveTripPickupsForExemption({
    participantId: input.schedule.participantId,
    participantName: input.participantName,
    rosterDate: input.rosterDate,
    status: input.status,
    notes,
    runCodes,
  });
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
  Thursday: 4, Friday: 5, Saturday: 6,
  "DAY-SUN": 0, "DAY-MON": 1, "DAY-TUE": 2, "DAY-WED": 3,
  "DAY-THU": 4, "DAY-FRI": 5, "DAY-SAT": 6,
};

/** Map Day Centre floor absence reason codes onto roster Off-today statuses. */
export function floorAbsenceReasonToRosterStatus(
  reasonCode: string,
): AttendanceStatus {
  const code = reasonCode.trim().toUpperCase();
  if (code === "SICK") return "Sick";
  if (code === "TRANSPORT") return "No-Show";
  return "Cancelled";
}

export async function findTodaysAttendanceSchedule(
  participantId: string,
): Promise<AttendanceSchedule | null> {
  const rows = await listAttendanceSchedules(participantId);
  const dow = getSydneyDayIndex();
  return (
    rows.find(
      (s) => s.active && WEEKDAY_INDEX[String(s.dayOfWeek)] === dow,
    ) ?? null
  );
}

function isSelfTransportLabel(raw: string | null | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return true;
  return (
    v.includes("self") ||
    v.includes("private") ||
    v.includes("family") ||
    v.startsWith("trn-self")
  );
}

/**
 * Floor "Mark Absent for Today" — same date-scoped skip as Office Off today
 * (morning + afternoon Manifest). Recurring schedule is not mutated.
 */
export async function applyFloorDayAbsenceExemption(input: {
  participantId: string;
  participantName: string;
  reasonCode: string;
  reasonLabel: string;
  detail?: string | null;
}): Promise<OfficeRunExemptionResult> {
  const rosterDate = getOperationalTodayIso();
  const status = floorAbsenceReasonToRosterStatus(input.reasonCode);
  const detail = (input.detail ?? "").trim();
  const notes =
    `[FLOOR ABSENT:${input.reasonCode}] ${input.reasonLabel}` +
    (detail ? ` — ${detail}` : "") +
    " (PIN verified).";

  const schedule = await findTodaysAttendanceSchedule(input.participantId);
  if (schedule) {
    await insertAttendanceLog({
      participantId: input.participantId,
      scheduleId: schedule.id,
      rosterDate,
      expectedService: schedule.serviceType,
      actualStatus: status,
      driverNotes: notes,
    });
  } else {
    await insertAttendanceLog({
      participantId: input.participantId,
      scheduleId: null,
      rosterDate,
      expectedService: "Day Centre",
      actualStatus: status,
      driverNotes: notes,
    });
  }
  await cancelChargesForDate(input.participantId, rosterDate);

  const runCodes = schedule
    ? [schedule.inboundTransport, schedule.outboundTransport]
        .map((c) => (c ?? "").trim())
        .filter((c) => c && !isSelfTransportLabel(c))
    : [];

  return skipActiveTripPickupsForExemption({
    participantId: input.participantId,
    participantName: input.participantName,
    rosterDate,
    status,
    notes,
    runCodes: runCodes.length > 0 ? runCodes : undefined,
  });
}

/** Late arrival / walk-in — they are attending; afternoon Manifest may include them. */
export async function clearFloorDayAbsenceExemption(
  participantId: string,
  rosterDate?: string,
): Promise<number> {
  const date = rosterDate ?? getOperationalTodayIso();
  const { data, error } = await supabase
    .from("attendance_roster_logs")
    .select("id, actual_status")
    .eq("participant_id", participantId)
    .eq("roster_date", date);
  if (error) {
    if (isSchemaMismatchError(error)) return 0;
    throw new Error(error.message);
  }
  const ids = (data ?? [])
    .filter((r) =>
      NON_CHARGEABLE_STATUSES.includes(
        (r as { actual_status: string }).actual_status as AttendanceStatus,
      ),
    )
    .map((r) => (r as { id: string }).id);
  if (ids.length === 0) return 0;
  const { error: delErr } = await supabase
    .from("attendance_roster_logs")
    .delete()
    .in("id", ids);
  if (delErr) throw new Error(delErr.message);
  return ids.length;
}

export type AfternoonHomePlacement =
  | { kind: "not_needed" }
  | { kind: "will_seed" }
  | { kind: "added_to_live_run"; tripId: string }
  | { kind: "run_already_underway"; tripId: string };

/**
 * Put a late arrival / walk-in onto today's afternoon home run when they
 * are going by bus. If the run has not started, startDayCentreRun will seed
 * them. If it is live but still at the centre, add/unskip the drop-off.
 * If the bus has left, banner the driver and leave checkout as family unless
 * staff put them on a later run.
 */
export async function placeOnAfternoonHomeRun(input: {
  participantId: string;
  participantName: string;
  busRunCode: string | null;
}): Promise<AfternoonHomePlacement> {
  const runCode = (input.busRunCode ?? "").trim();
  if (!runCode || isSelfTransportLabel(runCode)) {
    return { kind: "not_needed" };
  }
  const today = getOperationalTodayIso();
  const { data: tripRows, error: tripErr } = await supabase
    .from("transport_trips")
    .select("*")
    .eq("trip_date", today)
    .eq("status", "active")
    .eq("bus_run_code", runCode);
  if (tripErr && !isSchemaMismatchError(tripErr)) throw new Error(tripErr.message);

  const afternoon = (tripRows ?? [])
    .map(mapTransportTripFromDb)
    .filter((t) => t.eventId == null && t.tripReturn !== "none");

  if (afternoon.length === 0) return { kind: "will_seed" };

  const trip = afternoon[0]!;
  const { data: legRows, error: legErr } = await supabase
    .from("trip_legs")
    .select("*")
    .eq("trip_id", trip.id)
    .order("leg_index", { ascending: true });
  if (legErr) throw new Error(legErr.message);
  const legs = (legRows ?? []).map(mapTripLegFromDb);

  const existing = legs.find(
    (l) => isPassengerPickupLeg(l) && l.toParticipantId === input.participantId,
  );
  const busHasLeftCentre = legs.some(
    (l) =>
      isPassengerPickupLeg(l) &&
      l.status !== "pending" &&
      !isCancelledPickupLeg(l),
  );

  if (existing && !isCancelledPickupLeg(existing) && existing.status === "pending") {
    return { kind: "added_to_live_run", tripId: trip.id };
  }

  if (busHasLeftCentre) {
    await insertTripRunNotice(
      trip.id,
      input.participantId,
      `Centre: ${input.participantName} is now attending (late arrival). Home run already underway — do not return unless instructed.`,
    );
    return { kind: "run_already_underway", tripId: trip.id };
  }

  if (existing && isCancelledPickupLeg(existing)) {
    await patchTripLeg(existing.id, {
      status: "pending",
      passengerPresent: null,
      completedAt: null,
    });
    await rebuildTripPickupChain(trip.id);
    await insertTripRunNotice(
      trip.id,
      input.participantId,
      `Centre: ${input.participantName} is now attending — include on this home run.`,
    );
    return { kind: "added_to_live_run", tripId: trip.id };
  }

  if (existing) {
    return { kind: "added_to_live_run", tripId: trip.id };
  }

  const { data: part } = await supabase
    .from("participants")
    .select("first_name, last_name, regular_pickup_address, street_address")
    .eq("id", input.participantId)
    .maybeSingle();
  const prow = part as {
    first_name?: string;
    last_name?: string;
    regular_pickup_address?: string | null;
    street_address?: string | null;
  } | null;
  const name =
    input.participantName.trim() ||
    `${prow?.first_name ?? ""} ${prow?.last_name ?? ""}`.trim() ||
    "Participant";
  const regular = (prow?.regular_pickup_address ?? "").trim();
  const street = (prow?.street_address ?? "").trim();
  const address = regular.length > 0 ? regular : street.length > 0 ? street : null;

  const depot = legs.find((l) => l.legKind === "venue_to_depot");
  const pickups = legs.filter(isPassengerPickupLeg);
  const insertIndex =
    pickups.length > 0
      ? Math.max(...pickups.map((l) => l.legIndex)) + 1
      : 1;

  if (depot && depot.legIndex <= insertIndex) {
    const shiftFrom = insertIndex;
    for (const leg of legs.filter((l) => l.legIndex >= shiftFrom)) {
      const { error } = await supabase
        .from("trip_legs")
        .update({
          leg_index: leg.legIndex + 1,
          updated_at: operationalNowIso(),
        })
        .eq("id", leg.id);
      if (error) throw new Error(error.message);
    }
  }

  const lastPickup = pickups.sort((a, b) => a.legIndex - b.legIndex).at(-1);
  const { error: insErr } = await supabase.from("trip_legs").insert({
    trip_id: trip.id,
    leg_index: insertIndex,
    status: "pending",
    leg_kind: lastPickup ? "client_to_client" : "depot_to_client",
    from_label: lastPickup?.toLabel ?? "Day Centre",
    to_label: name,
    from_participant_id: lastPickup?.toParticipantId ?? null,
    to_participant_id: input.participantId,
    medication_expected: false,
    medication_handover_status: "not_required",
    medication_handover_confirmed: false,
    unexpected_medication_logged: false,
    target_address: address,
  });
  if (insErr) throw new Error(insErr.message);

  await rebuildTripPickupChain(trip.id);
  await insertTripRunNotice(
    trip.id,
    input.participantId,
    `Centre: ${input.participantName} is now attending — include on this home run.`,
  );
  return { kind: "added_to_live_run", tripId: trip.id };
}
