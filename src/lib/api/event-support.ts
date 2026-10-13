/**
 * BL-125 — Trip support people (staff / volunteer / carer).
 * Own IN/HOME methods. Not guest participants.
 */
import { supabase } from "@/integrations/supabase/client";
import { isDuplicateKeyError, isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { writeToLedger } from "@/lib/api/ledger";
import { formatTravelHow, recordOfficeChangeBestEffort, withAuditActorMeta } from "@/lib/api/office-change-log";
import { assertEventFinanceWritable } from "@/lib/data-store";
import { resolveStaffIdWithFallback } from "@/lib/data-store";
import { operationalNowIso } from "@/lib/operational-clock";
import { todayLocalIso } from "@/lib/utils";
import type { ArrivalMethod } from "@/lib/api/client-attendance";
import {
  supportRosterPerson,
  type SupportPersonKind,
  type TransportRosterPerson,
} from "@/lib/support-person";

export const EVENT_SUPPORT_KEY = (eventId: string) =>
  ["event-support-bookings", eventId] as const;
export const EVENT_SUPPORT_PAYMENTS_KEY = (eventId: string) =>
  ["event-support-payments", eventId] as const;
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
  /** Null means the full event ticket price. */
  customPrice: number | null;
  notes: string | null;
  amountPaid: number;
  isFullyPaid: boolean;
  displayName: string;
}

export interface EventSupportPayment {
  id: string;
  supportBookingId: string;
  eventId: string;
  transactionDate: string;
  financialCode: "EVENT_PMT" | "EVENT_REFUND";
  description: string;
  amount: number;
  createdAt: string;
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
  custom_price?: number | string | null;
  notes?: string | null;
  amount_paid?: number | string | null;
  is_fully_paid?: boolean | null;
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
    customPrice: r.custom_price == null || r.custom_price === "" ? null : Number(r.custom_price),
    notes: r.notes ?? null,
    amountPaid: Number(r.amount_paid ?? 0),
    isFullyPaid: !!r.is_fully_paid,
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

export function supportBookingCost(booking: EventSupportBooking, ticketPrice: number): number {
  return booking.customPrice ?? ticketPrice;
}

interface PaymentDb {
  id: string;
  support_booking_id: string;
  event_id: string;
  transaction_date: string;
  financial_code: "EVENT_PMT" | "EVENT_REFUND";
  description: string;
  amount: number | string;
  created_at: string;
}

function toPayment(r: PaymentDb): EventSupportPayment {
  return {
    id: r.id,
    supportBookingId: r.support_booking_id,
    eventId: r.event_id,
    transactionDate: r.transaction_date,
    financialCode: r.financial_code,
    description: r.description,
    amount: Number(r.amount ?? 0),
    createdAt: r.created_at,
  };
}

export async function listEventSupportPayments(eventId: string): Promise<EventSupportPayment[]> {
  const { data, error } = await supabase
    .from("event_support_payment_ledger")
    .select("*")
    .eq("event_id", eventId)
    .order("transaction_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    if (isSchemaMismatchError(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => toPayment(r as PaymentDb));
}

async function recomputeSupportPaid(bookingId: string, baseline: number): Promise<number> {
  const { data, error } = await supabase
    .from("event_support_payment_ledger")
    .select("amount")
    .eq("support_booking_id", bookingId);
  if (error) throw new Error(error.message);
  const net = Number(
    (data ?? []).reduce((sum, row) => sum + Number((row as { amount: number }).amount ?? 0), 0).toFixed(2),
  );
  const amountPaid = Math.max(0, net);
  const isFullyPaid = baseline > 0 && amountPaid + 0.001 >= baseline;
  const { error: updErr } = await supabase
    .from("event_support_bookings")
    .update({ amount_paid: amountPaid, is_fully_paid: isFullyPaid })
    .eq("id", bookingId);
  if (updErr) throw new Error(updErr.message);
  return amountPaid;
}

export async function updateEventSupportBooking(input: {
  booking: EventSupportBooking;
  eventTitle: string;
  ticketPrice: number;
  bookingStatus: string;
  notes: string | null;
  /** Null keeps the full event price. */
  customPrice: number | null;
  outboundTransportMode: "bus" | "self";
  returnTransportMode: "bus" | "self";
  outboundBusRunCode: string | null;
  returnBusRunCode: string | null;
  tripPickupAddressOverride: string | null;
  refundOnCancel?: { amount: number; date: string } | null;
}): Promise<void> {
  const priceChanging = input.customPrice !== input.booking.customPrice;
  const moneyTouch = priceChanging || input.bookingStatus === "Cancelled" || !!input.refundOnCancel;
  if (moneyTouch) await assertEventFinanceWritable(input.booking.eventId);

  const baseline = input.customPrice ?? input.ticketPrice;
  const { error } = await supabase
    .from("event_support_bookings")
    .update({
      booking_status: input.bookingStatus,
      notes: input.notes,
      custom_price: input.customPrice,
      outbound_transport_mode: input.outboundTransportMode,
      return_transport_mode: input.returnTransportMode,
      outbound_bus_run_code:
        input.outboundTransportMode === "bus" ? input.outboundBusRunCode : null,
      return_bus_run_code: input.returnTransportMode === "bus" ? input.returnBusRunCode : null,
      trip_pickup_address_override: (input.tripPickupAddressOverride ?? "").trim() || null,
    })
    .eq("id", input.booking.id);
  if (error) throw new Error(error.message);

  const paidNow = input.booking.amountPaid;
  if (input.bookingStatus === "Cancelled" && input.refundOnCancel && input.refundOnCancel.amount > 0) {
    await insertSupportPayment({
      bookingId: input.booking.id,
      eventId: input.booking.eventId,
      eventTitle: input.eventTitle,
      personName: input.booking.displayName,
      transactionDate: input.refundOnCancel.date,
      financialCode: "EVENT_REFUND",
      amount: input.refundOnCancel.amount,
      description: `Cancelled — refund`,
      baseline: 0,
    });
  } else if (baseline + 0.001 < paidNow) {
    await insertSupportPayment({
      bookingId: input.booking.id,
      eventId: input.booking.eventId,
      eventTitle: input.eventTitle,
      personName: input.booking.displayName,
      transactionDate: todayLocalIso(),
      financialCode: "EVENT_REFUND",
      amount: Number((paidNow - baseline).toFixed(2)),
      description: `Price reduced below amount paid`,
      baseline,
    });
  } else {
    await recomputeSupportPaid(input.booking.id, input.bookingStatus === "Cancelled" ? 0 : baseline);
  }

  void recordOfficeChangeBestEffort({
    action: "updated",
    entity: "booking",
    recordId: input.booking.id,
    recordName: input.booking.displayName,
    category: "TRIP",
    before: {
      bookingStatus: input.booking.bookingStatus,
      customPrice: input.booking.customPrice,
      notes: input.booking.notes,
      outboundTransportMode: input.booking.outboundTransportMode,
      returnTransportMode: input.booking.returnTransportMode,
    },
    after: {
      bookingStatus: input.bookingStatus,
      customPrice: input.customPrice,
      notes: input.notes,
      outboundTransportMode: input.outboundTransportMode,
      returnTransportMode: input.returnTransportMode,
    },
  });
}

async function insertSupportPayment(input: {
  bookingId: string;
  eventId: string;
  eventTitle: string;
  personName: string;
  transactionDate: string;
  financialCode: "EVENT_PMT" | "EVENT_REFUND";
  amount: number;
  description: string;
  baseline: number;
}): Promise<void> {
  const signed = input.financialCode === "EVENT_REFUND" ? -Math.abs(input.amount) : Math.abs(input.amount);
  const { error } = await supabase.from("event_support_payment_ledger").insert({
    support_booking_id: input.bookingId,
    event_id: input.eventId,
    transaction_date: input.transactionDate,
    financial_code: input.financialCode,
    description: `${input.description} — ${input.personName} — ${input.eventTitle}`,
    amount: signed,
  });
  if (error) throw new Error(error.message);
  await recomputeSupportPaid(input.bookingId, input.baseline);
}

export async function recordEventSupportPayment(input: {
  booking: EventSupportBooking;
  eventTitle: string;
  ticketPrice: number;
  amount: number;
  paymentDate: string;
}): Promise<void> {
  await assertEventFinanceWritable(input.booking.eventId);
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Payment amount must be greater than zero.");
  }
  await insertSupportPayment({
    bookingId: input.booking.id,
    eventId: input.booking.eventId,
    eventTitle: input.eventTitle,
    personName: input.booking.displayName,
    transactionDate: input.paymentDate,
    financialCode: "EVENT_PMT",
    amount: input.amount,
    description: "Payment",
    baseline: supportBookingCost(input.booking, input.ticketPrice),
  });
  void recordOfficeChangeBestEffort({
    action: "updated",
    entity: "booking",
    recordId: input.booking.id,
    recordName: input.booking.displayName,
    category: "TRIP",
    summary: `Recorded $${input.amount.toFixed(2)} payment for ${input.booking.displayName}`,
  });
}

export async function recordEventSupportRefund(input: {
  booking: EventSupportBooking;
  eventTitle: string;
  ticketPrice: number;
  amount: number;
  refundDate: string;
}): Promise<void> {
  await assertEventFinanceWritable(input.booking.eventId);
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Refund amount must be greater than zero.");
  }
  if (input.amount > input.booking.amountPaid + 0.001) {
    throw new Error(
      `Refund cannot exceed amount paid ($${Math.max(0, input.booking.amountPaid).toFixed(2)}).`,
    );
  }
  await insertSupportPayment({
    bookingId: input.booking.id,
    eventId: input.booking.eventId,
    eventTitle: input.eventTitle,
    personName: input.booking.displayName,
    transactionDate: input.refundDate,
    financialCode: "EVENT_REFUND",
    amount: input.amount,
    description: "Refund",
    baseline: supportBookingCost(input.booking, input.ticketPrice),
  });
  void recordOfficeChangeBestEffort({
    action: "updated",
    entity: "booking",
    recordId: input.booking.id,
    recordName: input.booking.displayName,
    category: "TRIP",
    summary: `Recorded $${input.amount.toFixed(2)} refund for ${input.booking.displayName}`,
  });
}

export async function listEventSupportAttendance(
  sessionId: string,
): Promise<EventSupportAttendanceRow[]> {
  const { data, error } = await supabase
    .from("event_support_attendance_log")
    .select("*")
    .eq("event_day_session_id", sessionId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
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

  const { data: existing, error: existErr } = await supabase
    .from("event_support_attendance_log")
    .select("staff_id, carer_id")
    .eq("event_day_session_id", sessionId);
  if (existErr) {
    if (isSchemaMismatchError(existErr)) return 0;
    throw new Error(existErr.message);
  }
  const haveStaff = new Set(
    (existing ?? [])
      .map((r) => (r as { staff_id?: string | null }).staff_id)
      .filter((id): id is string => !!id),
  );
  const haveCarer = new Set(
    (existing ?? [])
      .map((r) => (r as { carer_id?: string | null }).carer_id)
      .filter((id): id is string => !!id),
  );
  const missing = bookings.filter((b) => {
    if (b.staffId) return !haveStaff.has(b.staffId);
    if (b.carerId) return !haveCarer.has(b.carerId);
    return false;
  });
  if (!missing.length) return 0;

  const { data: session } = await supabase
    .from("event_day_sessions")
    .select("expected_arrival_by")
    .eq("id", sessionId)
    .maybeSingle();
  const expectedArrivalAt =
    (session as { expected_arrival_by?: string | null } | null)?.expected_arrival_by ??
    operationalNowIso();
  const payload = missing.map((b) => ({
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
  const { data: inserted, error } = await supabase
    .from("event_support_attendance_log")
    .insert(payload)
    .select("id");
  if (error && !isDuplicateKeyError(error) && !isSchemaMismatchError(error)) {
    throw new Error(error.message);
  }
  return inserted?.length ?? 0;
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
  const names = await resolveNames();
  const logged = toAtt(data as AttDb, names);
  const how = formatTravelHow(input.arrivalMethod, input.arrivalBusRunCode);
  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "GREEN",
    action_type: "EVENT_SUPPORT_CHECKIN",
    gps_lat: null,
    gps_lng: null,
    metadata: await withAuditActorMeta({
      row_id: input.rowId,
      person_name: logged.displayName,
      person_kind: logged.personKind,
      location: "trip",
      arrival_method: input.arrivalMethod,
      arrival_bus_run_code: input.arrivalBusRunCode ?? null,
      summary: `Checked in ${logged.displayName} (${logged.personKind}) to trip ${how}`.trim(),
    }),
  });
  return logged;
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
  const names = await resolveNames();
  const logged = toAtt(data as AttDb, names);
  const how = formatTravelHow(
    input.returnTransport === "self" ? "self" : input.returnTransport,
    input.returnBusRunCode,
  );
  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "GREEN",
    action_type: "EVENT_SUPPORT_CHECKOUT",
    gps_lat: null,
    gps_lng: null,
    metadata: await withAuditActorMeta({
      row_id: input.rowId,
      person_name: logged.displayName,
      person_kind: logged.personKind,
      location: "trip",
      return_transport: input.returnTransport ?? null,
      return_bus_run_code: input.returnBusRunCode ?? null,
      summary: `Checked out ${logged.displayName} (${logged.personKind}) from trip ${how}`.trim(),
    }),
  });
  return logged;
}

export async function markEventSupportAbsent(
  rowId: string,
  notes?: string,
): Promise<EventSupportAttendanceRow> {
  const staffId = await resolveStaffIdWithFallback();
  const now = operationalNowIso();
  const { data, error } = await supabase
    .from("event_support_attendance_log")
    .update({
      status: "absent",
      notes: notes?.trim() || null,
      updated_at: now,
    })
    .eq("id", rowId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  const names = await resolveNames();
  const logged = toAtt(data as AttDb, names);
  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "GREEN",
    action_type: "EVENT_SUPPORT_ABSENT",
    gps_lat: null,
    gps_lng: null,
    metadata: await withAuditActorMeta({
      row_id: rowId,
      person_name: logged.displayName,
      person_kind: logged.personKind,
      location: "trip",
      summary: `Marked ${logged.displayName} (${logged.personKind}) absent from the trip`,
    }),
  });
  return logged;
}

/** Put a checked-in support person back to expected. Arrival method stays. */
export async function undoEventSupportCheckIn(
  rowId: string,
): Promise<EventSupportAttendanceRow> {
  const staffId = await resolveStaffIdWithFallback();
  const now = operationalNowIso();
  const { data, error } = await supabase
    .from("event_support_attendance_log")
    .update({
      status: "expected",
      checked_in_at: null,
      checked_in_by: null,
      updated_at: now,
    })
    .eq("id", rowId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  const names = await resolveNames();
  const logged = toAtt(data as AttDb, names);
  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "GREEN",
    action_type: "EVENT_SUPPORT_CHECKIN_UNDO",
    gps_lat: null,
    gps_lng: null,
    metadata: await withAuditActorMeta({
      row_id: rowId,
      person_name: logged.displayName,
      person_kind: logged.personKind,
      location: "trip",
      summary: `Undid check-in for ${logged.displayName} (${logged.personKind}) on trip`,
    }),
  });
  return logged;
}

/** Bring an absent support person back to expected. */
export async function reinstateEventSupport(
  rowId: string,
): Promise<EventSupportAttendanceRow> {
  const staffId = await resolveStaffIdWithFallback();
  const now = operationalNowIso();
  const { data, error } = await supabase
    .from("event_support_attendance_log")
    .update({ status: "expected", updated_at: now })
    .eq("id", rowId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  const names = await resolveNames();
  const logged = toAtt(data as AttDb, names);
  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "GREEN",
    action_type: "EVENT_SUPPORT_REINSTATE",
    gps_lat: null,
    gps_lng: null,
    metadata: await withAuditActorMeta({
      row_id: rowId,
      person_name: logged.displayName,
      person_kind: logged.personKind,
      location: "trip",
      summary: `Reinstated ${logged.displayName} (${logged.personKind}) on the trip`,
    }),
  });
  return logged;
}

/** Put a checked-out support person back to checked in. */
export async function undoEventSupportCheckOut(
  rowId: string,
): Promise<EventSupportAttendanceRow> {
  const staffId = await resolveStaffIdWithFallback();
  const now = operationalNowIso();
  const { data, error } = await supabase
    .from("event_support_attendance_log")
    .update({
      status: "checked_in",
      checked_out_at: null,
      checked_out_by: null,
      updated_at: now,
    })
    .eq("id", rowId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  const names = await resolveNames();
  const logged = toAtt(data as AttDb, names);
  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "GREEN",
    action_type: "EVENT_SUPPORT_CHECKOUT_UNDO",
    gps_lat: null,
    gps_lng: null,
    metadata: await withAuditActorMeta({
      row_id: rowId,
      person_name: logged.displayName,
      person_kind: logged.personKind,
      location: "trip",
      summary: `Undid check-out for ${logged.displayName} (${logged.personKind}) on trip`,
    }),
  });
  return logged;
}

/** Correct how a support person arrived without changing the check-in time. */
export async function updateEventSupportArrivalMethod(input: {
  rowId: string;
  arrivalMethod: "bus" | "private";
  arrivalBusRunCode?: string | null;
}): Promise<void> {
  const now = operationalNowIso();
  const { error } = await supabase
    .from("event_support_attendance_log")
    .update({
      arrival_method: input.arrivalMethod,
      arrival_bus_run_code:
        input.arrivalMethod === "bus" ? input.arrivalBusRunCode ?? null : null,
      updated_at: now,
    })
    .eq("id", input.rowId);
  if (error) throw new Error(error.message);
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
    }
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
      pickupOrder: b.pickupOrder ?? 0,
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
