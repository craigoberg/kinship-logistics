/**
 * Named pickup / drop-off places (BL-130).
 * Home stays on the person street_address column. Null schedule address = Home.
 * A day override changes one date only.
 */
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { operationalNowIso } from "@/lib/operational-clock";

export type AddressOwnerKind = "participant" | "staff" | "carer";

export type AddressOwner = {
  kind: AddressOwnerKind;
  id: string;
};

export type StopDirection = "morning" | "afternoon" | "outbound" | "return";

export type StopAddressChoice =
  | { mode: "home" }
  | { mode: "saved"; addressId: string }
  | { mode: "custom"; text: string };

export interface PersonAddress {
  id: string;
  participantId: string | null;
  staffId: string | null;
  carerId: string | null;
  label: string;
  address: string;
  sortOrder: number;
  archivedAt: string | null;
}

interface AddressRow {
  id: string;
  participant_id: string | null;
  staff_id: string | null;
  carer_id: string | null;
  label: string;
  address: string;
  sort_order: number;
  archived_at: string | null;
}

const ADDRESS_BOOK_SQL =
  "Named places are not on the database yet. Run docs/sql/2026-09-23_person_addresses.sql, then hard refresh.";

function ownerColumn(kind: AddressOwnerKind): "participant_id" | "staff_id" | "carer_id" {
  if (kind === "participant") return "participant_id";
  if (kind === "staff") return "staff_id";
  return "carer_id";
}

function homeTable(kind: AddressOwnerKind): "participants" | "staff_registry" | "carers_registry" {
  if (kind === "participant") return "participants";
  if (kind === "staff") return "staff_registry";
  return "carers_registry";
}

function rowToAddress(r: AddressRow): PersonAddress {
  return {
    id: r.id,
    participantId: r.participant_id,
    staffId: r.staff_id,
    carerId: r.carer_id,
    label: r.label,
    address: r.address,
    sortOrder: r.sort_order,
    archivedAt: r.archived_at,
  };
}

function ownerKey(owner: AddressOwner): string {
  return `${owner.kind}:${owner.id}`;
}

export function personKeyToOwner(personKey: string): AddressOwner | null {
  if (personKey.startsWith("s:")) return { kind: "staff", id: personKey.slice(2) };
  if (personKey.startsWith("c:")) return { kind: "carer", id: personKey.slice(2) };
  if (!personKey || personKey.includes(":")) return null;
  return { kind: "participant", id: personKey };
}

export function ownerFromLeg(input: {
  participantId?: string | null;
  staffId?: string | null;
  carerId?: string | null;
}): AddressOwner | null {
  if (input.participantId) return { kind: "participant", id: input.participantId };
  if (input.carerId) return { kind: "carer", id: input.carerId };
  if (input.staffId) return { kind: "staff", id: input.staffId };
  return null;
}

function throwIfMissing(error: { message?: string | null; code?: string | null } | null): void {
  if (!error) return;
  if (isSchemaMismatchError(error)) throw new Error(ADDRESS_BOOK_SQL);
  throw new Error(error.message ?? "Address book request failed");
}

export async function listPersonAddresses(owner: AddressOwner): Promise<PersonAddress[]> {
  const { data, error } = await supabase
    .from("person_addresses")
    .select("id, participant_id, staff_id, carer_id, label, address, sort_order, archived_at")
    .eq(ownerColumn(owner.kind), owner.id)
    .is("archived_at", null)
    .order("sort_order", { ascending: true });
  if (error) {
    if (isSchemaMismatchError(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => rowToAddress(r as AddressRow));
}

export async function loadHomeAddress(owner: AddressOwner): Promise<string | null> {
  const { data, error } = await supabase
    .from(homeTable(owner.kind))
    .select("street_address")
    .eq("id", owner.id)
    .maybeSingle();
  if (error) return null;
  const street = ((data as { street_address?: string | null } | null)?.street_address ?? "").trim();
  return street || null;
}

export const BUS_HOME_ADDRESS_REQUIRED =
  "Add a home street address on this person’s record before assigning them to a bus run.";

/** Named bus-run lookup code, or a legacy bus/pickup code. Self, walk, and carer are not bus. */
export function isBusTransportCode(
  code: string | null | undefined,
  busRunCodes: ReadonlySet<string>,
): boolean {
  const raw = (code ?? "").trim();
  if (!raw) return false;
  if (busRunCodes.has(raw)) return true;
  const v = raw.toLowerCase();
  return v.includes("bus") || v.includes("pickup");
}

export function assignmentNeedsHomeAddress(
  inbound: string | null | undefined,
  outbound: string | null | undefined,
  busRunCodes: ReadonlySet<string>,
): boolean {
  return (
    isBusTransportCode(inbound, busRunCodes) || isBusTransportCode(outbound, busRunCodes)
  );
}

export async function loadBusRunCodes(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("system_lookup_parameters")
    .select("code")
    .eq("category", "bus_runs");
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => String((r as { code: string }).code)));
}

/** Bus assignment needs a saved home street. Self transport does not. */
export async function assertHomeAddressForBusAssignment(input: {
  owner: AddressOwner;
  inbound?: string | null;
  outbound?: string | null;
}): Promise<void> {
  const codes = await loadBusRunCodes();
  if (!assignmentNeedsHomeAddress(input.inbound, input.outbound, codes)) return;
  const { data, error } = await supabase
    .from(homeTable(input.owner.kind))
    .select("street_address")
    .eq("id", input.owner.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const street = ((data as { street_address?: string | null } | null)?.street_address ?? "").trim();
  if (!street) throw new Error(BUS_HOME_ADDRESS_REQUIRED);
}

async function logAddressChange(input: {
  action: "created" | "updated" | "archived";
  owner: AddressOwner;
  recordId: string;
  label: string;
  address: string;
}): Promise<void> {
  try {
    const { recordOfficeChangeBestEffort } = await import("@/lib/api/office-change-log");
    const homeName = await loadPersonName(input.owner);
    const entity =
      input.owner.kind === "participant"
        ? "client"
        : input.owner.kind === "carer"
          ? "carer"
          : "staff";
    const verb =
      input.action === "created" ? "Added" : input.action === "archived" ? "Removed" : "Updated";
    await recordOfficeChangeBestEffort({
      action: input.action === "archived" ? "archived" : input.action,
      entity,
      recordId: input.owner.id,
      recordName: homeName,
      summary: `${verb} pickup place ${input.label} (${input.address}) for ${homeName}`,
      source: "person_addresses",
    });
  } catch (err) {
    console.warn("[person-addresses] log failed", err);
  }
}

async function loadPersonName(owner: AddressOwner): Promise<string> {
  if (owner.kind === "participant") {
    const { data } = await supabase
      .from("participants")
      .select("first_name, last_name")
      .eq("id", owner.id)
      .maybeSingle();
    const row = data as { first_name?: string | null; last_name?: string | null } | null;
    const name = `${row?.first_name ?? ""} ${row?.last_name ?? ""}`.trim();
    return name || "Client";
  }
  const table = owner.kind === "carer" ? "carers_registry" : "staff_registry";
  const { data } = await supabase.from(table).select("full_name").eq("id", owner.id).maybeSingle();
  return ((data as { full_name?: string | null } | null)?.full_name ?? "").trim() || "Person";
}

export async function createPersonAddress(input: {
  owner: AddressOwner;
  label: string;
  address: string;
}): Promise<PersonAddress> {
  const label = input.label.trim();
  const address = input.address.trim();
  if (!label || !address) throw new Error("Label and address are required.");
  const existing = await listPersonAddresses(input.owner);
  const row: Record<string, unknown> = {
    label,
    address,
    sort_order: (existing.length + 1) * 10,
    participant_id: null,
    staff_id: null,
    carer_id: null,
  };
  row[ownerColumn(input.owner.kind)] = input.owner.id;
  const { data, error } = await supabase
    .from("person_addresses")
    .insert(row)
    .select("id, participant_id, staff_id, carer_id, label, address, sort_order, archived_at")
    .single();
  throwIfMissing(error);
  const saved = rowToAddress(data as AddressRow);
  await logAddressChange({
    action: "created",
    owner: input.owner,
    recordId: saved.id,
    label: saved.label,
    address: saved.address,
  });
  return saved;
}

export async function updatePersonAddress(input: {
  id: string;
  owner: AddressOwner;
  label: string;
  address: string;
}): Promise<PersonAddress> {
  const label = input.label.trim();
  const address = input.address.trim();
  if (!label || !address) throw new Error("Label and address are required.");
  const { data, error } = await supabase
    .from("person_addresses")
    .update({ label, address, updated_at: operationalNowIso() })
    .eq("id", input.id)
    .eq(ownerColumn(input.owner.kind), input.owner.id)
    .select("id, participant_id, staff_id, carer_id, label, address, sort_order, archived_at")
    .single();
  throwIfMissing(error);
  const saved = rowToAddress(data as AddressRow);
  await logAddressChange({
    action: "updated",
    owner: input.owner,
    recordId: saved.id,
    label: saved.label,
    address: saved.address,
  });
  return saved;
}

export async function archivePersonAddress(owner: AddressOwner, id: string): Promise<void> {
  const { data: existing, error: readErr } = await supabase
    .from("person_addresses")
    .select("id, label, address")
    .eq("id", id)
    .eq(ownerColumn(owner.kind), owner.id)
    .maybeSingle();
  throwIfMissing(readErr);
  const prior = existing as { label?: string; address?: string } | null;
  const { error } = await supabase
    .from("person_addresses")
    .update({ archived_at: operationalNowIso(), updated_at: operationalNowIso() })
    .eq("id", id)
    .eq(ownerColumn(owner.kind), owner.id);
  throwIfMissing(error);
  await supabase
    .from("participant_attendance_schedules")
    .update({ inbound_address_id: null })
    .eq("inbound_address_id", id);
  await supabase
    .from("participant_attendance_schedules")
    .update({ outbound_address_id: null })
    .eq("outbound_address_id", id);
  await supabase
    .from("support_attendance_schedules")
    .update({ inbound_address_id: null })
    .eq("inbound_address_id", id);
  await supabase
    .from("support_attendance_schedules")
    .update({ outbound_address_id: null })
    .eq("outbound_address_id", id);
  await logAddressChange({
    action: "archived",
    owner,
    recordId: id,
    label: (prior?.label ?? "").trim() || "Place",
    address: (prior?.address ?? "").trim() || "address",
  });
}

export async function loadAddressBookEntries(
  ids: string[],
): Promise<Map<string, { label: string; address: string }>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, { label: string; address: string }>();
  if (unique.length === 0) return out;
  const { data, error } = await supabase
    .from("person_addresses")
    .select("id, label, address, archived_at")
    .in("id", unique);
  if (error) {
    if (isSchemaMismatchError(error)) return out;
    throw new Error(error.message);
  }
  for (const raw of data ?? []) {
    const row = raw as { id: string; label: string; address: string; archived_at: string | null };
    if (row.archived_at) continue;
    const address = (row.address ?? "").trim();
    if (!address) continue;
    out.set(row.id, { label: (row.label ?? "").trim() || "Place", address });
  }
  return out;
}

type ScheduleAddressRow = {
  participant_id?: string | null;
  staff_id?: string | null;
  carer_id?: string | null;
  inbound_address_id?: string | null;
  outbound_address_id?: string | null;
};

function standingId(row: ScheduleAddressRow, direction: "morning" | "afternoon"): string | null {
  const id = direction === "morning" ? row.inbound_address_id : row.outbound_address_id;
  return id ?? null;
}

async function loadHomesForIds(input: {
  participantIds: string[];
  staffIds: string[];
  carerIds: string[];
}): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const load = async (table: string, ids: string[], kind: AddressOwnerKind) => {
    if (ids.length === 0) return;
    const { data, error } = await supabase.from(table).select("id, street_address").in("id", ids);
    if (error) return;
    for (const raw of data ?? []) {
      const row = raw as { id: string; street_address: string | null };
      out.set(`${kind}:${row.id}`, (row.street_address ?? "").trim() || null);
    }
  };
  await Promise.all([
    load("participants", input.participantIds, "participant"),
    load("staff_registry", input.staffIds, "staff"),
    load("carers_registry", input.carerIds, "carer"),
  ]);
  return out;
}

type DayOverrideRow = {
  participant_id: string | null;
  staff_id: string | null;
  carer_id: string | null;
  address_id: string | null;
  custom_address: string | null;
};

async function loadDayOverrides(
  serviceDate: string,
  direction: StopDirection,
): Promise<DayOverrideRow[] | null> {
  const { data, error } = await supabase
    .from("day_stop_address_overrides")
    .select("participant_id, staff_id, carer_id, address_id, custom_address")
    .eq("service_date", serviceDate)
    .eq("direction", direction);
  if (error) {
    if (isSchemaMismatchError(error)) return null;
    throw new Error(error.message);
  }
  return (data ?? []) as DayOverrideRow[];
}

function overrideFor(
  rows: DayOverrideRow[],
  owner: AddressOwner,
): DayOverrideRow | undefined {
  return rows.find((r) => {
    if (owner.kind === "participant") return r.participant_id === owner.id;
    if (owner.kind === "staff") return r.staff_id === owner.id;
    return r.carer_id === owner.id;
  });
}

function textFromOverride(
  row: DayOverrideRow,
  book: Map<string, { label: string; address: string }>,
  home: string | null,
): string | null {
  const custom = (row.custom_address ?? "").trim();
  if (custom) return custom;
  if (row.address_id) return book.get(row.address_id)?.address ?? home;
  return home;
}

/**
 * Replace roster addresses with the weekday standing place, then any
 * this-date override. No-ops when the address-book columns are not migrated
 * so the caller’s regular-pickup fallback stays.
 */
export async function paintDayCentreStopAddresses(
  rows: { id: string; address: string | null }[],
  input: {
    dayCode: string;
    direction: "morning" | "afternoon";
    serviceDate: string;
  },
): Promise<void> {
  if (rows.length === 0) return;
  const participantIds: string[] = [];
  const staffIds: string[] = [];
  const carerIds: string[] = [];
  const owners = new Map<string, AddressOwner>();
  for (const row of rows) {
    const owner = personKeyToOwner(row.id);
    if (!owner) continue;
    owners.set(row.id, owner);
    if (owner.kind === "participant") participantIds.push(owner.id);
    else if (owner.kind === "staff") staffIds.push(owner.id);
    else carerIds.push(owner.id);
  }

  const participantSelect = supabase
    .from("participant_attendance_schedules")
    .select("participant_id, inbound_address_id, outbound_address_id")
    .eq("day_of_week", input.dayCode)
    .eq("active", true)
    .in("participant_id", participantIds.length ? participantIds : ["00000000-0000-0000-0000-000000000000"]);

  const { data: participantRows, error: participantErr } = participantIds.length
    ? await participantSelect
    : { data: [], error: null };

  if (participantErr) {
    if (isSchemaMismatchError(participantErr)) return;
    throw new Error(participantErr.message);
  }

  let supportRows: ScheduleAddressRow[] = [];
  if (staffIds.length || carerIds.length) {
    const { data, error } = await supabase
      .from("support_attendance_schedules")
      .select("staff_id, carer_id, inbound_address_id, outbound_address_id")
      .eq("day_of_week", input.dayCode)
      .eq("active", true);
    if (error) {
      if (isSchemaMismatchError(error)) return;
      throw new Error(error.message);
    }
    supportRows = (data ?? []) as ScheduleAddressRow[];
  }

  const standingByOwner = new Map<string, string | null>();
  for (const raw of participantRows ?? []) {
    const row = raw as ScheduleAddressRow;
    if (!row.participant_id) continue;
    standingByOwner.set(`participant:${row.participant_id}`, standingId(row, input.direction));
  }
  for (const row of supportRows) {
    if (row.staff_id && staffIds.includes(row.staff_id)) {
      standingByOwner.set(`staff:${row.staff_id}`, standingId(row, input.direction));
    }
    if (row.carer_id && carerIds.includes(row.carer_id)) {
      standingByOwner.set(`carer:${row.carer_id}`, standingId(row, input.direction));
    }
  }

  const homes = await loadHomesForIds({ participantIds, staffIds, carerIds });
  const overrides = await loadDayOverrides(input.serviceDate, input.direction);
  const bookIds = [...standingByOwner.values()].filter((id): id is string => !!id);
  if (overrides) {
    for (const o of overrides) {
      if (o.address_id) bookIds.push(o.address_id);
    }
  }
  const book = await loadAddressBookEntries(bookIds);

  for (const row of rows) {
    const owner = owners.get(row.id);
    if (!owner) continue;
    const key = ownerKey(owner);
    const home = homes.get(key) ?? null;
    const placeId = standingByOwner.get(key) ?? null;
    let text = placeId ? book.get(placeId)?.address ?? home : home;
    if (overrides) {
      const hit = overrideFor(overrides, owner);
      if (hit) text = textFromOverride(hit, book, home);
    }
    row.address = text;
  }
}

/** This-date overlay on an already resolved standing address (events). */
export async function applyDayStopOverrides(
  rows: {
    id: string;
    address: string | null;
    participantId?: string | null;
    staffId?: string | null;
    carerId?: string | null;
  }[],
  serviceDate: string,
  direction: StopDirection,
): Promise<void> {
  if (rows.length === 0) return;
  const overrides = await loadDayOverrides(serviceDate, direction);
  if (!overrides || overrides.length === 0) return;
  const book = await loadAddressBookEntries(
    overrides.map((o) => o.address_id).filter((id): id is string => !!id),
  );
  const homes = await loadHomesForIds({
    participantIds: overrides.map((o) => o.participant_id).filter((id): id is string => !!id),
    staffIds: overrides.map((o) => o.staff_id).filter((id): id is string => !!id),
    carerIds: overrides.map((o) => o.carer_id).filter((id): id is string => !!id),
  });
  for (const row of rows) {
    const owner =
      ownerFromLeg({
        participantId: row.participantId,
        staffId: row.staffId,
        carerId: row.carerId,
      }) ?? personKeyToOwner(row.id);
    if (!owner) continue;
    const hit = overrideFor(overrides, owner);
    if (!hit) continue;
    const home = homes.get(ownerKey(owner)) ?? null;
    row.address = textFromOverride(hit, book, home);
  }
}

export async function setStandingStopAddress(input: {
  scheduleId: string;
  personKind: "participant" | "staff" | "volunteer" | "carer";
  direction: "morning" | "afternoon";
  addressId: string | null;
  dayOfWeek: string;
  personName: string;
  personId: string;
  placeLabel: string;
}): Promise<void> {
  const column = input.direction === "morning" ? "inbound_address_id" : "outbound_address_id";
  const table =
    input.personKind === "participant"
      ? "participant_attendance_schedules"
      : "support_attendance_schedules";
  if (input.addressId) {
    const ownerKind: AddressOwnerKind =
      input.personKind === "participant"
        ? "participant"
        : input.personKind === "carer"
          ? "carer"
          : "staff";
    const { data, error } = await supabase
      .from("person_addresses")
      .select("id, label")
      .eq("id", input.addressId)
      .eq(ownerColumn(ownerKind), input.personId)
      .is("archived_at", null)
      .maybeSingle();
    throwIfMissing(error);
    const place = data as { id: string; label: string } | null;
    if (!place) throw new Error("That place is not on this person’s address book.");
    input.placeLabel = (place.label ?? "").trim() || input.placeLabel;
  }
  const { error } = await supabase
    .from(table)
    .update({ [column]: input.addressId })
    .eq("id", input.scheduleId);
  throwIfMissing(error);

  const { recordRunPlanningChangeBestEffort, dayShortLabel } = await import(
    "@/lib/api/run-planning-changelog"
  );
  const dirLabel = input.direction === "morning" ? "morning pickup" : "afternoon drop-off";
  await recordRunPlanningChangeBestEffort({
    action: "updated",
    source: "run_order",
    personKind: input.personKind === "participant" ? "participant" : input.personKind,
    personId: input.personId,
    personName: input.personName,
    dayOfWeek: input.dayOfWeek,
    scheduleId: input.scheduleId,
    summary: `Changed ${input.personName} ${dayShortLabel(input.dayOfWeek)} ${dirLabel} to ${input.placeLabel}`,
    afterState: {
      direction: input.direction,
      addressId: input.addressId,
      placeLabel: input.placeLabel,
    },
  });
}

export async function upsertDayStopOverride(input: {
  serviceDate: string;
  direction: StopDirection;
  owner: AddressOwner;
  choice: StopAddressChoice;
  updatedByStaffId?: string | null;
}): Promise<string> {
  let addressId: string | null = null;
  let custom: string | null = null;
  let homeText: string | null = null;
  if (input.choice.mode === "home") {
    homeText = await loadHomeAddress(input.owner);
    if (!homeText) throw new Error("No home address on file.");
  } else if (input.choice.mode === "saved") {
    const { data, error } = await supabase
      .from("person_addresses")
      .select("id, address")
      .eq("id", input.choice.addressId)
      .eq(ownerColumn(input.owner.kind), input.owner.id)
      .is("archived_at", null)
      .maybeSingle();
    throwIfMissing(error);
    const row = data as { id: string; address: string } | null;
    if (!row) throw new Error("That place is not on this person’s address book.");
    addressId = row.id;
  } else if (input.choice.mode === "custom") {
    custom = input.choice.text.trim();
    if (!custom) throw new Error("Enter an address for today.");
  }

  const column = ownerColumn(input.owner.kind);
  const { data: existing, error: readErr } = await supabase
    .from("day_stop_address_overrides")
    .select("id")
    .eq("service_date", input.serviceDate)
    .eq("direction", input.direction)
    .eq(column, input.owner.id)
    .maybeSingle();
  throwIfMissing(readErr);

  const payload = {
    service_date: input.serviceDate,
    direction: input.direction,
    participant_id: input.owner.kind === "participant" ? input.owner.id : null,
    staff_id: input.owner.kind === "staff" ? input.owner.id : null,
    carer_id: input.owner.kind === "carer" ? input.owner.id : null,
    address_id: addressId,
    custom_address: custom,
    updated_at: operationalNowIso(),
    updated_by_staff_id: input.updatedByStaffId ?? null,
  };

  if (existing && (existing as { id: string }).id) {
    const { error } = await supabase
      .from("day_stop_address_overrides")
      .update(payload)
      .eq("id", (existing as { id: string }).id);
    throwIfMissing(error);
  } else {
    const { error } = await supabase.from("day_stop_address_overrides").insert(payload);
    throwIfMissing(error);
  }

  if (input.choice.mode === "home") return homeText!;
  if (input.choice.mode === "custom") return custom!;
  const book = await loadAddressBookEntries([addressId!]);
  const text = book.get(addressId!)?.address;
  if (!text) throw new Error("That place has no address.");
  return text;
}

export async function changePendingStopAddress(input: {
  tripId: string;
  legId: string;
  serviceDate: string;
  direction: StopDirection;
  owner: AddressOwner;
  personName: string;
  choice: StopAddressChoice;
  location: string;
  updatedByStaffId?: string | null;
}): Promise<void> {
  const { data: legRow, error: legErr } = await supabase
    .from("trip_legs")
    .select("id, status, to_participant_id, to_staff_id, to_carer_id, target_address")
    .eq("id", input.legId)
    .eq("trip_id", input.tripId)
    .maybeSingle();
  if (legErr) throw new Error(legErr.message);
  const leg = legRow as {
    status: string;
    to_participant_id: string | null;
    to_staff_id: string | null;
    to_carer_id: string | null;
    target_address: string | null;
  } | null;
  if (!leg) throw new Error("Stop not found.");
  if (leg.status !== "pending") throw new Error("Only a pending stop can change address.");
  const ownerOnLeg = ownerFromLeg({
    participantId: leg.to_participant_id,
    staffId: leg.to_staff_id,
    carerId: leg.to_carer_id,
  });
  if (!ownerOnLeg || ownerOnLeg.kind !== input.owner.kind || ownerOnLeg.id !== input.owner.id) {
    throw new Error("This stop is not that person’s pickup.");
  }

  const before = (leg.target_address ?? "").trim();
  const next = await upsertDayStopOverride({
    serviceDate: input.serviceDate,
    direction: input.direction,
    owner: input.owner,
    choice: input.choice,
    updatedByStaffId: input.updatedByStaffId,
  });

  const { error: patchErr } = await supabase
    .from("trip_legs")
    .update({ target_address: next, updated_at: operationalNowIso() })
    .eq("id", input.legId);
  if (patchErr) throw new Error(patchErr.message);

  const { rebuildTripPickupChain } = await import("@/lib/data-store");
  await rebuildTripPickupChain(input.tripId);

  const { writeToLedger } = await import("@/lib/api/ledger");
  const { withAuditActorMeta, resolveAuditActor } = await import("@/lib/api/office-change-log");
  const actor = await resolveAuditActor();
  const summary = `${actor.name} changed ${input.personName}'s stop to ${next} for this run only`;
  const metadata = await withAuditActorMeta({
    summary,
    person_name: input.personName,
    location: input.location,
    before_address: before || null,
    after_address: next,
    service_date: input.serviceDate,
    direction: input.direction,
    trip_id: input.tripId,
  });
  await writeToLedger({
    actionType: "STOP_ADDRESS_CHANGED",
    severity: "INFO",
    category: "TRIP",
    staff_id: actor.staffId ?? undefined,
    metadata,
  });
}
