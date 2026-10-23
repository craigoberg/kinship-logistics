/**
 * One person across the client, staff/volunteer, and carer registers.
 * Search before creating. A carer who starts helping gains a volunteer hat
 * on the same person; the bus plan moves onto that hat.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  insertEventBooking,
  insertStaffMember,
  updateStaffMember,
  type StaffCertification,
} from "@/lib/data-store";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { recordOfficeChangeBestEffort } from "@/lib/api/office-change-log";
import { addGuestBookingToEvent, ensureGuestVisitParticipant } from "@/lib/api/event-guest";
import { addEventSupportBooking } from "@/lib/api/event-support";
import { createIssue } from "@/lib/api/site-issues";
import { normalizeAccessRoleKey } from "@/lib/access-roles";
import { operationalNowIso } from "@/lib/operational-clock";
import { personHatLabel, workforceHat, type PersonHat } from "@/lib/person-hats";

export interface KnownPerson {
  key: string;
  personId: string | null;
  name: string;
  hats: PersonHat[];
  detail: string;
  staffId: string | null;
  carerId: string | null;
  participantId: string | null;
  participantKind: "client" | "guest" | null;
  /** Client this carer supports, when the carer row names one. */
  caresForParticipantId: string | null;
  caresForName: string | null;
  /** Inactive staff / volunteer row. The real record stays off. */
  staffOffboarded: boolean;
  clientParticipantId: string | null;
  clientArchived: boolean;
  guestParticipantId: string | null;
  guestArchived: boolean;
}

type StaffHit = {
  id: string;
  full_name: string;
  personnel_type: string | null;
  role: string | null;
  active: boolean | null;
  person_id?: string | null;
  phone?: string | null;
  email?: string | null;
  street_address?: string | null;
};

type CarerHit = {
  id: string;
  full_name: string;
  relationship: string | null;
  participant_id: string | null;
  person_id?: string | null;
  phone?: string | null;
  email?: string | null;
  street_address?: string | null;
};

type ParticipantHit = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  participant_kind: string | null;
  archived_at: string | null;
  person_id?: string | null;
};

function nameOfParticipant(p: ParticipantHit): string {
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
}

async function selectWithPersonId<T>(
  table: "staff_registry" | "carers_registry" | "participants",
  columns: string,
): Promise<T[]> {
  const withId = await supabase.from(table).select(`${columns}, person_id`);
  if (!withId.error) return (withId.data ?? []) as T[];
  if (!isSchemaMismatchError(withId.error)) throw new Error(withId.error.message);
  const plain = await supabase.from(table).select(columns);
  if (plain.error) throw new Error(plain.error.message);
  return (plain.data ?? []) as T[];
}

export async function listKnownPeople(): Promise<KnownPerson[]> {
  const [staff, carers, participants] = await Promise.all([
    selectWithPersonId<StaffHit>(
      "staff_registry",
      "id, full_name, personnel_type, role, active, phone, email, street_address",
    ),
    selectWithPersonId<CarerHit>(
      "carers_registry",
      "id, full_name, relationship, participant_id, phone, email, street_address",
    ),
    selectWithPersonId<ParticipantHit>(
      "participants",
      "id, first_name, last_name, participant_kind, archived_at",
    ),
  ]);

  const participantName = new Map<string, string>();
  for (const p of participants) participantName.set(p.id, nameOfParticipant(p));

  type Bucket = KnownPerson;
  const buckets = new Map<string, Bucket>();

  const bucketFor = (personId: string | null, fallbackKey: string, name: string): Bucket => {
    const key = personId ? `p:${personId}` : fallbackKey;
    let row = buckets.get(key);
    if (!row) {
      row = {
        key,
        personId,
        name,
        hats: [],
        detail: "",
        staffId: null,
        carerId: null,
        participantId: null,
        participantKind: null,
        caresForParticipantId: null,
        caresForName: null,
        staffOffboarded: false,
        clientParticipantId: null,
        clientArchived: false,
        guestParticipantId: null,
        guestArchived: false,
      };
      buckets.set(key, row);
    }
    if (!row.name && name) row.name = name;
    return row;
  };

  const addHat = (row: Bucket, hat: PersonHat) => {
    if (!row.hats.includes(hat)) row.hats.push(hat);
  };

  for (const s of staff) {
    const row = bucketFor(s.person_id ?? null, `s:${s.id}`, s.full_name);
    const off = s.active === false;
    if (!off || !row.staffId) {
      row.staffId = s.id;
      row.staffOffboarded = off;
    }
    if (!off) row.staffOffboarded = false;
    addHat(row, workforceHat(s.personnel_type, s.role));
  }
  for (const c of carers) {
    const row = bucketFor(c.person_id ?? null, `c:${c.id}`, c.full_name);
    row.carerId = c.id;
    row.caresForParticipantId = c.participant_id;
    row.caresForName = c.participant_id ? participantName.get(c.participant_id) ?? null : null;
    addHat(row, "carer");
    const rel = (c.relationship ?? "").trim();
    const who = row.caresForName;
    if (rel || who) {
      row.detail = [rel, who ? `of ${who}` : ""].filter(Boolean).join(" ");
    }
  }
  for (const p of participants) {
    const name = nameOfParticipant(p);
    const row = bucketFor(p.person_id ?? null, `a:${p.id}`, name);
    const guest = (p.participant_kind ?? "") === "guest";
    const archived = !!p.archived_at;
    if (guest) {
      row.guestParticipantId = p.id;
      row.guestArchived = archived;
      if (!archived) {
        row.participantId = p.id;
        row.participantKind = "guest";
      }
      if (!row.detail) row.detail = archived ? "Archived guest" : "Guest visit";
    } else {
      row.clientParticipantId = p.id;
      row.clientArchived = archived;
      if (!archived) {
        row.participantId = p.id;
        row.participantKind = "client";
      }
    }
    addHat(row, "client");
  }

  return [...buckets.values()]
    .filter((p) => p.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function knownPersonHatLine(person: KnownPerson): string {
  const hats = person.hats.map(personHatLabel).join(" · ");
  return person.detail ? `${hats} — ${person.detail}` : hats;
}

/** Off-boarded client, staff, or volunteer. Tonight is a guest visit. The real record stays off. */
export function knownPersonComesAsGuest(person: KnownPerson): boolean {
  if (person.staffId && !person.staffOffboarded) return false;
  if (person.carerId) return false;
  if (person.clientParticipantId && !person.clientArchived) return false;
  if (
    person.guestParticipantId &&
    !person.guestArchived &&
    !person.staffOffboarded &&
    !person.clientArchived
  ) {
    return false;
  }
  return person.staffOffboarded || person.clientArchived;
}

export function knownPersonStatusNote(person: KnownPerson): string | null {
  if (knownPersonComesAsGuest(person)) return "Off-boarded — tonight as a guest";
  if (person.guestArchived) return "Archived guest";
  return null;
}

export function matchKnownPeople(people: KnownPerson[], query: string): KnownPerson[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (q.length < 2) return [];
  const words = q.split(" ").filter((w) => w.length > 0);
  return people.filter((p) => {
    const name = p.name.toLowerCase();
    if (name.includes(q)) return true;
    return words.every((w) => name.includes(w));
  });
}

async function ensurePersonId(displayName: string, existing: string | null): Promise<string> {
  if (existing) return existing;
  const { data, error } = await supabase
    .from("people")
    .insert({ display_name: displayName })
    .select("id")
    .single();
  if (error) {
    if (isSchemaMismatchError(error)) {
      throw new Error("Person link is not on this database yet. Run docs/sql/2026-10-04_person_hats.sql.");
    }
    throw new Error(error.message);
  }
  return (data as { id: string }).id;
}

async function setPersonId(
  table: "staff_registry" | "carers_registry",
  id: string,
  personId: string,
): Promise<void> {
  const { error } = await supabase.from(table).update({ person_id: personId }).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Put a person we already know on an event. Does not create a new participant.
 */
export async function addKnownPersonToEvent(input: {
  eventId: string;
  eventTitle: string;
  ticketPrice: number;
  person: KnownPerson;
  hostParticipantId?: string | null;
  outboundTransportMode: "bus" | "self";
  returnTransportMode: "bus" | "self";
  busRunCode?: string | null;
}): Promise<string> {
  const run = (input.busRunCode ?? "").trim() || null;
  const outbound = input.outboundTransportMode;
  const ret = input.returnTransportMode;
  if (knownPersonComesAsGuest(input.person)) {
    const parts = input.person.name.trim().split(/\s+/);
    const first = parts[0] ?? "Guest";
    const last = parts.slice(1).join(" ") || "Guest";
    const guestId = await ensureGuestVisitParticipant({
      firstName: first,
      lastName: last,
      allergiesNotes: "None",
      personId: input.person.personId,
      existingGuestId: input.person.guestParticipantId,
    });
    await addGuestBookingToEvent({
      eventId: input.eventId,
      participantId: guestId,
      hostParticipantId: input.hostParticipantId,
      guestOpsNote:
        "Off-boarded person accepted as a guest. Real record left off. Office follow-up.",
      outboundTransportMode: outbound,
      returnTransportMode: ret,
      outboundBusRunCode: outbound === "bus" ? run : null,
      returnBusRunCode: ret === "bus" ? run : null,
      ticketPrice: input.ticketPrice,
      eventTitle: input.eventTitle,
    });
    try {
      await createIssue({
        sessionId: null,
        eventId: input.eventId,
        eventDaySessionId: null,
        severity: "yellow",
        owner: "internal",
        occurredAt: operationalNowIso(),
        issueDescription: `[WALK-ON] ${input.person.name} was off-boarded and was accepted onto ${input.eventTitle} as a guest. The real record was left off. Office: billing, consent, and whether to restore them.`,
        workaroundPlan:
          "Accepted onto this trip as a guest. Real record stays off-boarded. Office follows up.",
      });
    } catch (e) {
      console.warn("[addKnownPersonToEvent] YELLOW issue failed", e);
    }
    return input.person.name;
  }
  if (input.person.staffId) {
    const hat = input.person.hats.includes("volunteer") ? "volunteer" : "staff";
    await addEventSupportBooking({
      eventId: input.eventId,
      personKind: hat,
      staffId: input.person.staffId,
      linkedParticipantId: input.person.caresForParticipantId ?? input.hostParticipantId,
      outboundTransportMode: outbound,
      returnTransportMode: ret,
      outboundBusRunCode: outbound === "bus" ? run : null,
      returnBusRunCode: ret === "bus" ? run : null,
    });
    return input.person.name;
  }
  if (input.person.carerId) {
    await addEventSupportBooking({
      eventId: input.eventId,
      personKind: "carer",
      carerId: input.person.carerId,
      linkedParticipantId: input.person.caresForParticipantId ?? input.hostParticipantId,
      outboundTransportMode: outbound,
      returnTransportMode: ret,
      outboundBusRunCode: outbound === "bus" ? run : null,
      returnBusRunCode: ret === "bus" ? run : null,
    });
    return input.person.name;
  }
  const guestId =
    input.person.participantKind === "guest"
      ? input.person.participantId
      : input.person.guestParticipantId;
  if (guestId && !input.person.clientParticipantId) {
    await addGuestBookingToEvent({
      eventId: input.eventId,
      participantId: guestId,
      hostParticipantId: input.hostParticipantId,
      guestOpsNote: "Already on file — not a new guest.",
      outboundTransportMode: outbound,
      returnTransportMode: ret,
      outboundBusRunCode: outbound === "bus" ? run : null,
      returnBusRunCode: ret === "bus" ? run : null,
      ticketPrice: input.ticketPrice,
      eventTitle: input.eventTitle,
    });
    return input.person.name;
  }
  if (!input.person.participantId) {
    throw new Error("That person has no record that can be added to an event.");
  }
  await insertEventBooking({
    eventId: input.eventId,
    participantId: input.person.participantId,
    bookingStatus: "Confirmed",
    amountPaid: 0,
    ticketPrice: input.ticketPrice,
    eventTitle: input.eventTitle,
    outboundTransportMode: outbound,
    returnTransportMode: ret,
    outboundBusRunCode: outbound === "bus" ? run : null,
    returnBusRunCode: ret === "bus" ? run : null,
    participantTransportRequired: outbound === "bus" || ret === "bus",
    isGuestBooking: false,
  });
  return input.person.name;
}

/**
 * The carer starts helping the service. Same person gains a volunteer workforce
 * row (or links the staff row that already has their name). Bus plans move
 * onto that row so Run Planning has one seat. The carer link stays.
 */
export async function grantVolunteerHat(carerId: string): Promise<{ staffId: string; name: string }> {
  const { data: carer, error } = await supabase
    .from("carers_registry")
    .select("id, full_name, relationship, participant_id, phone, email, street_address, person_id")
    .eq("id", carerId)
    .single();
  if (error) {
    if (isSchemaMismatchError(error)) {
      throw new Error("Person link is not on this database yet. Run docs/sql/2026-10-04_person_hats.sql.");
    }
    throw new Error(error.message);
  }
  const c = carer as CarerHit;
  const name = c.full_name.trim();
  const personId = await ensurePersonId(name, c.person_id ?? null);
  if (c.person_id !== personId) await setPersonId("carers_registry", c.id, personId);

  const { data: linkedStaff, error: staffErr } = await supabase
    .from("staff_registry")
    .select("id, full_name, personnel_type, role, active, phone, email, street_address, certifications, person_id")
    .eq("person_id", personId)
    .maybeSingle();
  if (staffErr && !isSchemaMismatchError(staffErr)) throw new Error(staffErr.message);

  let staffId = (linkedStaff as { id: string } | null)?.id ?? null;
  if (!staffId) {
    const { data: named, error: namedErr } = await supabase
      .from("staff_registry")
      .select("id, full_name, person_id")
      .ilike("full_name", name);
    if (namedErr) throw new Error(namedErr.message);
    const sameName = (named ?? []).filter(
      (row) => (row as { full_name: string }).full_name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (sameName.length === 1) {
      const row = sameName[0] as { id: string; person_id: string | null };
      if (row.person_id && row.person_id !== personId) {
        throw new Error(`${name} is already linked to a different person.`);
      }
      staffId = row.id;
    } else if (sameName.length > 1) {
      throw new Error(`More than one staff record is named ${name}. Link the right one in Staff first.`);
    }
  }

  if (!staffId) {
    const created = await insertStaffMember({
      fullName: name,
      role: "Volunteer",
      personnelType: "volunteer",
      phone: c.phone,
      email: c.email,
      streetAddress: c.street_address,
      active: true,
      notes: `Volunteer hat. Still a carer${c.relationship ? ` (${c.relationship})` : ""}.`,
      certifications: [] as StaffCertification[],
      pinHash: "",
    });
    staffId = created.id;
  } else {
    const current = linkedStaff as StaffHit | null;
    const alreadyVolunteer =
      current && workforceHat(current.personnel_type, current.role) === "volunteer";
    if (!alreadyVolunteer) {
      const { data: existing } = await supabase
        .from("staff_registry")
        .select("id, full_name, role, personnel_type, phone, email, street_address, active, notes, certifications")
        .eq("id", staffId)
        .single();
      const row = existing as {
        full_name: string;
        role: string | null;
        personnel_type: string | null;
        phone: string | null;
        email: string | null;
        street_address: string | null;
        active: boolean | null;
        notes: string | null;
        certifications: StaffCertification[] | null;
      };
      const keepAccess = normalizeAccessRoleKey(row.personnel_type);
      const personnelType =
        keepAccess === "manager" || keepAccess === "assistant_manager"
          ? (row.personnel_type ?? "volunteer")
          : "volunteer";
      await updateStaffMember(staffId, {
        fullName: row.full_name,
        role: personnelType === "volunteer" && !row.role?.trim() ? "Volunteer" : row.role,
        personnelType,
        phone: row.phone ?? c.phone,
        email: row.email ?? c.email,
        streetAddress: row.street_address ?? c.street_address,
        active: row.active !== false,
        notes: row.notes,
        certifications: row.certifications ?? [],
      });
    }
  }

  await setPersonId("staff_registry", staffId, personId);
  await moveCarerTravelOntoStaff(carerId, staffId);

  void recordOfficeChangeBestEffort({
    action: "updated",
    entity: "carer",
    recordId: carerId,
    recordName: name,
    summary: `${name} is now also a volunteer. Bus plan follows the volunteer hat. Still a carer.`,
  });

  return { staffId, name };
}

async function moveCarerTravelOntoStaff(carerId: string, staffId: string): Promise<void> {
  const { data: schedules, error } = await supabase
    .from("support_attendance_schedules")
    .select("id, day_of_week")
    .eq("carer_id", carerId)
    .eq("active", true);
  if (error) {
    if (isSchemaMismatchError(error)) return;
    throw new Error(error.message);
  }
  for (const raw of schedules ?? []) {
    const row = raw as { id: string; day_of_week: string };
    const { data: clash } = await supabase
      .from("support_attendance_schedules")
      .select("id")
      .eq("staff_id", staffId)
      .eq("day_of_week", row.day_of_week)
      .eq("active", true)
      .maybeSingle();
    if (clash) {
      await supabase.from("support_attendance_schedules").update({ active: false }).eq("id", row.id);
      continue;
    }
    const { error: updErr } = await supabase
      .from("support_attendance_schedules")
      .update({ staff_id: staffId, carer_id: null, person_kind: "volunteer" })
      .eq("id", row.id);
    if (updErr) throw new Error(updErr.message);
  }

  const { data: logs, error: logErr } = await supabase
    .from("support_attendance_log")
    .select("id, session_id")
    .eq("carer_id", carerId)
    .eq("status", "expected");
  if (logErr) {
    if (isSchemaMismatchError(logErr)) return;
    throw new Error(logErr.message);
  }
  for (const raw of logs ?? []) {
    const row = raw as { id: string; session_id: string };
    const { data: clash } = await supabase
      .from("support_attendance_log")
      .select("id")
      .eq("session_id", row.session_id)
      .eq("staff_id", staffId)
      .maybeSingle();
    if (clash) continue;
    await supabase
      .from("support_attendance_log")
      .update({ staff_id: staffId, carer_id: null, person_kind: "volunteer" })
      .eq("id", row.id);
  }
}

export interface CarerLink {
  carerId: string;
  relationship: string | null;
  participantId: string | null;
  participantName: string;
}

/** Carer hats on the same person as this staff/volunteer row. */
export async function listCarerLinksForStaff(staffId: string): Promise<CarerLink[]> {
  const { data: staff, error } = await supabase
    .from("staff_registry")
    .select("person_id")
    .eq("id", staffId)
    .maybeSingle();
  if (error) {
    if (isSchemaMismatchError(error)) return [];
    throw new Error(error.message);
  }
  const personId = (staff as { person_id?: string | null } | null)?.person_id;
  if (!personId) return [];

  const { data: carers, error: carerErr } = await supabase
    .from("carers_registry")
    .select("id, relationship, participant_id")
    .eq("person_id", personId);
  if (carerErr) {
    if (isSchemaMismatchError(carerErr)) return [];
    throw new Error(carerErr.message);
  }
  const rows = (carers ?? []) as {
    id: string;
    relationship: string | null;
    participant_id: string | null;
  }[];
  const participantIds = [...new Set(rows.map((r) => r.participant_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (participantIds.length > 0) {
    const { data: people, error: peopleErr } = await supabase
      .from("participants")
      .select("id, first_name, last_name")
      .in("id", participantIds);
    if (peopleErr) throw new Error(peopleErr.message);
    for (const p of (people ?? []) as { id: string; first_name: string | null; last_name: string | null }[]) {
      const name = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
      names.set(p.id, name || "Client");
    }
  }
  return rows.map((r) => ({
    carerId: r.id,
    relationship: r.relationship,
    participantId: r.participant_id,
    participantName: r.participant_id ? (names.get(r.participant_id) ?? "Client") : "No client linked",
  }));
}
