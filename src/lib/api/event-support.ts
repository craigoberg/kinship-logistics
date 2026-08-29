/**
 * BL-125 — Trip support people (staff / volunteer / carer).
 * Own IN/HOME methods. Not guest participants.
 */
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { writeToLedger } from "@/lib/api/ledger";
import { resolveStaffIdWithFallback } from "@/lib/data-store";
import { operationalNowIso } from "@/lib/operational-clock";
import { matchesEventBusRun, effectiveReturnBusRun } from "@/lib/event-bus-runs";
import type { ArrivalMethod } from "@/lib/api/client-attendance";
import {
  supportRosterPerson,
  type SupportPersonKind,
  type TransportRosterPerson,
} from "@/lib/support-person";

export const EVENT_SUPPORT_KEY = (eventId: string) =>
  ["event-support-bookings", eventId] as const;
export const EVENT_SUPPORT_ROLL_KEY = (sessionId: string) =>
  ["event-support-attendance", sessionId] as const;

export interface EventSupportBooking {
  id: string;
  eventId: string;
  personKind: SupportPersonKind;
  staffId: string | null;
  carerId: string | null;
  linkedParticipantId: string | null;
  bookingStatus: string;
  outboundTransportMode: "bus" | "self";
  returnTransportMode: "bus" | "self";
  outboundBusRunCode: string | null;
  returnBusRunCode: string | null;
  pickupOrder: number | null;
  tripPickupAddressOverride: string | null;
  displayName: string;
}

export interface EventSupportAttendanceRow {
  id: string;
  eventDaySessionId: string;
  personKind: SupportPersonKind;
  staffId: string | null;
  carerId: string | null;
  linkedParticipantId: string | null;
  displayName: string;
  status: "expected" | "checked_in" | "checked_out" | "absent";
  arrivalMethod: ArrivalMethod | null;
  arrivalBusRunCode: string | null;
  returnTransport: "bus" | "self" | null;
  returnBusRunCode: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  expectedArrivalAt: string | null;
}

interface BookingDb {
  id: string;
  event_id: string;
  person_kind: SupportPersonKind;
  staff_id: string | null;
  carer_id: string | null;
  linked_participant_id: string | null;
  booking_status: string;
  outbound_transport_mode: "bus" | "self";
  return_transport_mode: "bus" | "self";
  outbound_bus_run_code: string | null;
  return_bus_run_code: string | null;
  pickup_order: number | null;
  trip_pickup_address_override: string | null;
}

interface AttDb {
  id: string;
  event_day_session_id: string;
  person_kind: SupportPersonKind;
  staff_id: string | null;
  carer_id: string | null;
  linked_participant_id: string | null;
  status: EventSupportAttendanceRow["status"];
  arrival_method: ArrivalMethod | null;
  arrival_bus_run_code: string | null;
  return_transport: "bus" | "self" | null;
  return_bus_run_code: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  expected_arrival_at?: string | null;
}

type NameMaps = {
  staff: Map<string, { name: string; address: string | null }>;
  carer: Map<string, { name: string; address: string | null }>;
};

async function resolveNames(): Promise<NameMaps> {
  const [{ data: staffRows }, { data: carerRows }] = await Promise.all([
    supabase.from("staff_registry").select("id, full_name, street_address"),
    supabase.from("carers_registry").select("id, full_name, street_address"),
  ]);
  const staff = new Map<string, { name: string; address: string | null }>();
  for (const r of staffRows ?? []) {
    const row = r as { id: string; full_name: string; street_address: string | null };
    staff.set(row.id, {
      name: row.full_name,
      address: (row.street_address ?? "").trim() || null,
    });
  }
  const carer = new Map<string, { name: string; address: string | null }>();
  for (const r of carerRows ?? []) {
    const row = r as { id: string; full_name: string; street_address: string | null };
    carer.set(row.id, {
      name: row.full_name,
      address: (row.street_address ?? "").trim() || null,
    });
  }
  return { staff, carer };
}

function bookingName(r: BookingDb, names: NameMaps): string {
  if (r.person_kind === "carer") return names.carer.get(r.carer_id ?? "")?.name ?? "Carer";
  return names.staff.get(r.staff_id ?? "")?.name ?? (r.person_kind === "volunteer" ? "Volunteer" : "Staff");
}

function toBooking(r: BookingDb, names: NameMaps): EventSupportBooking {
  return {
    id: r.id,
    eventId: r.event_id,
    personKind: r.person_kind,
    staffId: r.staff_id,
    carerId: r.carer_id,
    linkedParticipantId: r.linked_participant_id,
    bookingStatus: r.booking_status,
    outboundTransportMode: r.outbound_transport_mode,
    returnTransportMode: r.return_transport_mode,
    outboundBusRunCode: r.outbound_bus_run_code,
    returnBusRunCode: r.return_bus_run_code,
    pickupOrder: r.pickup_order,
    tripPickupAddressOverride: r.trip_pickup_address_override,
    displayName: bookingName(r, names),
  };
}

function toAtt(r: AttDb, names: NameMaps): EventSupportAttendanceRow {
  const kind = r.person_kind;
  const displayName =
    kind === "carer"
      ? names.carer.get(r.carer_id ?? "")?.name ?? "Carer"
      : names.staff.get(r.staff_id ?? "")?.name ?? (kind === "volunteer" ? "Volunteer" : "Staff");
  return {
    id: r.id,
    eventDaySessionId: r.event_day_session_id,
    personKind: kind,
    staffId: r.staff_id,
    carerId: r.carer_id,
    linkedParticipantId: r.linked_participant_id,
    displayName,
    status: r.status,
    arrivalMethod: r.arrival_method,
    arrivalBusRunCode: r.arrival_bus_run_code,
    returnTransport: r.return_transport,
    returnBusRunCode: r.return_bus_run_code,
    checkedInAt: r.checked_in_at,
    checkedOutAt: r.checked_out_at,
    expectedArrivalAt: r.expected_arrival_at ?? null,
  };
}

export async function listEventSupportBookings(eventId: string): Promise<EventSupportBooking[]> {
  const { data, error } = await supabase
    .from("event_support_bookings")
    .select("*")
    .eq("event_id", eventId)
    .order("pickup_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    if (isSchemaMismatchError(error)) return [];
    throw new Error(error.message);
  }
  const names = await resolveNames();
  return (data ?? []).map((r) => toBooking(r as BookingDb, names));
}

export async function addEventSupportBooking(input: {
  eventId: string;
  personKind: SupportPersonKind;
  staffId?: string | null;
  carerId?: string | null;
  linkedParticipantId?: string | null;
  outboundTransportMode: "bus" | "self";
  returnTransportMode: "bus" | "self";
  outboundBusRunCode?: string | null;
  returnBusRunCode?: string | null;
  tripPickupAddressOverride?: string | null;
}): Promise<EventSupportBooking> {
  const existing = await listEventSupportBookings(input.eventId);
  const maxOrder = existing.reduce((m, b) => Math.max(m, b.pickupOrder ?? 0), 0);
  const row = {
    event_id: input.eventId,
    person_kind: input.personKind,
    staff_id: input.personKind === "carer" ? null : input.staffId ?? null,
    carer_id: input.personKind === "carer" ? input.carerId ?? null : null,
    linked_participant_id: input.linkedParticipantId ?? null,
    booking_status: "Confirmed",
    outbound_transport_mode: input.outboundTransportMode,
    return_transport_mode: input.returnTransportMode,
    outbound_bus_run_code:
      input.outboundTransportMode === "bus" ? input.outboundBusRunCode ?? null : null,
    return_bus_run_code:
      input.returnTransportMode === "bus" ? input.returnBusRunCode ?? null : null,
    pickup_order: maxOrder + 10,
    trip_pickup_address_override: (input.tripPickupAddressOverride ?? "").trim() || null,
  };
  const { data, error } = await supabase
    .from("event_support_bookings")
    .insert(row)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  const names = await resolveNames();
  return toBooking(data as BookingDb, names);
}

export async function removeEventSupportBooking(id: string): Promise<void> {
  const { error } = await supabase
    .from("event_support_bookings")
    .update({ booking_status: "Cancelled" })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listEventSupportAttendance(
  sessionId: string,
): Promise<EventSupportAttendanceRow[]> {
  const { data, error } = await supabase
    .from("event_support_attendance_log")
    .select("*")
    .eq("event_day_session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) {
    if (isSchemaMismatchError(error)) return [];
    throw new Error(error.message);
  }
  const names = await resolveNames();
  return (data ?? []).map((r) => toAtt(r as AttDb, names));
}

export async function seedEventSupportRoll(
  sessionId: string,
  eventId: string,
): Promise<number> {
  const bookings = (await listEventSupportBookings(eventId)).filter(
    (b) => b.bookingStatus !== "Cancelled",
  );
  if (!bookings.length) return 0;
  const { data: session } = await supabase
    .from("event_day_sessions")
    .select("expected_arrival_by")
    .eq("id", sessionId)
    .maybeSingle();
  const expectedArrivalAt =
    (session as { expected_arrival_by?: string | null } | null)?.expected_arrival_by ??
    operationalNowIso();
  const payload = bookings.map((b) => ({
    event_day_session_id: sessionId,
    person_kind: b.personKind,
    staff_id: b.staffId,
    carer_id: b.carerId,
    linked_participant_id: b.linkedParticipantId,
    expected_arrival_at: expectedArrivalAt,
    status: "expected" as const,
    arrival_method: b.outboundTransportMode === "bus" ? "bus" : "private",
    arrival_bus_run_code: b.outboundBusRunCode,
    return_transport: b.returnTransportMode,
    return_bus_run_code: b.returnBusRunCode,
  }));
  const { error } = await supabase.from("event_support_attendance_log").insert(payload);
  if (error && error.code !== "23505" && !isSchemaMismatchError(error)) {
    throw new Error(error.message);
  }
  return payload.length;
}

export async function recordEventSupportArrival(input: {
  rowId: string;
  arrivalMethod: ArrivalMethod;
  arrivalBusRunCode?: string | null;
}): Promise<EventSupportAttendanceRow> {
  const staffId = await resolveStaffIdWithFallback();
  const now = operationalNowIso();
  const { data, error } = await supabase
    .from("event_support_attendance_log")
    .update({
      status: "checked_in",
      arrival_method: input.arrivalMethod,
      arrival_bus_run_code:
        input.arrivalMethod === "bus" ? input.arrivalBusRunCode ?? null : null,
      checked_in_at: now,
      checked_in_by: staffId || null,
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
    action_type: "EVENT_SUPPORT_CHECKIN",
    gps_lat: null,
    gps_lng: null,
    metadata: { row_id: input.rowId },
  });
  const names = await resolveNames();
  return toAtt(data as AttDb, names);
}

export async function checkOutEventSupport(input: {
  rowId: string;
  returnTransport?: "bus" | "self" | null;
  returnBusRunCode?: string | null;
}): Promise<EventSupportAttendanceRow> {
  const staffId = await resolveStaffIdWithFallback();
  const now = operationalNowIso();
  const { data, error } = await supabase
    .from("event_support_attendance_log")
    .update({
      status: "checked_out",
      return_transport: input.returnTransport ?? null,
      return_bus_run_code: input.returnBusRunCode ?? null,
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
    action_type: "EVENT_SUPPORT_CHECKOUT",
    gps_lat: null,
    gps_lng: null,
    metadata: { row_id: input.rowId },
  });
  const names = await resolveNames();
  return toAtt(data as AttDb, names);
}

export async function markEventSupportAbsent(
  rowId: string,
): Promise<EventSupportAttendanceRow> {
  const now = operationalNowIso();
  const { data, error } = await supabase
    .from("event_support_attendance_log")
    .update({ status: "absent", updated_at: now })
    .eq("id", rowId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  const names = await resolveNames();
  return toAtt(data as AttDb, names);
}

export async function listSupportRosterForEventTrip(input: {
  eventId: string;
  direction: "outbound" | "return";
  busRunCode: string | null;
  sessionDate?: string;
}): Promise<TransportRosterPerson[]> {
  const bookings = (await listEventSupportBookings(input.eventId)).filter(
    (b) => b.bookingStatus !== "Cancelled",
  );
  const names = await resolveNames();
  let filtered = bookings.filter((b) =>
    input.direction === "outbound"
      ? b.outboundTransportMode === "bus"
      : b.returnTransportMode === "bus",
  );

  if (input.direction === "return" && input.sessionDate) {
    const { data: session } = await supabase
      .from("event_day_sessions")
      .select("id")
      .eq("event_id", input.eventId)
      .eq("session_date", input.sessionDate)
      .maybeSingle();
    if (session) {
      const roll = await listEventSupportAttendance((session as { id: string }).id);
      const absent = new Set(
        roll.filter((r) => r.status === "absent").map((r) => r.staffId ?? r.carerId ?? ""),
      );
      filtered = filtered.filter((b) => !absent.has(b.staffId ?? b.carerId ?? ""));
      filtered = filtered.filter((b) => {
        const floor = roll.find(
          (r) =>
            (b.staffId && r.staffId === b.staffId) || (b.carerId && r.carerId === b.carerId),
        );
        const personRun = effectiveReturnBusRun(
          floor?.returnTransport === "bus" ? floor.returnBusRunCode : null,
          b.returnBusRunCode,
        );
        return matchesEventBusRun(personRun, input.busRunCode);
      });
    } else {
      filtered = filtered.filter((b) =>
        matchesEventBusRun(b.returnBusRunCode, input.busRunCode),
      );
    }
  } else {
    filtered = filtered.filter((b) =>
      matchesEventBusRun(
        input.direction === "outbound" ? b.outboundBusRunCode : b.returnBusRunCode,
        input.busRunCode,
      ),
    );
  }

  return filtered.map((b) => {
    const profile =
      b.personKind === "carer"
        ? names.carer.get(b.carerId ?? "")
        : names.staff.get(b.staffId ?? "");
    const override = (b.tripPickupAddressOverride ?? "").trim();
    return supportRosterPerson({
      kind: b.personKind,
      staffId: b.staffId,
      carerId: b.carerId,
      name: b.displayName,
      address: override || profile?.address || null,
    });
  });
}

/** Legacy roster carers with a bus seat who are not yet in event_support_bookings. */
export async function listLegacyCarerRosterForEventTrip(input: {
  eventId: string;
  direction: "outbound" | "return";
  busRunCode: string | null;
}): Promise<TransportRosterPerson[]> {
  const [{ data: bookings, error }, support] = await Promise.all([
    supabase
      .from("event_roster_bookings")
      .select(
        "participant_id, carer_id, brings_carer, carer_transport_required, outbound_transport_mode, return_transport_mode, outbound_bus_run_code, return_bus_run_code",
      )
      .eq("event_id", input.eventId)
      .neq("booking_status", "Cancelled"),
    listEventSupportBookings(input.eventId),
  ]);
  if (error) {
    if (isSchemaMismatchError(error)) return [];
    return [];
  }
  const already = new Set(
    support.filter((b) => b.carerId).map((b) => b.carerId as string),
  );
  const names = await resolveNames();
  const out: TransportRosterPerson[] = [];
  for (const raw of bookings ?? []) {
    const row = raw as {
      carer_id: string | null;
      brings_carer?: boolean;
      carer_transport_required?: boolean;
      outbound_transport_mode?: string | null;
      return_transport_mode?: string | null;
      outbound_bus_run_code?: string | null;
      return_bus_run_code?: string | null;
    };
    if (!row.brings_carer || !row.carer_transport_required || !row.carer_id) continue;
    if (already.has(row.carer_id)) continue;
    const mode =
      input.direction === "outbound"
        ? (row.outbound_transport_mode ?? "bus")
        : (row.return_transport_mode ?? "bus");
    if (mode !== "bus") continue;
    const run =
      input.direction === "outbound" ? row.outbound_bus_run_code : row.return_bus_run_code;
    if (!matchesEventBusRun(run, input.busRunCode)) continue;
    const profile = names.carer.get(row.carer_id);
    out.push(
      supportRosterPerson({
        kind: "carer",
        carerId: row.carer_id,
        name: profile?.name ?? "Carer",
        address: profile?.address ?? null,
      }),
    );
  }
  return out;
}
