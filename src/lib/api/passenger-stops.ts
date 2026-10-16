/**
 * Keep itinerary passenger stops in step with Travel.
 * One row per address. It stays while anyone is assigned, and goes away
 * when the last person moves back to the meeting point or departure point.
 */
import { supabase } from "@/integrations/supabase/client";
import { recordOfficeChangeBestEffort } from "@/lib/api/office-change-log";
import { loadLinkedHomeStreets } from "@/lib/api/person-addresses";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import {
  addressKey,
  alightsOnTheWay,
  effectiveAlightMode,
  effectivePickupJoin,
  joinsOnTheWay,
  normalizeStopAddress,
  passengerStopLabel,
  type PassengerStopKind,
} from "@/lib/passenger-stops";

export const PASSENGER_STOPS_SQL = "docs/sql/2026-10-15_passenger_stops.sql";

type StopRow = {
  id: string;
  session_date: string;
  stop_order: number;
  activity_kind: string | null;
  label_override: string | null;
  street_address: string | null;
  venue_id: string | null;
};

type PersonPick = {
  name: string;
  outboundBus: boolean;
  returnBus: boolean;
  pickupJoin: string | null;
  alightMode: string | null;
  /** Door or on-the-way pickup text already stored. */
  pickupText: string;
  /** Explicit other drop-off text. */
  alightText: string;
  /** Home / street on file, used when Same copies a door pickup. */
  profileAddress: string;
};

export type PassengerAssignment = {
  key: string;
  name: string;
  participantId: string | null;
  staffId: string | null;
  carerId: string | null;
  pickupOrder: number;
  /** Set when this person is collected at an itinerary pickup. */
  pickupAddress: string | null;
  /** Set when this person leaves at an itinerary drop-off. */
  dropoffAddress: string | null;
};

function coming(status: string | null | undefined): boolean {
  return status !== "Cancelled" && status !== "Waitlisted";
}

function busMode(value: string | null | undefined, fallbackBus: boolean): boolean {
  if (value === "bus" || value === "self") return value === "bus";
  return fallbackBus;
}

async function fillCarerStreets(
  map: Map<string, { name: string; address: string }>,
): Promise<void> {
  const missing = [...map.entries()].filter(([, row]) => !row.address).map(([id]) => id);
  if (missing.length === 0) return;
  const linked = await loadLinkedHomeStreets("carer", missing);
  for (const [id, street] of linked) {
    const row = map.get(id);
    if (row && !row.address) row.address = street;
  }
}

function dropAddress(person: PersonPick): string {
  const mode = effectiveAlightMode(person.alightMode);
  if (mode === "address") return normalizeStopAddress(person.alightText);
  if (mode === "same") {
    if (joinsOnTheWay(person.pickupJoin)) return normalizeStopAddress(person.pickupText);
    return normalizeStopAddress(person.pickupText) || normalizeStopAddress(person.profileAddress);
  }
  return "";
}

async function loadPeople(eventId: string): Promise<PersonPick[] | null> {
  const { data, error } = await supabase
    .from("event_roster_bookings")
    .select(
      `booking_status, outbound_transport_mode, return_transport_mode,
       pickup_join, alight_mode, trip_pickup_address_override, trip_return_address_override,
       brings_carer, carer_id, carer_transport_required,
       carer_outbound_transport_mode, carer_return_transport_mode,
       carer_pickup_join, carer_alight_mode,
       carer_trip_pickup_address_override, carer_trip_return_address_override,
       participants!event_roster_bookings_participant_id_fkey!inner(first_name, last_name, regular_pickup_address, street_address)`,
    )
    .eq("event_id", eventId);
  if (error) {
    if (isSchemaMismatchError(error)) return null;
    throw new Error(error.message);
  }

  const carerIds = [
    ...new Set(
      (data ?? [])
        .map((row) => (row as { carer_id?: string | null }).carer_id)
        .filter((id): id is string => !!id),
    ),
  ];
  const carerAddress = new Map<string, { name: string; address: string }>();
  if (carerIds.length) {
    const { data: carers, error: carerErr } = await supabase
      .from("carers_registry")
      .select("id, full_name, street_address")
      .in("id", carerIds);
    if (carerErr) throw new Error(carerErr.message);
    for (const raw of carers ?? []) {
      const row = raw as { id: string; full_name?: string | null; street_address?: string | null };
      carerAddress.set(row.id, {
        name: (row.full_name ?? "").trim() || "Carer",
        address: normalizeStopAddress(row.street_address),
      });
    }
  }
  await fillCarerStreets(carerAddress);

  const people: PersonPick[] = [];
  const seenCarers = new Set<string>();
  for (const raw of data ?? []) {
    const row = raw as {
      booking_status?: string | null;
      outbound_transport_mode?: string | null;
      return_transport_mode?: string | null;
      pickup_join?: string | null;
      alight_mode?: string | null;
      trip_pickup_address_override?: string | null;
      trip_return_address_override?: string | null;
      brings_carer?: boolean | null;
      carer_id?: string | null;
      carer_transport_required?: boolean | null;
      carer_outbound_transport_mode?: string | null;
      carer_return_transport_mode?: string | null;
      carer_pickup_join?: string | null;
      carer_alight_mode?: string | null;
      carer_trip_pickup_address_override?: string | null;
      carer_trip_return_address_override?: string | null;
      participants?:
        | {
            first_name?: string | null;
            last_name?: string | null;
            regular_pickup_address?: string | null;
            street_address?: string | null;
          }
        | Array<{
            first_name?: string | null;
            last_name?: string | null;
            regular_pickup_address?: string | null;
            street_address?: string | null;
          }>
        | null;
    };
    if (!coming(row.booking_status)) continue;
    const p = Array.isArray(row.participants) ? row.participants[0] : row.participants;
    const name = `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || "Participant";
    const profile =
      normalizeStopAddress(p?.regular_pickup_address) || normalizeStopAddress(p?.street_address);
    people.push({
      name,
      outboundBus: busMode(row.outbound_transport_mode, true),
      returnBus: busMode(row.return_transport_mode, true),
      pickupJoin: row.pickup_join ?? null,
      alightMode: row.alight_mode ?? null,
      pickupText: normalizeStopAddress(row.trip_pickup_address_override),
      alightText: normalizeStopAddress(row.trip_return_address_override),
      profileAddress: profile,
    });

    if (row.brings_carer && row.carer_id && !seenCarers.has(row.carer_id)) {
      seenCarers.add(row.carer_id);
      const carer = carerAddress.get(row.carer_id);
      people.push({
        name: carer?.name ?? "Carer",
        outboundBus: busMode(row.carer_outbound_transport_mode, !!row.carer_transport_required),
        returnBus: busMode(row.carer_return_transport_mode, !!row.carer_transport_required),
        pickupJoin: row.carer_pickup_join ?? null,
        alightMode: row.carer_alight_mode ?? null,
        pickupText: normalizeStopAddress(row.carer_trip_pickup_address_override),
        alightText: normalizeStopAddress(row.carer_trip_return_address_override),
        profileAddress: carer?.address ?? "",
      });
    }
  }

  const { data: support, error: supportErr } = await supabase
    .from("event_support_bookings")
    .select(
      `booking_status, person_kind, staff_id, carer_id, outbound_transport_mode, return_transport_mode,
       pickup_join, alight_mode, trip_pickup_address_override, trip_return_address_override`,
    )
    .eq("event_id", eventId);
  if (supportErr) {
    if (isSchemaMismatchError(supportErr)) return people;
    throw new Error(supportErr.message);
  }

  const staffIds = [
    ...new Set(
      (support ?? [])
        .map((row) => (row as { staff_id?: string | null }).staff_id)
        .filter((id): id is string => !!id),
    ),
  ];
  const staffAddress = new Map<string, { name: string; address: string }>();
  if (staffIds.length) {
    const { data: staff, error: staffErr } = await supabase
      .from("staff_registry")
      .select("id, full_name, street_address")
      .in("id", staffIds);
    if (staffErr) throw new Error(staffErr.message);
    for (const raw of staff ?? []) {
      const row = raw as { id: string; full_name?: string | null; street_address?: string | null };
      staffAddress.set(row.id, {
        name: (row.full_name ?? "").trim() || "Staff",
        address: normalizeStopAddress(row.street_address),
      });
    }
  }

  for (const raw of support ?? []) {
    const row = raw as {
      booking_status?: string | null;
      person_kind?: string | null;
      staff_id?: string | null;
      carer_id?: string | null;
      outbound_transport_mode?: string | null;
      return_transport_mode?: string | null;
      pickup_join?: string | null;
      alight_mode?: string | null;
      trip_pickup_address_override?: string | null;
      trip_return_address_override?: string | null;
    };
    if (!coming(row.booking_status)) continue;
    if (row.carer_id && seenCarers.has(row.carer_id)) continue;
    if (row.carer_id) seenCarers.add(row.carer_id);
    const named =
      row.person_kind === "carer"
        ? carerAddress.get(row.carer_id ?? "")
        : staffAddress.get(row.staff_id ?? "");
    people.push({
      name: named?.name ?? (row.person_kind === "volunteer" ? "Volunteer" : "Staff"),
      outboundBus: busMode(row.outbound_transport_mode, true),
      returnBus: busMode(row.return_transport_mode, true),
      pickupJoin: row.pickup_join ?? null,
      alightMode: row.alight_mode ?? null,
      pickupText: normalizeStopAddress(row.trip_pickup_address_override),
      alightText: normalizeStopAddress(row.trip_return_address_override),
      profileAddress: named?.address ?? "",
    });
  }

  return people;
}

type DesiredStop = {
  kind: PassengerStopKind;
  sessionDate: string;
  address: string;
  names: string[];
};

function desiredStops(
  people: PersonPick[],
  firstDate: string,
  lastDate: string,
): DesiredStop[] {
  const groups = new Map<string, DesiredStop>();
  const add = (kind: PassengerStopKind, sessionDate: string, address: string, name: string) => {
    const clean = normalizeStopAddress(address);
    if (!clean) return;
    const key = `${kind}|${sessionDate}|${addressKey(clean)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.names.push(name);
      return;
    }
    groups.set(key, { kind, sessionDate, address: clean, names: [name] });
  };

  for (const person of people) {
    if (joinsOnTheWay(person.pickupJoin)) {
      add("passenger_pickup", firstDate, person.pickupText, person.name);
    }
    if (alightsOnTheWay(person.alightMode)) {
      add("passenger_dropoff", lastDate, dropAddress(person), person.name);
    }
  }
  return [...groups.values()];
}

async function shiftFrom(
  dayStops: StopRow[],
  insertAt: number,
): Promise<void> {
  const shifting = dayStops
    .filter((stop) => stop.stop_order >= insertAt)
    .sort((a, b) => a.stop_order - b.stop_order);
  for (let i = 0; i < shifting.length; i++) {
    const { error } = await supabase
      .from("event_venue_stops")
      .update({ stop_order: 10000 + i })
      .eq("id", shifting[i]!.id);
    if (error) throw new Error(error.message);
  }
  for (let i = 0; i < shifting.length; i++) {
    const next = shifting[i]!.stop_order + 1;
    const { error } = await supabase
      .from("event_venue_stops")
      .update({ stop_order: next })
      .eq("id", shifting[i]!.id);
    if (error) throw new Error(error.message);
    shifting[i]!.stop_order = next;
  }
}

/** Create, rename, and remove passenger rows for one event. No-op until the SQL is applied. */
export async function syncPassengerStopsForEvent(eventId: string): Promise<void> {
  const people = await loadPeople(eventId);
  if (!people) return;

  const { data: sessions, error: sessionErr } = await supabase
    .from("event_day_sessions")
    .select("session_date")
    .eq("event_id", eventId)
    .order("session_date", { ascending: true });
  if (sessionErr) throw new Error(sessionErr.message);
  const dates = (sessions ?? [])
    .map((row) => String((row as { session_date: string }).session_date).slice(0, 10))
    .filter(Boolean);
  if (dates.length === 0) return;
  const firstDate = dates[0]!;
  const lastDate = dates[dates.length - 1]!;

  const { data: stopData, error: stopErr } = await supabase
    .from("event_venue_stops")
    .select("id, session_date, stop_order, activity_kind, label_override, street_address, venue_id")
    .eq("event_id", eventId);
  if (stopErr) {
    if (isSchemaMismatchError(stopErr)) return;
    throw new Error(stopErr.message);
  }
  const stops = ((stopData ?? []) as StopRow[]).map((stop) => ({
    ...stop,
    session_date: String(stop.session_date).slice(0, 10),
  }));

  const wanted = desiredStops(people, firstDate, lastDate);
  const used = new Set<string>();
  let changed = false;

  for (const want of wanted) {
    const match = stops.find(
      (stop) =>
        stop.session_date === want.sessionDate &&
        stop.activity_kind === want.kind &&
        addressKey(stop.street_address) === addressKey(want.address) &&
        !used.has(stop.id),
    );
    const label = passengerStopLabel(want.names);
    if (match) {
      used.add(match.id);
      if ((match.label_override ?? "") !== label || normalizeStopAddress(match.street_address) !== want.address) {
        const { error } = await supabase
          .from("event_venue_stops")
          .update({ label_override: label, street_address: want.address })
          .eq("id", match.id);
        if (error) throw new Error(error.message);
        changed = true;
      }
      continue;
    }

    const day = stops.filter((stop) => stop.session_date === want.sessionDate);
    const places = day
      .filter((stop) => (stop.activity_kind ?? "venue") === "venue")
      .sort((a, b) => a.stop_order - b.stop_order);
    const anchor =
      want.kind === "passenger_pickup" ? places[0] : places[places.length - 1];
    const insertAt = anchor
      ? want.kind === "passenger_pickup"
        ? anchor.stop_order + 1
        : anchor.stop_order
      : day.reduce((max, stop) => Math.max(max, stop.stop_order), -1) + 1;
    await shiftFrom(day, insertAt);
    const { data: inserted, error: insertErr } = await supabase
      .from("event_venue_stops")
      .insert({
        event_id: eventId,
        session_date: want.sessionDate,
        venue_id: null,
        stop_order: insertAt,
        label_override: label,
        street_address: want.address,
        activity_kind: want.kind,
        phase: "pending",
        movement_method: "bus",
        notes: null,
      })
      .select("id, session_date, stop_order, activity_kind, label_override, street_address, venue_id")
      .single();
    if (insertErr) {
      throw new Error(
        isSchemaMismatchError(insertErr)
          ? `Run ${PASSENGER_STOPS_SQL} in the database, then try again.`
          : insertErr.message,
      );
    }
    const created = inserted as StopRow;
    created.session_date = String(created.session_date).slice(0, 10);
    stops.push(created);
    used.add(created.id);
    changed = true;
  }

  for (const stop of stops) {
    if (stop.activity_kind !== "passenger_pickup" && stop.activity_kind !== "passenger_dropoff") {
      continue;
    }
    if (used.has(stop.id)) continue;
    const { error } = await supabase.from("event_venue_stops").delete().eq("id", stop.id);
    if (error) throw new Error(error.message);
    changed = true;
  }

  if (changed) {
    void recordOfficeChangeBestEffort({
      action: "updated",
      entity: "itinerary",
      recordId: eventId,
      recordName: "passenger stops",
      category: "TRIP",
      summary: "Updated pickup and drop-off stops on the itinerary",
    });
  }
}

/**
 * People the manifest should collect or drop at an itinerary address.
 * Empty when the passenger-stop columns are not on the database yet.
 */
export async function listPassengerAssignments(eventId: string): Promise<PassengerAssignment[]> {
  const { data, error } = await supabase
    .from("event_roster_bookings")
    .select(
      `id, participant_id, booking_status, pickup_order,
       outbound_transport_mode, return_transport_mode,
       pickup_join, alight_mode, trip_pickup_address_override, trip_return_address_override,
       brings_carer, carer_id, carer_transport_required, carer_pickup_order,
       carer_outbound_transport_mode, carer_return_transport_mode,
       carer_pickup_join, carer_alight_mode,
       carer_trip_pickup_address_override, carer_trip_return_address_override,
       participants!event_roster_bookings_participant_id_fkey!inner(first_name, last_name, regular_pickup_address, street_address)`,
    )
    .eq("event_id", eventId);
  if (error) {
    if (isSchemaMismatchError(error)) return [];
    throw new Error(error.message);
  }

  const carerIds = [
    ...new Set(
      (data ?? [])
        .map((row) => (row as { carer_id?: string | null }).carer_id)
        .filter((id): id is string => !!id),
    ),
  ];
  const carers = new Map<string, { name: string; address: string }>();
  if (carerIds.length) {
    const { data: rows } = await supabase
      .from("carers_registry")
      .select("id, full_name, street_address")
      .in("id", carerIds);
    for (const raw of rows ?? []) {
      const row = raw as { id: string; full_name?: string | null; street_address?: string | null };
      carers.set(row.id, {
        name: (row.full_name ?? "").trim() || "Carer",
        address: normalizeStopAddress(row.street_address),
      });
    }
  }
  await fillCarerStreets(carers);

  const out: PassengerAssignment[] = [];
  const seenCarers = new Set<string>();
  for (const raw of data ?? []) {
    const row = raw as {
      participant_id: string;
      booking_status?: string | null;
      pickup_order?: number | null;
      outbound_transport_mode?: string | null;
      return_transport_mode?: string | null;
      pickup_join?: string | null;
      alight_mode?: string | null;
      trip_pickup_address_override?: string | null;
      trip_return_address_override?: string | null;
      brings_carer?: boolean | null;
      carer_id?: string | null;
      carer_transport_required?: boolean | null;
      carer_pickup_order?: number | null;
      carer_outbound_transport_mode?: string | null;
      carer_return_transport_mode?: string | null;
      carer_pickup_join?: string | null;
      carer_alight_mode?: string | null;
      carer_trip_pickup_address_override?: string | null;
      carer_trip_return_address_override?: string | null;
      participants?:
        | {
            first_name?: string | null;
            last_name?: string | null;
            regular_pickup_address?: string | null;
            street_address?: string | null;
          }
        | Array<{
            first_name?: string | null;
            last_name?: string | null;
            regular_pickup_address?: string | null;
            street_address?: string | null;
          }>
        | null;
    };
    if (!coming(row.booking_status)) continue;
    const p = Array.isArray(row.participants) ? row.participants[0] : row.participants;
    const profile =
      normalizeStopAddress(p?.regular_pickup_address) || normalizeStopAddress(p?.street_address);
    const person: PersonPick = {
      name: `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || "Participant",
      outboundBus: busMode(row.outbound_transport_mode, true),
      returnBus: busMode(row.return_transport_mode, true),
      pickupJoin: row.pickup_join ?? null,
      alightMode: row.alight_mode ?? null,
      pickupText: normalizeStopAddress(row.trip_pickup_address_override),
      alightText: normalizeStopAddress(row.trip_return_address_override),
      profileAddress: profile,
    };
    const pickupAddress = joinsOnTheWay(person.pickupJoin) ? person.pickupText : null;
    const drop = alightsOnTheWay(person.alightMode) ? dropAddress(person) : "";
    if (pickupAddress || drop) {
      out.push({
        key: `p:${row.participant_id}`,
        name: person.name,
        participantId: row.participant_id,
        staffId: null,
        carerId: null,
        pickupOrder: Number(row.pickup_order ?? 0),
        pickupAddress,
        dropoffAddress: drop || null,
      });
    }
    if (row.brings_carer && row.carer_id && !seenCarers.has(row.carer_id)) {
      seenCarers.add(row.carer_id);
      const carer = carers.get(row.carer_id);
      const carerPerson: PersonPick = {
        name: carer?.name ?? "Carer",
        outboundBus: busMode(row.carer_outbound_transport_mode, !!row.carer_transport_required),
        returnBus: busMode(row.carer_return_transport_mode, !!row.carer_transport_required),
        pickupJoin: row.carer_pickup_join ?? null,
        alightMode: row.carer_alight_mode ?? null,
        pickupText: normalizeStopAddress(row.carer_trip_pickup_address_override),
        alightText: normalizeStopAddress(row.carer_trip_return_address_override),
        profileAddress: carer?.address ?? "",
      };
      const carerPickup = joinsOnTheWay(carerPerson.pickupJoin) ? carerPerson.pickupText : null;
      const carerDrop = alightsOnTheWay(carerPerson.alightMode) ? dropAddress(carerPerson) : "";
      if (carerPickup || carerDrop) {
        out.push({
          key: `c:${row.carer_id}`,
          name: carerPerson.name,
          participantId: null,
          staffId: null,
          carerId: row.carer_id,
          pickupOrder: Number(row.carer_pickup_order ?? row.pickup_order ?? 0),
          pickupAddress: carerPickup,
          dropoffAddress: carerDrop || null,
        });
      }
    }
  }

  const { data: support, error: supportErr } = await supabase
    .from("event_support_bookings")
    .select(
      `id, booking_status, person_kind, staff_id, carer_id, pickup_order,
       outbound_transport_mode, return_transport_mode, pickup_join, alight_mode,
       trip_pickup_address_override, trip_return_address_override`,
    )
    .eq("event_id", eventId);
  if (supportErr) {
    if (isSchemaMismatchError(supportErr)) return out;
    throw new Error(supportErr.message);
  }
  const staffIds = [
    ...new Set(
      (support ?? [])
        .map((row) => (row as { staff_id?: string | null }).staff_id)
        .filter((id): id is string => !!id),
    ),
  ];
  const staffNames = new Map<string, string>();
  if (staffIds.length) {
    const { data: staffRows } = await supabase
      .from("staff_registry")
      .select("id, full_name")
      .in("id", staffIds);
    for (const raw of staffRows ?? []) {
      const row = raw as { id: string; full_name?: string | null };
      staffNames.set(row.id, (row.full_name ?? "").trim() || "Staff");
    }
  }
  for (const raw of support ?? []) {
    const row = raw as {
      id: string;
      booking_status?: string | null;
      person_kind?: string | null;
      staff_id?: string | null;
      carer_id?: string | null;
      pickup_order?: number | null;
      outbound_transport_mode?: string | null;
      return_transport_mode?: string | null;
      pickup_join?: string | null;
      alight_mode?: string | null;
      trip_pickup_address_override?: string | null;
      trip_return_address_override?: string | null;
    };
    if (!coming(row.booking_status)) continue;
    const person: PersonPick = {
      name:
        row.person_kind === "carer"
          ? carers.get(row.carer_id ?? "")?.name ?? "Carer"
          : staffNames.get(row.staff_id ?? "") ??
            (row.person_kind === "volunteer" ? "Volunteer" : "Staff"),
      outboundBus: busMode(row.outbound_transport_mode, true),
      returnBus: busMode(row.return_transport_mode, true),
      pickupJoin: row.pickup_join ?? null,
      alightMode: row.alight_mode ?? null,
      pickupText: normalizeStopAddress(row.trip_pickup_address_override),
      alightText: normalizeStopAddress(row.trip_return_address_override),
      profileAddress: "",
    };
    const pickupAddress = joinsOnTheWay(person.pickupJoin) ? person.pickupText : null;
    const drop = alightsOnTheWay(person.alightMode) ? dropAddress(person) : "";
    if (!pickupAddress && !drop) continue;
    const key = row.staff_id ? `s:${row.staff_id}` : row.carer_id ? `c:${row.carer_id}` : `b:${row.id}`;
    if (out.some((person) => person.key === key)) continue;
    out.push({
      key,
      name: person.name,
      participantId: null,
      staffId: row.staff_id ?? null,
      carerId: row.carer_id ?? null,
      pickupOrder: Number(row.pickup_order ?? 0),
      pickupAddress,
      dropoffAddress: drop || null,
    });
  }
  return out;
}

/** Join modes for manifest seeding. Null when the columns are not there yet. */
export async function loadBookingJoinModes(eventId: string): Promise<{
  byParticipant: Map<string, { pickupJoin: string | null; alightMode: string | null }>;
  byCarer: Map<string, { pickupJoin: string | null; alightMode: string | null }>;
} | null> {
  const { data, error } = await supabase
    .from("event_roster_bookings")
    .select("participant_id, carer_id, pickup_join, alight_mode, carer_pickup_join, carer_alight_mode")
    .eq("event_id", eventId);
  if (error) {
    if (isSchemaMismatchError(error)) return null;
    throw new Error(error.message);
  }
  const byParticipant = new Map<string, { pickupJoin: string | null; alightMode: string | null }>();
  const byCarer = new Map<string, { pickupJoin: string | null; alightMode: string | null }>();
  for (const raw of data ?? []) {
    const row = raw as {
      participant_id: string;
      carer_id?: string | null;
      pickup_join?: string | null;
      alight_mode?: string | null;
      carer_pickup_join?: string | null;
      carer_alight_mode?: string | null;
    };
    byParticipant.set(row.participant_id, {
      pickupJoin: row.pickup_join ?? null,
      alightMode: row.alight_mode ?? null,
    });
    if (row.carer_id) {
      byCarer.set(row.carer_id, {
        pickupJoin: row.carer_pickup_join ?? null,
        alightMode: row.carer_alight_mode ?? null,
      });
    }
  }
  return { byParticipant, byCarer };
}

/** On trip: they are not a door on the way to the meeting point. */
export function skipDoorPickup(join: string | null | undefined): boolean {
  return joinsOnTheWay(join);
}

/** Door home only when the bus takes them on from the departure point. */
export function skipDoorDropoff(mode: string | null | undefined): boolean {
  return effectiveAlightMode(mode) !== "home";
}
