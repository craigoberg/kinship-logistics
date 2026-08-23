/**
 * BL-122 — Unplanned walk-on (guest / client / carer) on a live event.
 * Manifest stop or Event Deliver venue. Driver PIN accepts; YELLOW office follow-up.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  insertCarer,
  insertEventBooking,
  listCarersForParticipant,
  listEventBookings,
  listParticipants,
  resolveStaffIdWithFallback,
  type EventRosterBooking,
} from "@/lib/data-store";
import {
  createWalkOnGuestParticipant,
  listGuestParticipants,
  reactivateGuestParticipant,
  type GuestParticipant,
} from "@/lib/api/event-guest";
import { createIssue } from "@/lib/api/site-issues";
import { writeToLedger } from "@/lib/api/ledger";
import { operationalNowIso } from "@/lib/operational-clock";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { listEventAttendanceRoll, recordEventArrival } from "@/lib/api/event-attendance";

export const WALK_ON_WORKAROUND =
  "Accepted onto this trip with incomplete intake. Office to complete booking, payment, consent, and profile next working day.";

export const WALK_ON_OPS_NOTE = "Walk-on — intake incomplete. Office follow-up.";

export type WalkOnSource = "manifest" | "venue";
export type WalkOnKind = "client" | "guest" | "carer";

export type WalkOnHost = {
  participantId: string;
  participantName: string;
  bookingId: string;
};

export type WalkOnClientCandidate = {
  id: string;
  fullName: string;
  allergiesNotes: string | null;
};

export type WalkOnBookingFlag = {
  bookingId: string;
  participantId: string;
  participantName: string;
  isWalkOn: boolean;
  carerIsWalkOn: boolean;
  hostParticipantId: string | null;
  boardedLegId: string | null;
  carerName: string | null;
};

export type AddEventWalkOnInput = {
  eventId: string;
  source: WalkOnSource;
  kind: WalkOnKind;
  hostParticipantId: string | null;
  returnTransportMode: "bus" | "self";
  outboundTransportMode: "bus" | "self";
  busRunCode?: string | null;
  pickupAddress?: string | null;
  boardedLegId?: string | null;
  eventDaySessionId?: string | null;
  allergiesNotes: string;
  phone?: string | null;
  medBagRequired?: "yes" | "no";
  /** Existing client or prior guest. */
  participantId?: string | null;
  /** New guest. */
  firstName?: string;
  lastName?: string;
  /** Existing carer, or omit with newCarerName. */
  carerId?: string | null;
  newCarerName?: string | null;
};

export type AddEventWalkOnResult = {
  displayName: string;
  kind: WalkOnKind;
  bookingId: string;
  issueId: string | null;
};

export async function listWalkOnHosts(eventId: string): Promise<WalkOnHost[]> {
  const [bookings, guests] = await Promise.all([
    listEventBookings(eventId),
    listGuestParticipants().catch(() => [] as GuestParticipant[]),
  ]);
  const guestIds = new Set(guests.map((g) => g.id));
  return bookings
    .filter(
      (b) =>
        b.bookingStatus !== "Cancelled" &&
        !b.isGuestBooking &&
        !guestIds.has(b.participantId),
    )
    .map((b) => ({
      participantId: b.participantId,
      participantName: b.participantName,
      bookingId: b.id,
    }))
    .sort((a, b) => a.participantName.localeCompare(b.participantName));
}

export async function listWalkOnClientCandidates(
  eventId: string,
): Promise<WalkOnClientCandidate[]> {
  const [bookings, guests, people] = await Promise.all([
    listEventBookings(eventId),
    listGuestParticipants().catch(() => [] as GuestParticipant[]),
    listParticipants(),
  ]);
  const booked = new Set(
    bookings
      .filter((b) => b.bookingStatus !== "Cancelled")
      .map((b) => b.participantId),
  );
  const guestIds = new Set(guests.map((g) => g.id));
  return people
    .filter((p) => !booked.has(p.id) && !guestIds.has(p.id))
    .map((p) => ({
      id: p.id,
      fullName: p.fullName,
      allergiesNotes: p.allergiesNotes,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function listWalkOnBookings(
  eventId: string,
): Promise<WalkOnBookingFlag[]> {
  const bookings = await listEventBookings(eventId);
  const carers = await Promise.all(
    bookings
      .filter((b) => b.carerIsWalkOn && b.carerId)
      .map(async (b) => {
        const list = await listCarersForParticipant(b.participantId).catch(
          () => [],
        );
        return [b.id, list.find((c) => c.id === b.carerId)?.fullName ?? null] as const;
      }),
  );
  const carerNameByBooking = new Map(carers);
  return bookings
    .filter((b) => b.isWalkOn || b.carerIsWalkOn)
    .map((b) => ({
      bookingId: b.id,
      participantId: b.participantId,
      participantName: b.participantName,
      isWalkOn: b.isWalkOn,
      carerIsWalkOn: b.carerIsWalkOn,
      hostParticipantId: b.hostParticipantId,
      boardedLegId: b.walkOnBoardedLegId,
      carerName: carerNameByBooking.get(b.id) ?? null,
    }));
}

export function walkOnParticipantIds(flags: WalkOnBookingFlag[]): Set<string> {
  return new Set(flags.filter((f) => f.isWalkOn).map((f) => f.participantId));
}

export async function addEventWalkOn(
  input: AddEventWalkOnInput,
): Promise<AddEventWalkOnResult> {
  const eventId = input.eventId;
  const { data: eventRow, error: eventErr } = await supabase
    .from("event_manifest")
    .select("id, title, ticket_price")
    .eq("id", eventId)
    .single();
  if (eventErr) throw eventErr;
  const eventTitle =
    String((eventRow as { title?: string }).title ?? "").trim() || "Event";
  const ticketPrice = Number(
    (eventRow as { ticket_price?: number | string }).ticket_price ?? 0,
  );

  const allergies = input.allergiesNotes.trim();
  if (input.kind !== "carer" && !allergies) {
    throw new Error('Allergies / alerts required (enter "None" if none known).');
  }

  if (input.kind === "guest" && !input.hostParticipantId) {
    throw new Error("Pick who they are with.");
  }
  if (input.kind === "carer" && !input.hostParticipantId) {
    throw new Error("Pick the client this carer is with.");
  }

  if (input.kind === "client" && input.participantId) {
    const { assertNotInfectiousExcluded } = await import(
      "@/lib/api/infectious-exclusion"
    );
    await assertNotInfectiousExcluded(input.participantId, "trips");
  }

  const outbound = input.outboundTransportMode;
  const ret = input.returnTransportMode;
  const runCode = (input.busRunCode ?? "").trim() || null;
  const pickup = (input.pickupAddress ?? "").trim() || null;
  const medBag = input.medBagRequired === "yes" ? "yes" : "no";

  let displayName = "";
  let booking: EventRosterBooking;

  if (input.kind === "carer") {
    const result = await addWalkOnCarer(input, pickup);
    displayName = result.displayName;
    booking = result.booking;
  } else {
    let participantId = input.participantId?.trim() || "";
    if (input.kind === "guest" && !participantId) {
      const first = (input.firstName ?? "").trim();
      const last = (input.lastName ?? "").trim();
      if (!first || !last) throw new Error("First and last name are required.");
      const created = await createWalkOnGuestParticipant({
        firstName: first,
        lastName: last,
        allergiesNotes: allergies,
        phone: input.phone,
      });
      participantId = created.id;
      displayName = created.fullName;
    } else if (!participantId) {
      throw new Error("Pick the person to add.");
    }

    const existing = (await listEventBookings(eventId)).find(
      (b) =>
        b.participantId === participantId && b.bookingStatus !== "Cancelled",
    );
    if (existing) {
      throw new Error("That person is already on this event.");
    }

    if (input.kind === "guest") {
      await reactivateGuestParticipant(participantId);
    }

    if (!displayName) {
      const people = await listParticipants();
      displayName =
        people.find((p) => p.id === participantId)?.fullName ||
        `${input.firstName ?? ""} ${input.lastName ?? ""}`.trim() ||
        "Walk-on";
    }

    booking = await insertEventBooking({
      eventId,
      participantId,
      bookingStatus: "Confirmed",
      amountPaid: 0,
      ticketPrice,
      eventTitle,
      notes: WALK_ON_OPS_NOTE,
      isGuestBooking: input.kind === "guest",
      hostParticipantId: input.hostParticipantId,
      guestOpsNote: WALK_ON_OPS_NOTE,
      fundingClaimType: input.kind === "guest" ? "Private" : undefined,
      outboundTransportMode: outbound,
      returnTransportMode: ret,
      outboundBusRunCode: outbound === "bus" ? runCode : null,
      returnBusRunCode: ret === "bus" ? runCode : null,
      tripPickupAddressOverride: outbound === "bus" ? pickup : null,
      transportMedBagRequired: outbound === "bus" ? medBag : "no",
      participantTransportRequired: outbound === "bus" || ret === "bus",
      isWalkOn: true,
      walkOnSource: input.source,
      walkOnBoardedLegId: input.boardedLegId ?? null,
    });
  }

  try {
    const { syncEventAttendanceFromRoster } = await import(
      "@/lib/api/event-attendance"
    );
    await syncEventAttendanceFromRoster(eventId);
  } catch (e) {
    console.warn("[addEventWalkOn] attendance sync", e);
  }

  if (input.kind !== "carer" && input.source === "venue" && input.eventDaySessionId) {
    await checkInWalkOnAtVenue({
      eventDaySessionId: input.eventDaySessionId,
      participantId: booking.participantId,
      returnMode: ret,
      busRunCode: runCode,
    });
  }

  await appendToOpenHopManifests({
    eventDaySessionId: input.eventDaySessionId ?? null,
    participantId: input.kind === "carer" ? null : booking.participantId,
    carerId: input.kind === "carer" ? booking.carerId : null,
    markOnBus: input.source === "manifest",
  });

  const hostName = input.hostParticipantId
    ? (await listWalkOnHosts(eventId)).find(
        (h) => h.participantId === input.hostParticipantId,
      )?.participantName ?? null
    : null;

  let issueId: string | null = null;
  try {
    const issue = await createIssue({
      sessionId: null,
      eventId,
      eventDaySessionId: input.eventDaySessionId ?? null,
      severity: "yellow",
      owner: "internal",
      occurredAt: operationalNowIso(),
      issueDescription: walkOnIssueDescription({
        displayName,
        kind: input.kind,
        eventTitle,
        hostName,
        source: input.source,
        returnMode: ret,
      }),
      workaroundPlan: WALK_ON_WORKAROUND,
    });
    issueId = issue.id;
    await patchWalkOnIssueId(booking.id, issue.id, input.kind === "carer");
  } catch (e) {
    console.warn("[addEventWalkOn] YELLOW issue failed", e);
  }

  const staffId = await resolveStaffIdWithFallback();
  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "YELLOW",
    action_type: "EVENT_WALK_ON_ACCEPTED",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      event_id: eventId,
      booking_id: booking.id,
      participant_id: booking.participantId,
      kind: input.kind,
      source: input.source,
      host_participant_id: input.hostParticipantId,
      issue_id: issueId,
      boarded_leg_id: input.boardedLegId ?? null,
    },
  });

  return { displayName, kind: input.kind, bookingId: booking.id, issueId };
}

function walkOnIssueDescription(args: {
  displayName: string;
  kind: WalkOnKind;
  eventTitle: string;
  hostName: string | null;
  source: WalkOnSource;
  returnMode: "bus" | "self";
}): string {
  const where = args.source === "manifest" ? "a Manifest stop" : "the venue (self-transport)";
  const host = args.hostName ? ` Host: ${args.hostName}.` : "";
  return `[WALK-ON] ${args.displayName} (${args.kind}) accepted onto ${args.eventTitle} at ${where}.${host} Return: ${args.returnMode}. Office: billing, consent, and finish intake.`;
}

async function addWalkOnCarer(
  input: AddEventWalkOnInput,
  pickup: string | null,
): Promise<{ displayName: string; booking: EventRosterBooking }> {
  const hostId = input.hostParticipantId!;
  const bookings = await listEventBookings(input.eventId);
  const host = bookings.find(
    (b) => b.participantId === hostId && b.bookingStatus !== "Cancelled",
  );
  if (!host) throw new Error("Host client is not on this event.");

  let carerId = input.carerId?.trim() || "";
  let displayName = "";
  if (!carerId) {
    const name = (input.newCarerName ?? "").trim();
    if (name.length < 2) throw new Error("Enter the carer’s name.");
    const created = await insertCarer({
      participantId: hostId,
      fullName: name,
      relationship: "Walk-on",
      phone: input.phone?.trim() || null,
      email: null,
      streetAddress: null,
      isPrimaryContact: false,
      notes: WALK_ON_OPS_NOTE,
    });
    carerId = created.id;
    displayName = created.fullName;
  } else {
    const list = await listCarersForParticipant(hostId);
    displayName = list.find((c) => c.id === carerId)?.fullName || "Carer";
  }

  const needsSeat =
    input.outboundTransportMode === "bus" || input.returnTransportMode === "bus";

  const patch: Record<string, unknown> = {
    brings_carer: true,
    carer_id: carerId,
    carer_transport_required: needsSeat,
    carer_is_walk_on: true,
    walk_on_source: input.source,
    walk_on_boarded_leg_id: input.boardedLegId ?? null,
  };
  if (pickup && !host.tripPickupAddressOverride) {
    patch.trip_pickup_address_override = pickup;
  }

  let { data, error } = await supabase
    .from("event_roster_bookings")
    .update(patch)
    .eq("id", host.id)
    .select("*")
    .single();
  if (error && isSchemaMismatchError(error)) {
    const legacy = { ...patch };
    delete legacy.carer_is_walk_on;
    delete legacy.walk_on_source;
    delete legacy.walk_on_boarded_leg_id;
    const retry = await supabase
      .from("event_roster_bookings")
      .update(legacy)
      .eq("id", host.id)
      .select("*")
      .single();
    data = retry.data;
    error = retry.error;
  }
  if (error) throw error;

  return {
    displayName,
    booking: {
      ...host,
      bringsCarer: true,
      carerId,
      carerTransportRequired: needsSeat,
      carerIsWalkOn: true,
      walkOnSource: input.source,
      walkOnBoardedLegId: input.boardedLegId ?? null,
    },
  };
}

async function patchWalkOnIssueId(
  bookingId: string,
  issueId: string,
  carerOnly: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("event_roster_bookings")
    .update({ walk_on_issue_id: issueId })
    .eq("id", bookingId);
  if (error && !isSchemaMismatchError(error)) {
    console.warn("[addEventWalkOn] walk_on_issue_id", error.message);
  }
  void carerOnly;
}

async function checkInWalkOnAtVenue(args: {
  eventDaySessionId: string;
  participantId: string;
  returnMode: "bus" | "self";
  busRunCode: string | null;
}): Promise<void> {
  const rows = await listEventAttendanceRoll(args.eventDaySessionId);
  const row = rows.find((r) => r.participantId === args.participantId);
  if (!row || row.status !== "expected") return;
  await recordEventArrival(row, {
    arrival: "self",
    alsoCheckIn: true,
    notes: WALK_ON_OPS_NOTE,
  });
  void args.returnMode;
  void args.busRunCode;
}

async function appendToOpenHopManifests(args: {
  eventDaySessionId: string | null;
  participantId: string | null;
  carerId: string | null;
  markOnBus: boolean;
}): Promise<void> {
  if (!args.eventDaySessionId) return;
  if (!args.participantId && !args.carerId) return;
  const { data: trips, error } = await supabase
    .from("transport_trips")
    .select("id")
    .eq("event_day_session_id", args.eventDaySessionId)
    .eq("status", "active")
    .eq("trip_kind", "event_venue_hop");
  if (error || !trips?.length) return;

  const staffId = await resolveStaffIdWithFallback();
  const nowIso = operationalNowIso();
  for (const t of trips) {
    const tripId = (t as { id: string }).id;
    const row: Record<string, unknown> = {
      event_day_session_id: args.eventDaySessionId,
      transport_trip_id: tripId,
      participant_id: args.participantId,
      carer_id: args.carerId,
      expected_on_bus: true,
      status: args.markOnBus ? "on_bus" : "expected",
      checked_on_at: args.markOnBus ? nowIso : null,
      checked_on_by: args.markOnBus ? staffId : null,
    };
    const { error: insErr } = await supabase.from("event_bus_manifest").insert(row);
    if (insErr && !isSchemaMismatchError(insErr)) {
      console.warn("[addEventWalkOn] hop manifest", insErr.message);
    }
  }
}
