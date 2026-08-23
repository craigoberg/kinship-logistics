/**
 * BL-098 — Event planned guests (real participants + roster bookings).
 */
import { supabase } from "@/integrations/supabase/client";
import {
  insertEventBooking,
  type EventRosterBooking,
} from "@/lib/data-store";
import { resolveStaffIdWithFallback } from "@/lib/data-store";
import { writeToLedger } from "@/lib/api/ledger";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";

export type GuestParticipant = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  dateOfBirth: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelationship: string | null;
  allergiesNotes: string | null;
  regularPickupAddress: string | null;
  streetAddress: string | null;
  archivedAt: string | null;
  participantKind: "guest" | "client";
};

export type GuestBookingIncomplete = {
  bookingId: string;
  participantId: string;
  participantName: string;
  missing: string[];
};

/** Prefill for Add guest from Day Centre visitor (DOB/emergency/allergies still required). */
export type GuestBookingPrefill = {
  firstName: string;
  lastName: string;
  hostParticipantId?: string | null;
  opsNote?: string | null;
  sourceVisitorId?: string | null;
};

/** First whitespace token → first name; remainder → last name. */
export function splitDisplayNameForGuest(displayName: string): {
  firstName: string;
  lastName: string;
} {
  const trimmed = displayName.trim().replace(/\s+/g, " ");
  if (!trimmed) return { firstName: "", lastName: "" };
  const i = trimmed.indexOf(" ");
  if (i < 0) return { firstName: trimmed, lastName: "" };
  return {
    firstName: trimmed.slice(0, i),
    lastName: trimmed.slice(i + 1).trim(),
  };
}

function guestNdisPlaceholder(): string {
  const slug = crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  return `GUEST-${slug}`;
}

function mapGuest(r: Record<string, unknown>): GuestParticipant {
  const first = String(r.first_name ?? "");
  const last = String(r.last_name ?? "");
  return {
    id: String(r.id),
    firstName: first,
    lastName: last,
    fullName: `${first} ${last}`.trim(),
    dateOfBirth: (r.date_of_birth as string | null) ?? null,
    emergencyContactName: (r.emergency_contact_name as string | null) ?? null,
    emergencyContactPhone: (r.emergency_contact_phone as string | null) ?? null,
    emergencyContactRelationship:
      (r.emergency_contact_relationship as string | null) ?? null,
    allergiesNotes: (r.allergies_notes as string | null) ?? null,
    regularPickupAddress: (r.regular_pickup_address as string | null) ?? null,
    streetAddress: (r.street_address as string | null) ?? null,
    archivedAt: (r.archived_at as string | null) ?? null,
    participantKind: (r.participant_kind as "guest" | "client") ?? "guest",
  };
}

/** Active + archived guests for reuse picker. */
export async function listGuestParticipants(): Promise<GuestParticipant[]> {
  const { data, error } = await supabase
    .from("participants")
    .select(
      "id, first_name, last_name, date_of_birth, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, allergies_notes, regular_pickup_address, street_address, archived_at, participant_kind",
    )
    .eq("participant_kind", "guest")
    .order("last_name", { ascending: true });
  if (error) {
    if (isSchemaMismatchError(error)) {
      throw new Error(
        "Guest participant columns missing — run docs/sql/2026-07-26_event_guest_participants.sql",
      );
    }
    throw error;
  }
  return (data ?? []).map((r) => mapGuest(r as Record<string, unknown>));
}

/** BL-122 — roadside guest: name + allergies only. DOB / emergency later (office). */
export async function createWalkOnGuestParticipant(input: {
  firstName: string;
  lastName: string;
  allergiesNotes: string;
  phone?: string | null;
}): Promise<GuestParticipant> {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName || !lastName) throw new Error("First and last name are required.");
  const allergies = input.allergiesNotes.trim();
  if (!allergies) {
    throw new Error('Allergies / alerts required (enter "None" if none known).');
  }
  const phone = input.phone?.trim() || null;

  const row = {
    first_name: firstName,
    last_name: lastName,
    ndis_number: guestNdisPlaceholder(),
    dual_witness_pin_hash: "GUEST",
    iddsi_level_liquids: 0,
    iddsi_level_solids: 7,
    participant_kind: "guest",
    archived_at: null,
    date_of_birth: null,
    emergency_contact_name: null,
    emergency_contact_phone: phone,
    emergency_contact_relationship: phone ? "Walk-on phone" : null,
    allergies_notes: allergies,
    street_address: null,
    regular_pickup_address: null,
  };

  const { data, error } = await supabase
    .from("participants")
    .insert(row)
    .select(
      "id, first_name, last_name, date_of_birth, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, allergies_notes, regular_pickup_address, street_address, archived_at, participant_kind",
    )
    .single();
  if (error) {
    if (isSchemaMismatchError(error)) {
      throw new Error(
        "Guest participant columns missing — run docs/sql/2026-07-26_event_guest_participants.sql",
      );
    }
    throw error;
  }

  const guest = mapGuest(data as Record<string, unknown>);
  const staffId = await resolveStaffIdWithFallback();
  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "INFO",
    action_type: "EVENT_WALK_ON_GUEST_CREATED",
    gps_lat: null,
    gps_lng: null,
    metadata: { participant_id: guest.id, display_name: guest.fullName },
  });
  return guest;
}

export async function createGuestParticipant(input: {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship?: string | null;
  allergiesNotes: string;
  streetAddress?: string | null;
  regularPickupAddress?: string | null;
}): Promise<GuestParticipant> {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName || !lastName) throw new Error("First and last name are required.");
  if (!input.dateOfBirth.trim()) throw new Error("Date of birth is required.");
  if (!input.emergencyContactName.trim() || !input.emergencyContactPhone.trim()) {
    throw new Error("Emergency contact name and phone are required.");
  }
  if (!input.allergiesNotes.trim()) {
    throw new Error('Allergies / alerts required (enter "None" if none known).');
  }

  const row = {
    first_name: firstName,
    last_name: lastName,
    ndis_number: guestNdisPlaceholder(),
    dual_witness_pin_hash: "GUEST",
    iddsi_level_liquids: 0,
    iddsi_level_solids: 7,
    participant_kind: "guest",
    archived_at: null,
    date_of_birth: input.dateOfBirth.trim(),
    emergency_contact_name: input.emergencyContactName.trim(),
    emergency_contact_phone: input.emergencyContactPhone.trim(),
    emergency_contact_relationship:
      input.emergencyContactRelationship?.trim() || null,
    allergies_notes: input.allergiesNotes.trim(),
    street_address: input.streetAddress?.trim() || null,
    regular_pickup_address: input.regularPickupAddress?.trim() || null,
  };

  const { data, error } = await supabase
    .from("participants")
    .insert(row)
    .select(
      "id, first_name, last_name, date_of_birth, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, allergies_notes, regular_pickup_address, street_address, archived_at, participant_kind",
    )
    .single();
  if (error) {
    if (isSchemaMismatchError(error)) {
      throw new Error(
        "Guest participant columns missing — run docs/sql/2026-07-26_event_guest_participants.sql",
      );
    }
    throw error;
  }

  const guest = mapGuest(data as Record<string, unknown>);
  const staffId = await resolveStaffIdWithFallback();
  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "INFO",
    action_type: "EVENT_GUEST_PARTICIPANT_CREATED",
    gps_lat: null,
    gps_lng: null,
    metadata: { participant_id: guest.id, display_name: guest.fullName },
  });
  return guest;
}

/** Clear archive so an existing guest can be booked again. */
export async function reactivateGuestParticipant(
  participantId: string,
): Promise<void> {
  const { error } = await supabase
    .from("participants")
    .update({ archived_at: null, participant_kind: "guest" })
    .eq("id", participantId);
  if (error) throw error;
}

export async function archiveGuestParticipant(
  participantId: string,
): Promise<void> {
  const { error } = await supabase
    .from("participants")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", participantId)
    .eq("participant_kind", "guest");
  if (error) throw error;
}

export type ArchiveGuestsForEventResult = {
  archivedIds: string[];
  skippedIds: string[];
};

/**
 * After Close event: archive guest participants booked on this trip.
 * Skip anyone still booked on another Open or Confirmed event.
 */
export async function archiveGuestParticipantsForEvent(
  eventId: string,
): Promise<ArchiveGuestsForEventResult> {
  const { data: guestRows, error } = await supabase
    .from("event_roster_bookings")
    .select("participant_id, is_guest_booking, booking_status")
    .eq("event_id", eventId)
    .eq("is_guest_booking", true)
    .neq("booking_status", "Cancelled");

  if (error) {
    if (isSchemaMismatchError(error)) {
      return { archivedIds: [], skippedIds: [] };
    }
    throw error;
  }

  const participantIds = [
    ...new Set(
      (guestRows ?? [])
        .map((r) => (r as { participant_id: string }).participant_id)
        .filter(Boolean),
    ),
  ];
  if (participantIds.length === 0) {
    return { archivedIds: [], skippedIds: [] };
  }

  const { data: otherBookings, error: otherErr } = await supabase
    .from("event_roster_bookings")
    .select(
      `participant_id, event_id, booking_status,
       event_manifest!inner(status)`,
    )
    .in("participant_id", participantIds)
    .neq("event_id", eventId)
    .neq("booking_status", "Cancelled");

  if (otherErr) throw otherErr;

  const stillLive = new Set<string>();
  for (const raw of otherBookings ?? []) {
    const r = raw as {
      participant_id: string;
      event_manifest?: { status?: string } | null;
    };
    const status = r.event_manifest?.status ?? "";
    if (status === "Open" || status === "Confirmed") {
      stillLive.add(r.participant_id);
    }
  }

  const archivedIds: string[] = [];
  const skippedIds: string[] = [];
  const staffId = await resolveStaffIdWithFallback();

  for (const participantId of participantIds) {
    if (stillLive.has(participantId)) {
      skippedIds.push(participantId);
      continue;
    }
    await archiveGuestParticipant(participantId);
    archivedIds.push(participantId);
    await writeToLedger({
      staff_id: staffId,
      category: "CENTRE",
      severity: "INFO",
      action_type: "EVENT_GUEST_PARTICIPANT_ARCHIVED",
      gps_lat: null,
      gps_lng: null,
      metadata: { event_id: eventId, participant_id: participantId },
    });
  }

  return { archivedIds, skippedIds };
}

export async function addGuestBookingToEvent(input: {
  eventId: string;
  participantId: string;
  hostParticipantId?: string | null;
  guestOpsNote?: string | null;
  outboundTransportMode: "bus" | "self";
  returnTransportMode: "bus" | "self";
  outboundBusRunCode?: string | null;
  returnBusRunCode?: string | null;
  tripPickupAddressOverride?: string | null;
  transportMedBagRequired?: "yes" | "no" | "not_set";
  ticketPrice: number;
  eventTitle: string;
}): Promise<EventRosterBooking> {
  await reactivateGuestParticipant(input.participantId);

  const booking = await insertEventBooking({
    eventId: input.eventId,
    participantId: input.participantId,
    bookingStatus: "Confirmed",
    amountPaid: 0,
    ticketPrice: input.ticketPrice,
    eventTitle: input.eventTitle,
    notes: null,
    bringsCarer: false,
    carerId: null,
    carerTransportRequired: false,
    participantTransportRequired: input.outboundTransportMode === "bus",
    outboundTransportMode: input.outboundTransportMode,
    returnTransportMode: input.returnTransportMode,
    tripPickupAddressOverride: input.tripPickupAddressOverride ?? null,
    isGuestBooking: true,
    hostParticipantId: input.hostParticipantId ?? null,
    guestOpsNote: input.guestOpsNote ?? null,
    fundingClaimType: "Private",
    outboundBusRunCode:
      input.outboundTransportMode === "bus"
        ? input.outboundBusRunCode ?? null
        : null,
    returnBusRunCode:
      input.returnTransportMode === "bus"
        ? input.returnBusRunCode ?? null
        : null,
    transportMedBagRequired:
      input.outboundTransportMode === "bus"
        ? (input.transportMedBagRequired ?? "not_set")
        : "no",
  });

  const staffId = await resolveStaffIdWithFallback();
  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "INFO",
    action_type: "EVENT_GUEST_BOOKING_ADDED",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      event_id: input.eventId,
      booking_id: booking.id,
      participant_id: input.participantId,
      host_participant_id: input.hostParticipantId ?? null,
    },
  });

  // Floor roll is seeded at Open Location — late guests must be inserted too.
  try {
    const { syncEventAttendanceFromRoster } = await import(
      "@/lib/api/event-attendance"
    );
    await syncEventAttendanceFromRoster(input.eventId);
  } catch (e) {
    console.warn("[addGuestBookingToEvent] attendance sync", e);
  }

  return booking;
}

function missingGuestFields(args: {
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  allergies: string | null;
  outboundMode: string;
  returnMode: string;
  pickup: string | null;
  medBag: string | null;
}): string[] {
  const missing: string[] = [];
  if (!args.firstName.trim() || !args.lastName.trim()) missing.push("name");
  if (!args.dateOfBirth?.trim()) missing.push("date of birth");
  if (!args.emergencyName?.trim()) missing.push("emergency contact name");
  if (!args.emergencyPhone?.trim()) missing.push("emergency contact phone");
  if (!args.allergies?.trim()) missing.push("allergies / alerts");
  const outBus = (args.outboundMode || "bus") === "bus";
  const retBus = (args.returnMode || "bus") === "bus";
  if ((outBus || retBus) && !args.pickup?.trim()) {
    missing.push("pickup address (bus)");
  }
  if (outBus && (args.medBag ?? "not_set") === "not_set") {
    missing.push("transport med bag decision");
  }
  return missing;
}

/** Incomplete guest bookings for Confirm (amber) / Open location (hard block). */
export async function listIncompleteGuestBookings(
  eventId: string,
): Promise<GuestBookingIncomplete[]> {
  const { data, error } = await supabase
    .from("event_roster_bookings")
    .select(
      `id, participant_id, outbound_transport_mode, return_transport_mode,
       trip_pickup_address_override, transport_med_bag_required, is_guest_booking, booking_status,
       is_walk_on,
       participants!event_roster_bookings_participant_id_fkey!inner(
         first_name, last_name, date_of_birth, emergency_contact_name,
         emergency_contact_phone, allergies_notes, regular_pickup_address, street_address,
         participant_kind
       )`,
    )
    .eq("event_id", eventId)
    .neq("booking_status", "Cancelled");

  if (error) {
    if (isSchemaMismatchError(error)) {
      // Pre-BL-122 DBs: retry without is_walk_on (do not skip the hard-block).
      const retry = await supabase
        .from("event_roster_bookings")
        .select(
          `id, participant_id, outbound_transport_mode, return_transport_mode,
           trip_pickup_address_override, transport_med_bag_required, is_guest_booking, booking_status,
           participants!event_roster_bookings_participant_id_fkey!inner(
             first_name, last_name, date_of_birth, emergency_contact_name,
             emergency_contact_phone, allergies_notes, regular_pickup_address, street_address,
             participant_kind
           )`,
        )
        .eq("event_id", eventId)
        .neq("booking_status", "Cancelled");
      if (retry.error) {
        if (isSchemaMismatchError(retry.error)) return [];
        throw retry.error;
      }
      return collectIncompleteGuestBookings(retry.data ?? []);
    }
    throw error;
  }

  return collectIncompleteGuestBookings(data ?? []);
}

function collectIncompleteGuestBookings(
  rows: unknown[],
): GuestBookingIncomplete[] {
  const out: GuestBookingIncomplete[] = [];
  for (const raw of rows) {
    const r = raw as {
      id: string;
      participant_id: string;
      outbound_transport_mode?: string | null;
      return_transport_mode?: string | null;
      trip_pickup_address_override?: string | null;
      transport_med_bag_required?: string | null;
      is_guest_booking?: boolean | null;
      is_walk_on?: boolean | null;
      participants?: {
        first_name?: string;
        last_name?: string;
        date_of_birth?: string | null;
        emergency_contact_name?: string | null;
        emergency_contact_phone?: string | null;
        allergies_notes?: string | null;
        regular_pickup_address?: string | null;
        street_address?: string | null;
        participant_kind?: string | null;
      } | null;
    };
    // BL-122 — walk-ons are accepted incomplete; YELLOW issue is the office work.
    if (r.is_walk_on === true) continue;
    const p = r.participants;
    const isGuest =
      r.is_guest_booking === true || p?.participant_kind === "guest";
    if (!isGuest) continue;

    const pickup =
      (r.trip_pickup_address_override ?? "").trim() ||
      (p?.regular_pickup_address ?? "").trim() ||
      (p?.street_address ?? "").trim() ||
      null;

    const missing = missingGuestFields({
      firstName: p?.first_name ?? "",
      lastName: p?.last_name ?? "",
      dateOfBirth: p?.date_of_birth ?? null,
      emergencyName: p?.emergency_contact_name ?? null,
      emergencyPhone: p?.emergency_contact_phone ?? null,
      allergies: p?.allergies_notes ?? null,
      outboundMode: r.outbound_transport_mode ?? "bus",
      returnMode: r.return_transport_mode ?? "bus",
      pickup,
      medBag: r.transport_med_bag_required ?? "not_set",
    });
    if (missing.length === 0) continue;
    out.push({
      bookingId: r.id,
      participantId: r.participant_id,
      participantName:
        `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || "Guest",
      missing,
    });
  }
  return out;
}

export function formatGuestIncompleteMessage(
  rows: GuestBookingIncomplete[],
): string {
  if (rows.length === 0) return "";
  const sample = rows
    .slice(0, 3)
    .map((r) => `${r.participantName} (${r.missing.join(", ")})`)
    .join("; ");
  const more =
    rows.length > 3 ? ` (+${rows.length - 3} more)` : "";
  return `${rows.length} guest booking${rows.length === 1 ? "" : "s"} incomplete — Roster → Edit: ${sample}${more}`;
}
