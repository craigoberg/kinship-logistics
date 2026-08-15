/**
 * Office "Off today" — date-scoped exception + live Manifest skip + driver notice.
 * Recurring schedule is never mutated.
 */
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { writeToLedger } from "@/lib/api/ledger";
import { operationalNowIso } from "@/lib/operational-clock";
import {
  cancelChargesForDate,
  insertAttendanceLog,
  isPassengerPickupLeg,
  mapTripLegFromDb,
  mapTransportTripFromDb,
  NON_CHARGEABLE_STATUSES,
  patchTripLeg,
  rebuildTripPickupChain,
  resolveStaffIdWithFallback,
  type AttendanceSchedule,
  type AttendanceStatus,
} from "@/lib/data-store";

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
  participantId: string,
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

/** Skip this person on any open Day Centre Manifest for the date. */
export async function skipActiveTripPickupsForExemption(input: {
  participantId: string;
  participantName: string;
  rosterDate: string;
  status: AttendanceStatus;
  notes: string;
  /** When set, only those run codes. Empty = any run they are on. */
  runCodes?: string[];
}): Promise<OfficeRunExemptionResult> {
  const staffId = await resolveStaffIdWithFallback();
  let participantName = input.participantName.trim();
  if (!participantName) {
    const { data } = await supabase
      .from("participants")
      .select("first_name, last_name")
      .eq("id", input.participantId)
      .maybeSingle();
    const row = data as { first_name?: string; last_name?: string } | null;
    participantName =
      `${row?.first_name ?? ""} ${row?.last_name ?? ""}`.trim() || "Participant";
  }
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
      (l) => isPassengerPickupLeg(l) && l.toParticipantId === input.participantId,
    );
    if (!target) continue;

    if (target.status === "completed" && target.passengerPresent === true) {
      alreadyOnBoard = true;
      await insertTripRunNotice(trip.id, input.participantId, banner);
      continue;
    }
    if (target.status === "completed") {
      await insertTripRunNotice(trip.id, input.participantId, banner);
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
    await insertTripRunNotice(trip.id, input.participantId, banner);
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
