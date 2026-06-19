// Live data layer backed by the external Supabase instance.
// Strict mapping to the deployed Oceania (Sydney) schema — do not add columns
// that aren't listed in the table definitions below.
//
// participants:
//   id, first_name, last_name, ndis_number, iddsi_level_liquids,
//   iddsi_level_solids, dual_witness_pin_hash, created_at, updated_at
//
// offline_sync_logs:
//   id, driver_or_staff_id, device_uuid, action_type, payload (jsonb),
//   synced_at, created_at
import { supabase, supabaseUrl } from "@/integrations/supabase/client";

export interface Participant {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string; // derived: `${firstName} ${lastName}`.trim()
  ndisNumber: string;
  streetAddress: string | null;
  /** Coordinator-managed permanent pickup address, used by the manifest engine
   * unless a per-event override is set on the booking. */
  regularPickupAddress: string | null;
  iddsi: { liquids: number; foods: number };
  dualWitnessPinHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TransportStatus = "En route" | "Arrived" | "No-show";

// JSONB payload shape persisted in offline_sync_logs.payload for transport
// actions. Keep keys snake_case so they match what downstream consumers
// (reports, BI) will see in the JSONB column.
export interface TransportPayload {
  participant_id: string;
  pickup_odometer: number;
  dropoff_odometer: number;
  passenger_present: boolean;
  status: TransportStatus;
  notes: string;
  timestamp: string;
}

export interface SyncLog {
  id: string;
  driverOrStaffId: string | null;
  deviceUuid: string;
  actionType: string;
  payload: Record<string, unknown>;
  syncedAt: string | null;
  createdAt: string;
}

export type SyncItemType =
  | "participant_update"
  | "transport_log"
  | "iddsi_change"
  | "medication_log"
  | "attendance_log";

export interface MedicationLogPayload {
  participant_id: string;
  action_performed: "MEDICATION_ADMIN";
  witness_1_identity: string;
  witness_2_identity: string;
  timestamp: string;
  metadata: {
    medication_name: string;
    dosage: string;
    notes: string;
    witness_1_pin_hash: string;
    witness_2_pin_hash: string;
    network_state: "online" | "offline";
    device_uuid: string;
  };
}

// Static staff directory used by the dual-witness sign-off selectors.
// Persisted alongside the medication log as `witness_*_identity`.
export const STAFF_DIRECTORY: Array<{ id: string; name: string; role: string }> = [
  { id: "staff-001", name: "Sarah Chen", role: "Registered Nurse" },
  { id: "staff-002", name: "Marcus Webb", role: "Care Coordinator" },
  { id: "staff-003", name: "Priya Natarajan", role: "Senior Support Worker" },
  { id: "staff-004", name: "Jordan Ellis", role: "Support Worker" },
  { id: "staff-005", name: "Amelia Hart", role: "Clinical Lead" },
  { id: "guardian-001", name: "Family Guardian (on-site)", role: "Guardian" },
];
export type SyncStatus = "pending" | "retrying" | "failed" | "synced";

export interface SyncQueueItem {
  id: string;
  type: SyncItemType;
  createdAt: string;
  status: SyncStatus;
  attempts: number;
  payload: Record<string, unknown>;
  error?: string;
}

// ---------- device / staff identity ----------

const DEVICE_KEY = "yada.deviceUuid.v1";
const STAFF_KEY = "yada.staffId.v1";

export const DEFAULT_STAFF_UUID = "00000000-0000-0000-0000-000000000000";
export const DEFAULT_DEVICE_UUID = "browser-client";

export function getDeviceUuid(): string {
  if (typeof localStorage === "undefined") return DEFAULT_DEVICE_UUID;
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    try {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    } catch {
      return DEFAULT_DEVICE_UUID;
    }
  }
  return id || DEFAULT_DEVICE_UUID;
}

export function getStaffId(): string {
  if (typeof localStorage === "undefined") return DEFAULT_STAFF_UUID;
  return localStorage.getItem(STAFF_KEY) || DEFAULT_STAFF_UUID;
}

// ---------- row mappers ----------

interface ParticipantRow {
  id: string;
  first_name: string;
  last_name: string;
  ndis_number: string;
  street_address: string | null;
  regular_pickup_address: string | null;
  iddsi_level_liquids: number | null;
  iddsi_level_solids: number | null;
  dual_witness_pin_hash: string | null;
  created_at: string;
  updated_at: string;
}

function rowToParticipant(r: ParticipantRow): Participant {
  return {
    id: r.id,
    firstName: r.first_name ?? "",
    lastName: r.last_name ?? "",
    fullName: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
    ndisNumber: r.ndis_number,
    streetAddress: r.street_address ?? null,
    regularPickupAddress: r.regular_pickup_address ?? null,
    iddsi: {
      liquids: r.iddsi_level_liquids ?? 0,
      foods: r.iddsi_level_solids ?? 7,
    },
    dualWitnessPinHash: r.dual_witness_pin_hash,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface SyncLogRow {
  id: string;
  driver_or_staff_id: string | null;
  device_uuid: string;
  action_type: string;
  payload: Record<string, unknown> | null;
  synced_at: string | null;
  created_at: string;
}

function rowToSyncLog(r: SyncLogRow): SyncLog {
  return {
    id: r.id,
    driverOrStaffId: r.driver_or_staff_id,
    deviceUuid: r.device_uuid,
    actionType: r.action_type,
    payload: r.payload ?? {},
    syncedAt: r.synced_at,
    createdAt: r.created_at,
  };
}

// ---------- participants ----------

export async function listParticipants(): Promise<Participant[]> {
  const { data, error } = await supabase
    .from("participants")
    .select("*")
    .order("last_name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToParticipant);
}

export interface ParticipantPatch {
  firstName?: string;
  lastName?: string;
  ndisNumber?: string;
  streetAddress?: string | null;
  regularPickupAddress?: string | null;
  iddsi?: { liquids: number; foods: number };
  dualWitnessPinHash?: string | null;
}

export interface NewParticipant {
  firstName: string;
  lastName: string;
  ndisNumber: string;
  streetAddress?: string | null;
  regularPickupAddress?: string | null;
  iddsi: { liquids: number; foods: number };
  dualWitnessPinHash?: string | null;
}

export async function insertParticipant(input: NewParticipant): Promise<Participant> {
  const row = {
    first_name: input.firstName,
    last_name: input.lastName,
    ndis_number: input.ndisNumber,
    street_address: input.streetAddress ?? null,
    regular_pickup_address: input.regularPickupAddress ?? null,
    iddsi_level_liquids: input.iddsi.liquids,
    iddsi_level_solids: input.iddsi.foods,
    dual_witness_pin_hash: input.dualWitnessPinHash ?? null,
  };
  const { data, error } = await supabase
    .from("participants")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return rowToParticipant(data as ParticipantRow);
}

export async function updateParticipant(
  id: string,
  patch: ParticipantPatch,
): Promise<Participant> {
  const row: Partial<ParticipantRow> = {};
  if (patch.firstName !== undefined) row.first_name = patch.firstName;
  if (patch.lastName !== undefined) row.last_name = patch.lastName;
  if (patch.ndisNumber !== undefined) row.ndis_number = patch.ndisNumber;
  if (patch.streetAddress !== undefined) row.street_address = patch.streetAddress;
  if (patch.regularPickupAddress !== undefined)
    row.regular_pickup_address = patch.regularPickupAddress;
  if (patch.iddsi !== undefined) {
    row.iddsi_level_liquids = patch.iddsi.liquids;
    row.iddsi_level_solids = patch.iddsi.foods;
  }
  if (patch.dualWitnessPinHash !== undefined) row.dual_witness_pin_hash = patch.dualWitnessPinHash;

  const { data, error } = await supabase
    .from("participants")
    .update(row)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return rowToParticipant(data as ParticipantRow);
}

// ---------- offline_sync_logs ----------

export async function listSyncLogs(): Promise<SyncLog[]> {
  const { data, error } = await supabase
    .from("offline_sync_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map(rowToSyncLog);
}

export interface NewSyncLog {
  actionType: string;
  payload: Record<string, unknown>;
  driverOrStaffId?: string | null;
  deviceUuid?: string;
  synced?: boolean;
}

export async function insertSyncLog(log: NewSyncLog): Promise<SyncLog> {
  // Hard guard: action_type is NOT NULL on offline_sync_logs. Refuse a
  // malformed envelope here instead of letting Postgres return 400 and
  // poison whichever transaction triggered the background log.
  const actionType = (log.actionType ?? "").trim();
  if (!actionType) {
    throw new Error("insertSyncLog: actionType is required (offline_sync_logs.action_type NOT NULL).");
  }
  const { data, error } = await supabase
    .from("offline_sync_logs")
    .insert({
      driver_or_staff_id: log.driverOrStaffId || getStaffId() || DEFAULT_STAFF_UUID,
      device_uuid: log.deviceUuid || getDeviceUuid() || DEFAULT_DEVICE_UUID,
      action_type: actionType,
      payload: log.payload ?? {},
      synced_at: log.synced === false ? null : new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw error;
  return rowToSyncLog(data as SyncLogRow);
}

// ---------- compliance_audit_logs ----------

export async function insertComplianceLog(payload: MedicationLogPayload): Promise<void> {
  const { error } = await supabase.from("compliance_audit_logs").insert({
    participant_id: payload.participant_id,
    action_performed: payload.action_performed,
    witness_1_identity: payload.witness_1_identity,
    witness_2_identity: payload.witness_2_identity,
    timestamp: payload.timestamp,
    metadata: payload.metadata,
  });
  if (error) throw error;
}

export interface QuickMedicationLog {
  participantId: string;
  scheduleId: string;
  medicationName: string;
  dosage: string;
  scheduledTime: string;
  witnessIdentity: string;
}

/** Lightweight 1-tap administration log written from the dashboard widget. */
export async function insertQuickAdministrationLog(input: QuickMedicationLog): Promise<void> {
  const { error } = await supabase.from("compliance_audit_logs").insert({
    participant_id: input.participantId,
    action_performed: "MEDICATION_ADMIN_QUICK",
    witness_1_identity: input.witnessIdentity,
    witness_2_identity: null,
    timestamp: new Date().toISOString(),
    metadata: {
      medication_name: input.medicationName,
      dosage: input.dosage,
      scheduled_time: input.scheduledTime,
      schedule_id: input.scheduleId,
      source: "dashboard_widget",
      device_uuid: getDeviceUuid(),
    },
  });
  if (error) throw error;
}

export type AdministrationStatus = "Administered" | "Refused" | "Missed";

export interface DualWitnessAdministration {
  scheduleId: string;
  participantId: string;
  medicationName: string;
  dosage: string;
  scheduledTime: string;
  administeredById: string;
  administeredByName: string;
  witnessedById: string;
  witnessedByName: string;
  status: AdministrationStatus;
  notes?: string;
}

/**
 * Dual-witness "Give Dose" sign-off written from the Care Profile modal.
 * Lands in compliance_audit_logs so the dashboard widget + Care History tab
 * share one source of truth — no separate medication_administration_log
 * table is provisioned.
 */
export async function insertDualWitnessAdministrationLog(
  input: DualWitnessAdministration,
): Promise<void> {
  const { error } = await supabase.from("compliance_audit_logs").insert({
    participant_id: input.participantId,
    action_performed: "MEDICATION_ADMIN_DUAL",
    witness_1_identity: input.administeredByName,
    witness_2_identity: input.witnessedByName,
    timestamp: new Date().toISOString(),
    metadata: {
      schedule_id: input.scheduleId,
      medication_name: input.medicationName,
      dosage: input.dosage,
      scheduled_time: input.scheduledTime,
      administered_by_id: input.administeredById,
      witnessed_by_id: input.witnessedById,
      status: input.status,
      notes: input.notes ?? null,
      source: "care_profile_give_dose",
      device_uuid: getDeviceUuid(),
    },
  });
  if (error) throw error;
}


/** SHA-256 hash → hex (browser only). Never store the raw PIN. */
export async function hashPin(pin: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) return `plain:${pin}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------- staff_registry ----------

export interface StaffCertification {
  name: string;
  number: string;
  expiry: string | null; // ISO yyyy-mm-dd
}

export interface StaffMember {
  id: string;
  fullName: string;
  role: string | null;
  pinHash: string | null;
  phone: string | null;
  email: string | null;
  streetAddress: string | null;
  personnelType: string | null;
  active: boolean;
  notes: string | null;
  certifications: StaffCertification[];
  createdAt: string | null;
}

interface StaffRow {
  id: string;
  full_name: string;
  role: string | null;
  pin_hash: string | null;
  phone: string | null;
  email: string | null;
  street_address: string | null;
  personnel_type: string | null;
  active: boolean | null;
  notes: string | null;
  certifications: unknown;
  created_at: string | null;
}

function rowToStaff(r: StaffRow): StaffMember {
  const certs = Array.isArray(r.certifications) ? (r.certifications as StaffCertification[]) : [];
  return {
    id: r.id,
    fullName: r.full_name,
    role: r.role,
    pinHash: r.pin_hash,
    phone: r.phone,
    email: r.email,
    streetAddress: r.street_address,
    personnelType: r.personnel_type,
    active: r.active ?? true,
    notes: r.notes,
    certifications: certs.map((c) => ({
      name: c?.name ?? "",
      number: c?.number ?? "",
      expiry: c?.expiry ?? null,
    })),
    createdAt: r.created_at,
  };
}

const STAFF_COLS =
  "id, full_name, role, pin_hash, phone, email, street_address, personnel_type, active, notes, certifications, created_at";

export async function listStaffRegistry(): Promise<StaffMember[]> {
  const { data, error } = await supabase
    .from("staff_registry")
    .select(STAFF_COLS)
    .order("full_name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => rowToStaff(r as StaffRow));
}

export interface StaffPayload {
  fullName: string;
  role: string | null;
  personnelType: string | null;
  phone: string | null;
  email: string | null;
  streetAddress: string | null;
  active: boolean;
  notes: string | null;
  certifications: StaffCertification[];
}

function staffPayloadToRow(p: StaffPayload) {
  return {
    full_name: p.fullName,
    role: p.role,
    personnel_type: p.personnelType,
    phone: p.phone,
    email: p.email,
    street_address: p.streetAddress,
    active: p.active,
    notes: p.notes,
    certifications: p.certifications,
  };
}

export async function insertStaffMember(p: StaffPayload): Promise<StaffMember> {
  const { data, error } = await supabase
    .from("staff_registry")
    .insert(staffPayloadToRow(p))
    .select(STAFF_COLS)
    .single();
  if (error) throw error;
  return rowToStaff(data as StaffRow);
}

export async function updateStaffMember(id: string, p: StaffPayload): Promise<StaffMember> {
  const { data, error } = await supabase
    .from("staff_registry")
    .update(staffPayloadToRow(p))
    .eq("id", id)
    .select(STAFF_COLS)
    .single();
  if (error) throw error;
  return rowToStaff(data as StaffRow);
}

// ---------- carers_registry ----------

export interface Carer {
  id: string;
  participantId: string | null;
  fullName: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  streetAddress: string | null;
  isPrimaryContact: boolean;
  notes: string | null;
  createdAt: string | null;
}

interface CarerRow {
  id: string;
  participant_id: string | null;
  full_name: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  street_address: string | null;
  is_primary_contact: boolean | null;
  notes: string | null;
  created_at: string | null;
}

function rowToCarer(r: CarerRow): Carer {
  return {
    id: r.id,
    participantId: r.participant_id,
    fullName: r.full_name,
    relationship: r.relationship,
    phone: r.phone,
    email: r.email,
    streetAddress: r.street_address,
    isPrimaryContact: r.is_primary_contact ?? false,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

export async function listCarersRegistry(): Promise<Carer[]> {
  const { data, error } = await supabase
    .from("carers_registry")
    .select("*")
    .order("full_name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => rowToCarer(r as CarerRow));
}

export async function listCarersForParticipant(participantId: string): Promise<Carer[]> {
  const { data, error } = await supabase
    .from("carers_registry")
    .select("*")
    .eq("participant_id", participantId)
    .order("is_primary_contact", { ascending: false })
    .order("full_name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => rowToCarer(r as CarerRow));
}

export async function getPrimaryCarer(participantId: string): Promise<Carer | null> {
  const { data, error } = await supabase
    .from("carers_registry")
    .select("*")
    .eq("participant_id", participantId)
    .eq("is_primary_contact", true)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToCarer(data as CarerRow) : null;
}

export interface CarerPayload {
  participantId: string | null;
  fullName: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  streetAddress: string | null;
  isPrimaryContact: boolean;
  notes: string | null;
}

function carerPayloadToRow(p: CarerPayload) {
  return {
    participant_id: p.participantId,
    full_name: p.fullName,
    relationship: p.relationship,
    phone: p.phone,
    email: p.email,
    street_address: p.streetAddress,
    is_primary_contact: p.isPrimaryContact,
    notes: p.notes,
  };
}

export async function insertCarer(p: CarerPayload): Promise<Carer> {
  const { data, error } = await supabase
    .from("carers_registry")
    .insert(carerPayloadToRow(p))
    .select("*")
    .single();
  if (error) throw error;
  return rowToCarer(data as CarerRow);
}

export async function updateCarer(id: string, p: CarerPayload): Promise<Carer> {
  const { data, error } = await supabase
    .from("carers_registry")
    .update(carerPayloadToRow(p))
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return rowToCarer(data as CarerRow);
}

/**
 * Upsert the primary emergency carer for a participant. Demotes any existing
 * primary first so the partial unique index is respected, then updates the
 * oldest carer row in place or inserts a new one when none exists yet.
 */
export async function upsertPrimaryCarer(
  participantId: string,
  payload: Omit<CarerPayload, "participantId" | "isPrimaryContact">,
): Promise<Carer> {
  const { error: demoteErr } = await supabase
    .from("carers_registry")
    .update({ is_primary_contact: false })
    .eq("participant_id", participantId)
    .eq("is_primary_contact", true);
  if (demoteErr) throw demoteErr;

  const { data: existingRows, error: lookupErr } = await supabase
    .from("carers_registry")
    .select("id")
    .eq("participant_id", participantId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (lookupErr) throw lookupErr;

  const row = {
    participant_id: participantId,
    full_name: payload.fullName,
    relationship: payload.relationship,
    phone: payload.phone,
    email: payload.email,
    street_address: payload.streetAddress,
    is_primary_contact: true,
    notes: payload.notes,
  };

  if (existingRows && existingRows.length > 0) {
    const { data, error } = await supabase
      .from("carers_registry")
      .update(row)
      .eq("id", existingRows[0].id)
      .select("*")
      .single();
    if (error) throw error;
    return rowToCarer(data as CarerRow);
  }

  const { data, error } = await supabase
    .from("carers_registry")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return rowToCarer(data as CarerRow);
}

/**
 * Atomically promote a single carer row to primary contact for a participant.
 * Demotes every other row for the same participant first so the partial unique
 * index `(participant_id) WHERE is_primary_contact` is respected. Also ensures
 * the target carer row is linked to this participant.
 */
export async function setPrimaryCarer(carerId: string, participantId: string): Promise<Carer> {
  const { error: demoteErr } = await supabase
    .from("carers_registry")
    .update({ is_primary_contact: false })
    .eq("participant_id", participantId)
    .neq("id", carerId);
  if (demoteErr) throw demoteErr;

  const { data, error } = await supabase
    .from("carers_registry")
    .update({ is_primary_contact: true, participant_id: participantId })
    .eq("id", carerId)
    .select("*")
    .single();
  if (error) throw error;
  return rowToCarer(data as CarerRow);
}

/** Demote a carer to secondary (no other side-effects). */
export async function demoteCarer(carerId: string): Promise<Carer> {
  const { data, error } = await supabase
    .from("carers_registry")
    .update({ is_primary_contact: false })
    .eq("id", carerId)
    .select("*")
    .single();
  if (error) throw error;
  return rowToCarer(data as CarerRow);
}

/** Attach an existing carer record to a participant (secondary by default). */
export async function linkCarerToParticipant(carerId: string, participantId: string): Promise<Carer> {
  const { data, error } = await supabase
    .from("carers_registry")
    .update({ participant_id: participantId })
    .eq("id", carerId)
    .select("*")
    .single();
  if (error) throw error;
  return rowToCarer(data as CarerRow);
}

/** Unlink a carer from its participant and demote in the same write. */
export async function unlinkCarer(carerId: string): Promise<Carer> {
  const { data, error } = await supabase
    .from("carers_registry")
    .update({ participant_id: null, is_primary_contact: false })
    .eq("id", carerId)
    .select("*")
    .single();
  if (error) throw error;
  return rowToCarer(data as CarerRow);
}





// ---------- participant_medication_schedules ----------

export interface MedicationSchedule {
  id: string;
  participantId: string | null;
  medicationName: string;
  dosage: string;
  expectedTime: string; // "HH:MM:SS"
  frequency: string;
  active: boolean;
  createdAt: string;
}

interface ScheduleRow {
  id: string;
  participant_id: string | null;
  medication_name: string;
  dosage: string;
  expected_time: string;
  frequency: string;
  active: boolean;
  created_at: string;
}

function rowToSchedule(r: ScheduleRow): MedicationSchedule {
  return {
    id: r.id,
    participantId: r.participant_id,
    medicationName: r.medication_name,
    dosage: r.dosage,
    expectedTime: r.expected_time,
    frequency: r.frequency,
    active: r.active,
    createdAt: r.created_at,
  };
}

export async function listSchedulesForParticipant(
  participantId: string,
): Promise<MedicationSchedule[]> {
  const { data, error } = await supabase
    .from("participant_medication_schedules")
    .select("*")
    .eq("participant_id", participantId)
    .order("expected_time", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToSchedule);
}

export async function listAllActiveSchedules(): Promise<MedicationSchedule[]> {
  const { data, error } = await supabase
    .from("participant_medication_schedules")
    .select("*")
    .eq("active", true);
  if (error) throw error;
  return (data ?? []).map(rowToSchedule);
}

export interface NewSchedule {
  participantId: string;
  medicationName: string;
  dosage: string;
  expectedTime: string; // "HH:MM"
  frequency: string;
}

export async function insertSchedule(input: NewSchedule): Promise<MedicationSchedule> {
  const { data, error } = await supabase
    .from("participant_medication_schedules")
    .insert({
      participant_id: input.participantId,
      medication_name: input.medicationName,
      dosage: input.dosage,
      expected_time: input.expectedTime.length === 5 ? `${input.expectedTime}:00` : input.expectedTime,
      frequency: input.frequency,
      active: true,
    })
    .select("*")
    .single();
  if (error) throw error;
  return rowToSchedule(data as ScheduleRow);
}

// ---------- compliance_audit_logs reads ----------

export interface ComplianceLog {
  id: string;
  participantId: string | null;
  actionPerformed: string;
  witness1: string | null;
  witness2: string | null;
  timestamp: string;
  metadata: Record<string, unknown>;
}

interface ComplianceLogRow {
  id: string;
  participant_id: string | null;
  action_performed: string;
  witness_1_identity: string | null;
  witness_2_identity: string | null;
  timestamp: string;
  metadata: Record<string, unknown> | null;
}

function rowToComplianceLog(r: ComplianceLogRow): ComplianceLog {
  return {
    id: r.id,
    participantId: r.participant_id,
    actionPerformed: r.action_performed,
    witness1: r.witness_1_identity,
    witness2: r.witness_2_identity,
    timestamp: r.timestamp,
    metadata: r.metadata ?? {},
  };
}

export async function listComplianceLogsForParticipant(
  participantId: string,
): Promise<ComplianceLog[]> {
  const { data, error } = await supabase
    .from("compliance_audit_logs")
    .select("*")
    .eq("participant_id", participantId)
    .order("timestamp", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map(rowToComplianceLog);
}

export async function listTodaysComplianceLogs(): Promise<ComplianceLog[]> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const { data, error } = await supabase
    .from("compliance_audit_logs")
    .select("*")
    .gte("timestamp", since.toISOString())
    .limit(1000);
  if (error) throw error;
  return (data ?? []).map(rowToComplianceLog);
}


// ---------- participant_attendance_schedules ----------
//
// Baseline operational schedule rules. Each row defines one recurring
// weekday/service pairing (e.g. Tuesday / Center Day Care / Bus Pickup).

export type WeekDay =
  | "Monday" | "Tuesday" | "Wednesday" | "Thursday"
  | "Friday" | "Saturday" | "Sunday";

export const WEEK_DAYS: WeekDay[] = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
];

export interface AttendanceSchedule {
  id: string;
  participantId: string;
  dayOfWeek: WeekDay;
  serviceType: string;
  transportRule: string;
  active: boolean;
  createdAt: string;
}

interface AttendanceScheduleRow {
  id: string;
  participant_id: string;
  day_of_week: string;
  service_type: string;
  transport_required: string;
  active: boolean;
  created_at: string;
}

function rowToAttendanceSchedule(r: AttendanceScheduleRow): AttendanceSchedule {
  return {
    id: r.id,
    participantId: r.participant_id,
    dayOfWeek: r.day_of_week as WeekDay,
    serviceType: r.service_type,
    transportRule: r.transport_required,
    active: r.active,
    createdAt: r.created_at,
  };
}

export async function listAttendanceSchedules(
  participantId: string,
): Promise<AttendanceSchedule[]> {
  const { data, error } = await supabase
    .from("participant_attendance_schedules")
    .select("*")
    .eq("participant_id", participantId);
  if (error) throw error;
  const rows = (data ?? []).map(rowToAttendanceSchedule);
  rows.sort((a, b) => dayChronoIndex(a.dayOfWeek) - dayChronoIndex(b.dayOfWeek));
  return rows;
}

export interface NewAttendanceSchedule {
  participantId: string;
  dayOfWeek: WeekDay;
  serviceType: string;
  transportRule: string;
}

export async function insertAttendanceSchedule(
  input: NewAttendanceSchedule,
): Promise<AttendanceSchedule> {
  const payload = {
    participant_id: input.participantId,
    day_of_week: input.dayOfWeek,
    service_type: input.serviceType,
    transport_required: input.transportRule,
    active: true,
  };
  const { data, error } = await supabase
    .from("participant_attendance_schedules")
    .insert(payload)
    .select("*")
    .single();
  if (error) {
    console.error("[insertAttendanceSchedule] supabase error", { error, payload });
    throw new Error(error.message || "Unknown Supabase error");
  }
  return rowToAttendanceSchedule(data as AttendanceScheduleRow);
}


// ---------- attendance_roster_logs ----------

export type AttendanceStatus =
  | "Pending" | "Attended" | "No-Show" | "Cancelled" | "Sick" | "Suspended";

export const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  "Pending", "Attended", "No-Show", "Cancelled", "Sick", "Suspended",
];

/** Statuses that should auto-cancel any chargeable ledger entry for that day. */
export const NON_CHARGEABLE_STATUSES: AttendanceStatus[] = [
  "Sick", "Cancelled", "Suspended", "No-Show",
];

export interface AttendanceLog {
  id: string;
  participantId: string;
  scheduleId: string | null;
  rosterDate: string;
  expectedService: string;
  actualStatus: AttendanceStatus;
  driverNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AttendanceLogRow {
  id: string;
  participant_id: string;
  schedule_id: string | null;
  roster_date: string;
  expected_service: string;
  actual_status: string;
  driver_notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToAttendanceLog(r: AttendanceLogRow): AttendanceLog {
  return {
    id: r.id,
    participantId: r.participant_id,
    scheduleId: r.schedule_id,
    rosterDate: r.roster_date,
    expectedService: r.expected_service,
    actualStatus: (r.actual_status as AttendanceStatus) ?? "Pending",
    driverNotes: r.driver_notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listAttendanceLogs(
  participantId: string,
): Promise<AttendanceLog[]> {
  const { data, error } = await supabase
    .from("attendance_roster_logs")
    .select("*")
    .eq("participant_id", participantId)
    .order("roster_date", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map(rowToAttendanceLog);
}

export interface AttendanceLogPatch {
  actualStatus?: AttendanceStatus;
  driverNotes?: string | null;
}

export async function updateAttendanceLog(
  id: string,
  patch: AttendanceLogPatch,
): Promise<AttendanceLog> {
  const row: Partial<AttendanceLogRow> = {};
  if (patch.actualStatus !== undefined) row.actual_status = patch.actualStatus;
  if (patch.driverNotes !== undefined) row.driver_notes = patch.driverNotes;
  const { data, error } = await supabase
    .from("attendance_roster_logs")
    .update(row)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return rowToAttendanceLog(data as AttendanceLogRow);
}

/**
 * JSONB envelope sent to offline_sync_logs.payload with
 * action_type = 'ATTENDANCE_LOG'. Mirrors the medication shape so downstream
 * BI / replay consumers see one canonical structure.
 */
export interface AttendanceSyncPayload {
  attendance_log_id: string;
  participant_id: string;
  roster_date: string;
  expected_service: string;
  patch: {
    actual_status?: AttendanceStatus;
    driver_notes?: string | null;
  };
  network_state: "online" | "offline";
  device_uuid: string;
  timestamp: string;
}

// ---------- system_lookup_parameters ----------
//
// CRITICAL: every operational dropdown (service types, transport options,
// financial codes, etc.) MUST hydrate from this table. Hardcoded string
// arrays in components are forbidden — see `.lovable/plan.md` §6.
//
//   id, category, code, display_name

export interface LookupParameter {
  id: string;
  category: string;
  code: string;
  /** Human-readable label sourced from `display_name` in Supabase. */
  displayName: string;
  /** Optional explicit chronological/priority ordering from `sort_order`. */
  sortOrder: number | null;
}

interface LookupRow {
  id: string;
  category: string;
  code: string;
  display_name: string | null;
  sort_order: number | null;
}

const DAY_ORDER: Record<string, number> = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
  friday: 5, saturday: 6, sunday: 7,
};

export function dayChronoIndex(value: string | null | undefined): number {
  if (!value) return 99;
  return DAY_ORDER[value.trim().toLowerCase()] ?? 99;
}

export async function listLookupParameters(
  category: string,
): Promise<LookupParameter[]> {
  const base = supabase
    .from("system_lookup_parameters")
    .select("id, category, code, display_name, sort_order")
    .eq("category", category);

  const { data, error } =
    category === "operating_days"
      ? await base
          .order("sort_order", { ascending: true, nullsFirst: false })
          .order("display_name", { ascending: true })
      : await base.order("display_name", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []).map((r: LookupRow) => ({
    id: r.id,
    category: r.category,
    code: r.code,
    displayName: r.display_name ?? r.code,
    sortOrder: r.sort_order ?? null,
  }));
  if (category === "operating_days") {
    rows.sort((a, b) => {
      const ai = a.sortOrder ?? dayChronoIndex(a.code || a.displayName);
      const bi = b.sortOrder ?? dayChronoIndex(b.code || b.displayName);
      return ai - bi;
    });
  }
  return rows;
}

export async function insertLookupParameter(input: {
  category: string;
  code: string;
  displayName: string;
}): Promise<LookupParameter> {
  const { data, error } = await supabase
    .from("system_lookup_parameters")
    .insert({
      category: input.category,
      code: input.code,
      display_name: input.displayName,
    })
    .select("id, category, code, display_name, sort_order")
    .single();
  if (error) throw error;
  const r = data as LookupRow;
  return {
    id: r.id,
    category: r.category,
    code: r.code,
    displayName: r.display_name ?? r.code,
    sortOrder: r.sort_order ?? null,
  };
}

export async function deleteLookupParameter(id: string): Promise<void> {
  const { error } = await supabase
    .from("system_lookup_parameters")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

/**
 * Canonical lookup categories used across the app. Add new strings here
 * before reading them so the grep surface is one file. Values match the
 * `category` column in `system_lookup_parameters`.
 */
export const LOOKUP_CATEGORIES = {
  serviceType: "service_types",
  transportRule: "transport_types",
  transportOption: "transport_types",
  financialCode: "financial_codes",
  operatingDay: "operating_days",
  eventType: "event_types",
} as const;


/**
 * Surface every category in the Admin Configuration workspace so coordinators
 * can toggle entries (e.g. Saturday / Sunday under `operating_days`) globally.
 */
export const ADMIN_LOOKUP_CATEGORIES: ReadonlyArray<{
  category: string;
  label: string;
  description: string;
}> = [
  {
    category: LOOKUP_CATEGORIES.operatingDay,
    label: "Operating days",
    description:
      "Calendar days the centre operates. Add Saturday/Sunday to open weekend rosters.",
  },
  {
    category: LOOKUP_CATEGORIES.serviceType,
    label: "Service types",
    description: "Programmes offered (Centre Day Care, Community Access, …).",
  },
  {
    category: LOOKUP_CATEGORIES.transportRule,
    label: "Transport types",
    description: "Transport options drivers can attach to a schedule.",
  },
  {
    category: LOOKUP_CATEGORIES.financialCode,
    label: "Financial codes",
    description: "Billable item codes used in the ledger module.",
  },
  {
    category: LOOKUP_CATEGORIES.eventType,
    label: "Event types",
    description: "Categories powering the Event Management dashboard (Fundraiser, Workshop, …).",
  },
];




// ---------- attendance_roster_logs writes ----------

export interface NewAttendanceLog {
  participantId: string;
  scheduleId?: string | null;
  rosterDate: string;            // YYYY-MM-DD
  expectedService: string;
  actualStatus: AttendanceStatus;
  driverNotes?: string | null;
}

export async function insertAttendanceLog(
  input: NewAttendanceLog,
): Promise<AttendanceLog> {
  const { data, error } = await supabase
    .from("attendance_roster_logs")
    .insert({
      participant_id: input.participantId,
      schedule_id: input.scheduleId ?? null,
      roster_date: input.rosterDate,
      expected_service: input.expectedService,
      actual_status: input.actualStatus,
      driver_notes: input.driverNotes ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return rowToAttendanceLog(data as AttendanceLogRow);
}

// ---------- daily roster engine ----------
//
// Expands recurring `participant_attendance_schedules` rows for a given date
// and overlays any single-day exception entries from `attendance_roster_logs`.
// Critical contract: temporary changes (sick, cancelled) NEVER mutate the
// recurring schedule — they're written as date-scoped log rows here, so the
// participant auto-reverts to their baseline next week.

const WEEKDAY_INDEX: Record<WeekDay, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
  Thursday: 4, Friday: 5, Saturday: 6,
};

export interface RosterEntry {
  schedule: AttendanceSchedule;
  date: string;                    // YYYY-MM-DD
  expectedService: string;
  /** Effective status: 'Pending' until an exception/actual log overrides. */
  effectiveStatus: AttendanceStatus;
  exceptionLog: AttendanceLog | null;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function resolveDailyRoster(
  schedules: AttendanceSchedule[],
  logs: AttendanceLog[],
  date: Date,
): RosterEntry[] {
  const dow = date.getDay();
  const day = isoDate(date);
  const todays = schedules.filter(
    (s) => s.active && WEEKDAY_INDEX[s.dayOfWeek] === dow,
  );
  return todays.map((s) => {
    const exception =
      logs.find(
        (l) =>
          l.participantId === s.participantId &&
          l.rosterDate === day &&
          (l.scheduleId === s.id || l.scheduleId === null) &&
          l.expectedService === s.serviceType,
      ) ?? null;
    return {
      schedule: s,
      date: day,
      expectedService: s.serviceType,
      effectiveStatus: exception?.actualStatus ?? "Pending",
      exceptionLog: exception,
    };
  });
}

// ---------- participant_financial_ledger ----------
//
// Running NDIS / fee statement per participant. Positive amounts are
// charges raised against the participant; negative amounts are payments,
// credits, or reconciliations against earlier charges.
//
//   id, participant_id, transaction_date, financial_code, description,
//   amount (numeric), is_reconciled (bool), created_at

export interface LedgerEntry {
  id: string;
  participantId: string;
  transactionDate: string;      // YYYY-MM-DD
  financialCode: string;
  description: string;
  amount: number;
  isReconciled: boolean;
  createdAt: string;
}

interface LedgerRow {
  id: string;
  participant_id: string;
  transaction_date: string;
  financial_code: string;
  description: string | null;
  amount: number | string;
  is_reconciled: boolean | null;
  created_at: string;
}

function rowToLedgerEntry(r: LedgerRow): LedgerEntry {
  return {
    id: r.id,
    participantId: r.participant_id,
    transactionDate: r.transaction_date,
    financialCode: r.financial_code,
    description: r.description ?? "",
    amount: typeof r.amount === "string" ? Number(r.amount) : r.amount,
    isReconciled: r.is_reconciled ?? false,
    createdAt: r.created_at,
  };
}

export async function listLedgerForParticipant(
  participantId: string,
): Promise<LedgerEntry[]> {
  const { data, error } = await supabase
    .from("participant_financial_ledger")
    .select(
      "id, participant_id, transaction_date, financial_code, description, amount, is_reconciled, created_at",
    )
    .eq("participant_id", participantId)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => rowToLedgerEntry(r as LedgerRow));
}

export interface NewLedgerEntry {
  participantId: string;
  transactionDate: string;
  financialCode: string;
  description: string;
  amount: number;
  isReconciled?: boolean;
}

export async function insertLedgerEntry(
  input: NewLedgerEntry,
): Promise<LedgerEntry> {
  const { data, error } = await supabase
    .from("participant_financial_ledger")
    .insert({
      participant_id: input.participantId,
      transaction_date: input.transactionDate,
      financial_code: input.financialCode,
      description: input.description,
      amount: input.amount,
      is_reconciled: input.isReconciled ?? false,
    })
    .select("*")
    .single();
  if (error) throw error;
  return rowToLedgerEntry(data as LedgerRow);
}

// ---------- archive / edit helpers ----------

export interface AttendanceSchedulePatch {
  dayOfWeek?: WeekDay;
  serviceType?: string;
  transportRule?: string;
  active?: boolean;
}

export async function updateAttendanceSchedule(
  id: string,
  patch: AttendanceSchedulePatch,
): Promise<AttendanceSchedule> {
  const row: Partial<AttendanceScheduleRow> = {};
  if (patch.dayOfWeek !== undefined) row.day_of_week = patch.dayOfWeek;
  if (patch.serviceType !== undefined) row.service_type = patch.serviceType;
  if (patch.transportRule !== undefined) row.transport_required = patch.transportRule;
  if (patch.active !== undefined) row.active = patch.active;
  const { data, error } = await supabase
    .from("participant_attendance_schedules")
    .update(row)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return rowToAttendanceSchedule(data as AttendanceScheduleRow);
}

export async function archiveAttendanceSchedule(id: string): Promise<void> {
  await updateAttendanceSchedule(id, { active: false });
}

export interface MedicationSchedulePatch {
  medicationName?: string;
  dosage?: string;
  expectedTime?: string;
  frequency?: string;
  active?: boolean;
}

export async function updateMedicationSchedule(
  id: string,
  patch: MedicationSchedulePatch,
): Promise<MedicationSchedule> {
  const row: Partial<ScheduleRow> = {};
  if (patch.medicationName !== undefined) row.medication_name = patch.medicationName;
  if (patch.dosage !== undefined) row.dosage = patch.dosage;
  if (patch.expectedTime !== undefined)
    row.expected_time =
      patch.expectedTime.length === 5 ? `${patch.expectedTime}:00` : patch.expectedTime;
  if (patch.frequency !== undefined) row.frequency = patch.frequency;
  if (patch.active !== undefined) row.active = patch.active;
  const { data, error } = await supabase
    .from("participant_medication_schedules")
    .update(row)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return rowToSchedule(data as ScheduleRow);
}

export async function archiveMedicationSchedule(id: string): Promise<void> {
  await updateMedicationSchedule(id, { active: false });
}

export type MedicationArchiveReference =
  | "Doctor Certificate / Medical Order"
  | "Carer Written Request"
  | "Management Operational Directive";

export interface MedicationDiscontinuationInput {
  id: string;
  authorizedById: string;
  witnessedById: string;
  referenceType: MedicationArchiveReference;
  reason: string;
}

export async function discontinueMedicationSchedule(
  input: MedicationDiscontinuationInput,
): Promise<void> {
  const { error } = await supabase
    .from("participant_medication_schedules")
    .update({
      active: false,
      status: "Archived",
      archived_at: new Date().toISOString(),
      archived_by_id: input.authorizedById,
      archive_witnessed_by_id: input.witnessedById,
      archive_reference_type: input.referenceType,
      archive_reason: input.reason,
    })
    .eq("id", input.id);
  if (error) throw error;
}

// ---------- suspension / bulk roster exceptions ----------

/** Enumerate every YYYY-MM-DD between two inclusive dates. */
export function eachDateInRange(startIso: string, endIso: string): string[] {
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  if (end < start) return [];
  const out: string[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    out.push(isoDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export async function insertAttendanceLogsBulk(
  rows: NewAttendanceLog[],
): Promise<AttendanceLog[]> {
  if (rows.length === 0) return [];
  const payload = rows.map((r) => ({
    participant_id: r.participantId,
    schedule_id: r.scheduleId ?? null,
    roster_date: r.rosterDate,
    expected_service: r.expectedService,
    actual_status: r.actualStatus,
    driver_notes: r.driverNotes ?? null,
  }));
  const { data, error } = await supabase
    .from("attendance_roster_logs")
    .insert(payload)
    .select("*");
  if (error) {
    console.error("[insertAttendanceLogsBulk] supabase error", { error, payload });
    throw new Error(error.message || "Bulk insert failed");
  }
  return (data ?? []).map((r) => rowToAttendanceLog(r as AttendanceLogRow));
}

// ---------- ledger reconciliation on absence ----------
//
// When a participant is Sick / Cancelled / Suspended on a given day, any
// auto-generated chargeable ledger entry for that exact date is flipped to
// `is_reconciled = true` and its description prefixed with
// "Cancelled - No Charge".

const NO_CHARGE_PREFIX = "Cancelled - No Charge · ";

export async function cancelChargesForDate(
  participantId: string,
  date: string,
): Promise<number> {
  const { data: existing, error: selErr } = await supabase
    .from("participant_financial_ledger")
    .select("id, description, amount, is_reconciled")
    .eq("participant_id", participantId)
    .eq("transaction_date", date)
    .gt("amount", 0)
    .eq("is_reconciled", false);
  if (selErr) {
    console.error("[cancelChargesForDate] select failed", selErr);
    return 0;
  }
  const targets = (existing ?? []) as Array<{
    id: string;
    description: string | null;
  }>;
  if (targets.length === 0) return 0;
  await Promise.all(
    targets.map((row) =>
      supabase
        .from("participant_financial_ledger")
        .update({
          is_reconciled: true,
          description: `${NO_CHARGE_PREFIX}${row.description ?? ""}`.trim(),
        })
        .eq("id", row.id),
    ),
  );
  return targets.length;
}


// ============================================================================
// EVENT MANAGEMENT DASHBOARD & ROSTER SYSTEM
// Tables: event_manifest, event_roster_bookings, event_financial_ledger
// SQL: docs/sql/2026-06-17_event_management.sql
// ============================================================================

export interface EventManifest {
  id: string;
  title: string;
  eventTypeCode: string;
  venue: string;
  startDate: string;
  endDate: string | null;
  ticketPrice: number;
  description: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface EventManifestRow {
  id: string;
  title: string;
  event_type: string;
  venue_name: string;
  start_date: string;
  end_date: string | null;
  ticket_price: number | string;
  description: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

function rowToEvent(r: EventManifestRow): EventManifest {
  return {
    id: r.id,
    title: r.title,
    eventTypeCode: r.event_type,
    venue: r.venue_name,
    startDate: r.start_date,
    endDate: r.end_date,
    ticketPrice: Number(r.ticket_price ?? 0),
    description: r.description,
    active: r.active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}


export async function listEvents(): Promise<EventManifest[]> {
  const { data, error } = await supabase
    .from("event_manifest")
    .select("*")
    .order("start_date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => rowToEvent(r as EventManifestRow));
}

export async function listConfirmedEvents(): Promise<EventManifest[]> {
  const { data, error } = await supabase
    .from("event_manifest")
    .select("*")
    .eq("status", "Confirmed")
    .order("start_date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => rowToEvent(r as EventManifestRow));
}


export interface NewEvent {
  title: string;
  eventTypeCode: string;
  venue: string;
  startDate: string;
  endDate?: string | null;
  ticketPrice: number;
  description?: string | null;
  /** Canonical event status. Defaults to 'Planning' when omitted. */
  status?: string;
  /** When set, the roster from this source event is copied into the new event
   * after insert (financial fields reset, fresh medical snapshots). */
  cloneFromEventId?: string | null;
}

function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (m) return m[1];
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function insertEvent(input: NewEvent): Promise<EventManifest> {
  const startIso = toIsoDate(input.startDate);
  if (!startIso) {
    throw new Error(`Invalid start_date: "${input.startDate}" (expected YYYY-MM-DD)`);
  }
  // end_date is NOT NULL in event_manifest — mirror start_date when the
  // caller leaves it blank (single-day events).
  const endIso = toIsoDate(input.endDate ?? null) ?? startIso;

  // Verified live schema on event_manifest:
  // title · event_type · venue_name · start_date · end_date · ticket_price · description · status
  const payload = {
    title: input.title,
    event_type: input.eventTypeCode,
    venue_name: input.venue,
    start_date: startIso,
    end_date: endIso,
    ticket_price: input.ticketPrice,
    description: input.description ?? null,
    status: (input.status && input.status.trim().length > 0) ? input.status : "Planning",
  };

  console.warn("[insertEvent] active Supabase URL:", supabaseUrl);

  const response = await supabase
    .from("event_manifest")
    .insert([payload])
    .select("*")
    .single();

  console.warn("RAW SUPABASE API OUTPUT:", response);

  const { data, error } = response;

  if (error) {
    console.error("[insertEvent] failed", { error, payload });
    const parts = [
      error.message,
      error.details ? `details: ${error.details}` : null,
      error.hint ? `hint: ${error.hint}` : null,
      error.code ? `code: ${error.code}` : null,
    ].filter(Boolean);
    throw new Error(parts.join(" · "));
  }

  const event = rowToEvent(data as EventManifestRow);

  // Optional rinse-and-repeat clone of roster bookings from a prior event.
  if (input.cloneFromEventId) {
    try {
      await cloneEventRoster(input.cloneFromEventId, event.id);
    } catch (cloneErr) {
      console.error("[insertEvent] roster clone failed (event already created)", cloneErr);
      // Don't roll back the event itself — surface the failure to the caller
      // so the UI can flag the half-completed clone.
      throw new Error(
        `Event created but roster clone failed: ${cloneErr instanceof Error ? cloneErr.message : String(cloneErr)}`,
      );
    }
  }

  return event;
}



export interface UpdateEventInput {
  id: string;
  title: string;
  eventTypeCode: string;
  venue: string;
  startDate: string;
  endDate?: string | null;
  ticketPrice: number;
  description?: string | null;
}

export async function updateEvent(input: UpdateEventInput): Promise<EventManifest> {
  const startIso = toIsoDate(input.startDate);
  if (!startIso) {
    throw new Error(`Invalid start_date: "${input.startDate}" (expected YYYY-MM-DD)`);
  }
  // Strict date-coercion rule: empty end_date mirrors start_date.
  const endIso = toIsoDate(input.endDate ?? null) ?? startIso;

  const payload = {
    title: input.title,
    event_type: input.eventTypeCode,
    venue_name: input.venue,
    start_date: startIso,
    end_date: endIso,
    ticket_price: input.ticketPrice,
    description: input.description ?? null,
  };

  const { data, error } = await supabase
    .from("event_manifest")
    .update(payload)
    .eq("id", input.id)
    .select("*")
    .single();

  if (error) {
    console.error("[updateEvent] failed", { error, payload });
    const parts = [
      error.message,
      error.details ? `details: ${error.details}` : null,
      error.hint ? `hint: ${error.hint}` : null,
      error.code ? `code: ${error.code}` : null,
    ].filter(Boolean);
    throw new Error(parts.join(" · "));
  }

  return rowToEvent(data as EventManifestRow);
}


// ---------- event_roster_bookings ----------

export interface EventRosterBooking {
  id: string;
  eventId: string;
  participantId: string;
  participantName: string;
  bookingStatus: string;
  amountPaid: number;
  isFullyPaid: boolean;
  notes: string | null;
  /** Per-booking custom price override; null means fall back to event ticket_price. */
  customPrice: number | null;
  /** Whether the participant is bringing a carer companion to this event. */
  bringsCarer: boolean;
  /** FK into carers_registry — populated only when brings_carer = true. */
  carerId: string | null;
  /** Whether the companion carer needs a physical bus seat. */
  carerTransportRequired: boolean;
  /** Whether the participant themselves needs a physical bus seat. */
  participantTransportRequired: boolean;
  /** One-off pickup address override for THIS event only. Wins over the
   * participant's regular_pickup_address when the manifest is seeded. */
  tripPickupAddressOverride: string | null;
  /** Frozen snapshot of critical medical alerts taken at the moment this
   * participant was added to the roster (or last refreshed by a coordinator). */
  dynamicMedicalNotesSnapshot: string | null;
  /** Regular pickup address read through the participants join — convenience
   * mirror of participant.regular_pickup_address so the roster table can
   * render it without a second fetch. */
  participantRegularPickupAddress: string | null;
  /** Mirror of participant.street_address from the join — last-tier fallback. */
  participantStreetAddress: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BookingRow {
  id: string;
  event_id: string;
  participant_id: string;
  booking_status: string;
  amount_paid: number | string;
  is_fully_paid: boolean;
  notes: string | null;
  custom_price: number | string | null;
  brings_carer: boolean | null;
  carer_id: string | null;
  carer_transport_required: boolean | null;
  participant_transport_required: boolean | null;
  trip_pickup_address_override: string | null;
  dynamic_medical_notes_snapshot: string | null;
  created_at: string;
  updated_at: string;
  participants?:
    | {
        first_name: string;
        last_name: string;
        regular_pickup_address?: string | null;
        street_address?: string | null;
      }
    | null;
}

function rowToBooking(r: BookingRow): EventRosterBooking {
  const fn = r.participants?.first_name ?? "";
  const ln = r.participants?.last_name ?? "";
  return {
    id: r.id,
    eventId: r.event_id,
    participantId: r.participant_id,
    participantName: `${fn} ${ln}`.trim() || "(unknown)",
    bookingStatus: r.booking_status,
    amountPaid: Number(r.amount_paid ?? 0),
    isFullyPaid: r.is_fully_paid,
    notes: r.notes ?? null,
    customPrice: r.custom_price == null ? null : Number(r.custom_price),
    bringsCarer: r.brings_carer ?? false,
    carerId: r.carer_id ?? null,
    carerTransportRequired: r.carer_transport_required ?? false,
    participantTransportRequired: r.participant_transport_required ?? false,
    tripPickupAddressOverride: r.trip_pickup_address_override ?? null,
    dynamicMedicalNotesSnapshot: r.dynamic_medical_notes_snapshot ?? null,
    participantRegularPickupAddress: r.participants?.regular_pickup_address ?? null,
    participantStreetAddress: r.participants?.street_address ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}


const BOOKING_PARTICIPANT_SELECT =
  "*, participants!inner(first_name, last_name, regular_pickup_address, street_address)";

export async function listEventBookings(eventId: string): Promise<EventRosterBooking[]> {
  const { data, error } = await supabase
    .from("event_roster_bookings")
    .select(BOOKING_PARTICIPANT_SELECT)
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => rowToBooking(r as BookingRow));
}

export interface EventBookingWithEvent extends EventRosterBooking {
  eventTitle: string;
  eventStartDate: string;
  eventEndDate: string;
  eventTicketPrice: number;
  eventStatus: string;
}

export async function listEventBookingsForParticipant(
  participantId: string,
): Promise<EventBookingWithEvent[]> {
  const { data, error } = await supabase
    .from("event_roster_bookings")
    .select(
      "*, participants!inner(first_name, last_name, regular_pickup_address, street_address), event_manifest!inner(title, start_date, end_date, ticket_price)",
    )
    .eq("participant_id", participantId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const raw = r as BookingRow & {
      event_manifest?: {
        title: string;
        start_date: string;
        end_date: string;
        ticket_price: number | string;
      };
    };
    const base = rowToBooking(raw);
    const ev = raw.event_manifest;
    return {
      ...base,
      eventTitle: ev?.title ?? "(deleted event)",
      eventStartDate: ev?.start_date ?? "",
      eventEndDate: ev?.end_date ?? "",
      eventTicketPrice: Number(ev?.ticket_price ?? 0),
      eventStatus: base.bookingStatus ?? "—",
    };
  });
}

export interface NewEventBooking {
  eventId: string;
  participantId: string;
  bookingStatus?: string;
  amountPaid?: number;
  ticketPrice: number;
  eventTitle?: string;
  notes?: string | null;
  bringsCarer?: boolean;
  carerId?: string | null;
  carerTransportRequired?: boolean;
  participantTransportRequired?: boolean;
  tripPickupAddressOverride?: string | null;
  /** Optional pre-built snapshot. Omit to auto-build from compliance + meds. */
  dynamicMedicalNotesSnapshot?: string | null;
}

export async function insertEventBooking(input: NewEventBooking): Promise<void> {
  const amount = input.amountPaid ?? 0;
  const trimmedNotes = (input.notes ?? "").trim();
  const bringsCarer = !!input.bringsCarer;
  const trimmedOverride = (input.tripPickupAddressOverride ?? "").trim();

  // Auto-snapshot compliance + active meds at the moment of roster inclusion.
  // If a caller (e.g. cloneEventRoster) precomputes one we accept it as-is.
  const snapshot =
    input.dynamicMedicalNotesSnapshot !== undefined
      ? input.dynamicMedicalNotesSnapshot
      : await buildMedicalAlertSnapshot(input.participantId);

  const { error } = await supabase.from("event_roster_bookings").insert({
    event_id: input.eventId,
    participant_id: input.participantId,
    booking_status: input.bookingStatus?.trim() || "Confirmed",
    amount_paid: amount,
    is_fully_paid: amount >= input.ticketPrice && input.ticketPrice > 0,
    notes: trimmedNotes.length > 0 ? trimmedNotes : null,
    brings_carer: bringsCarer,
    carer_id: bringsCarer ? input.carerId ?? null : null,
    carer_transport_required: bringsCarer ? !!input.carerTransportRequired : false,
    participant_transport_required: !!input.participantTransportRequired,
    trip_pickup_address_override: trimmedOverride.length > 0 ? trimmedOverride : null,
    dynamic_medical_notes_snapshot:
      snapshot && snapshot.trim().length > 0 ? snapshot : null,
  });
  if (error) {
    console.error("[insertEventBooking] failed", error);
    throw error;
  }
  if (amount > 0) {
    await insertLedgerEntry({
      participantId: input.participantId,
      transactionDate: new Date().toISOString().slice(0, 10),
      financialCode: "EVENT_PMT",
      description: `Event Payment Milestone — ${input.eventTitle ?? "Event"} [event:${input.eventId}]`,
      amount,
      isReconciled: true,
    });
  }
}

// ---------- Compliance snapshot + event cloning ----------

/** Record types treated as "Medical Alert" inside the
 * `participant_compliance_and_alerts` table. */
const MEDICAL_ALERT_RECORD_TYPE = "Medical Alert";

interface ComplianceAlertRow {
  record_type: string | null;
  reference_data: string | null;
  notes: string | null;
  created_at?: string | null;
}

/**
 * Build the frozen "dynamic medical notes" snapshot for a participant.
 * Pulls 'Medical Alert' rows from participant_compliance_and_alerts and the
 * participant's currently active medication schedules, formatted into a
 * compact multi-line string. Returns "" when nothing critical is on file.
 */
export async function buildMedicalAlertSnapshot(participantId: string): Promise<string> {
  const lines: string[] = [];

  const { data: alertRows, error: alertErr } = await supabase
    .from("participant_compliance_and_alerts")
    .select("record_type, reference_data, notes, created_at")
    .eq("participant_id", participantId)
    .eq("record_type", MEDICAL_ALERT_RECORD_TYPE)
    .order("created_at", { ascending: false });
  if (alertErr) {
    // Non-fatal: snapshot is best-effort. Log + carry on so the booking insert
    // is not blocked by an unrelated read failure.
    console.warn("[buildMedicalAlertSnapshot] alerts read failed", alertErr);
  } else if (alertRows && alertRows.length > 0) {
    lines.push("⚠️ MEDICAL ALERTS");
    for (const r of alertRows as ComplianceAlertRow[]) {
      const ref = (r.reference_data ?? "").trim();
      const note = (r.notes ?? "").trim();
      const body = [ref, note].filter(Boolean).join(" — ");
      if (body.length > 0) lines.push(`• ${body}`);
    }
  }

  const { data: medRows, error: medErr } = await supabase
    .from("participant_medication_schedules")
    .select("medication_name, dosage, frequency, time_slot")
    .eq("participant_id", participantId)
    .eq("active", true);
  if (medErr) {
    console.warn("[buildMedicalAlertSnapshot] meds read failed", medErr);
  } else if (medRows && medRows.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("💊 ACTIVE MEDICATIONS");
    for (const m of medRows as Array<{
      medication_name?: string | null;
      dosage?: string | null;
      frequency?: string | null;
      time_slot?: string | null;
    }>) {
      const parts = [
        m.medication_name?.trim(),
        m.dosage?.trim(),
        m.frequency?.trim() || m.time_slot?.trim() || null,
      ].filter((p): p is string => !!p && p.length > 0);
      if (parts.length > 0) lines.push(`• ${parts.join(" · ")}`);
    }
  }

  // Cap at ~2KB so an unusually chatty profile cannot bloat the booking row.
  const out = lines.join("\n");
  return out.length > 2000 ? out.slice(0, 1997) + "…" : out;
}

/** Re-build the snapshot for a single booking and persist it. */
export async function refreshBookingMedicalSnapshot(
  bookingId: string,
  participantId: string,
): Promise<string> {
  const snapshot = await buildMedicalAlertSnapshot(participantId);
  const { error } = await supabase
    .from("event_roster_bookings")
    .update({
      dynamic_medical_notes_snapshot: snapshot.length > 0 ? snapshot : null,
    })
    .eq("id", bookingId);
  if (error) {
    console.error("[refreshBookingMedicalSnapshot] update failed", error);
    throw error;
  }
  return snapshot;
}

/** Look up the most recent event of the given type for the clone engine. */
export async function findMostRecentEventByType(
  eventTypeCode: string,
  excludeEventId?: string | null,
): Promise<EventManifest | null> {
  let query = supabase
    .from("event_manifest")
    .select("*")
    .eq("event_type", eventTypeCode)
    .order("start_date", { ascending: false })
    .limit(excludeEventId ? 2 : 1);
  const { data, error } = await query;
  if (error) {
    console.error("[findMostRecentEventByType]", error);
    return null;
  }
  const rows = (data ?? []) as EventManifestRow[];
  const filtered = excludeEventId ? rows.filter((r) => r.id !== excludeEventId) : rows;
  return filtered.length > 0 ? rowToEvent(filtered[0]) : null;
}

/** All non-cancelled events, ordered newest-first, for the clone-source picker. */
export async function listPriorEventsForClone(
  excludeEventId?: string | null,
  limit = 200,
): Promise<EventManifest[]> {
  let query = supabase
    .from("event_manifest")
    .select("*")
    .neq("status", "Cancelled")
    .order("start_date", { ascending: false })
    .limit(limit);
  if (excludeEventId) query = query.neq("id", excludeEventId);
  const { data, error } = await query;
  if (error) {
    console.error("[listPriorEventsForClone]", error);
    return [];
  }
  return (data ?? []).map((r) => rowToEvent(r as EventManifestRow));
}



/**
 * Clone every roster booking from one event onto another.
 * - Reuses participant + carer wiring, custom_price, notes.
 * - Resets payment fields (amount_paid=0, is_fully_paid=false, status=Confirmed).
 * - Drops any one-off pickup override (those are per-trip).
 * - Re-snapshots medical alerts at clone time so the new event row reflects
 *   the participant's current medical state, not the source event's.
 */
export async function cloneEventRoster(
  sourceEventId: string,
  targetEventId: string,
): Promise<number> {
  const source = await listEventBookings(sourceEventId);
  if (source.length === 0) return 0;
  for (const b of source) {
    await insertEventBooking({
      eventId: targetEventId,
      participantId: b.participantId,
      bookingStatus: "Confirmed",
      amountPaid: 0,
      ticketPrice: b.customPrice ?? 0,
      notes: b.notes,
      bringsCarer: b.bringsCarer,
      carerId: b.carerId,
      carerTransportRequired: b.carerTransportRequired,
      participantTransportRequired: b.participantTransportRequired,
      tripPickupAddressOverride: null,
      // Force a fresh snapshot rather than carrying the source row forward.
      dynamicMedicalNotesSnapshot: undefined,
    });
  }
  return source.length;
}



/**
 * Record an incremental payment milestone against an existing roster booking.
 * - Recomputes cumulative amount_paid + is_fully_paid on event_roster_bookings.
 * - Writes a positive income line into participant_financial_ledger with
 *   the event title + id embedded in the description (the live ledger schema
 *   does not carry a dedicated event_id FK column).
 */
export interface PaymentMilestoneInput {
  bookingId: string;
  eventId: string;
  eventTitle: string;
  participantId: string;
  ticketPrice: number;
  currentAmountPaid: number;
  paymentAmount: number;
  paymentDate: string; // YYYY-MM-DD
}

export interface PaymentMilestoneResult {
  booking: EventRosterBooking;
  ledger: LedgerEntry;
}

export async function recordEventPaymentMilestone(
  input: PaymentMilestoneInput,
): Promise<PaymentMilestoneResult> {
  if (!Number.isFinite(input.paymentAmount) || input.paymentAmount <= 0) {
    throw new Error("Payment amount must be greater than zero.");
  }
  const newTotal = Number((input.currentAmountPaid + input.paymentAmount).toFixed(2));
  const fullyPaid = input.ticketPrice > 0 && newTotal >= input.ticketPrice;

  const { data: bookingData, error: bookingErr } = await supabase
    .from("event_roster_bookings")
    .update({ amount_paid: newTotal, is_fully_paid: fullyPaid })
    .eq("id", input.bookingId)
    .select(BOOKING_PARTICIPANT_SELECT)
    .single();
  if (bookingErr) {
    console.error("[recordEventPaymentMilestone] booking update failed", bookingErr);
    throw bookingErr;
  }

  const booking = rowToBooking(bookingData as BookingRow);

  const ledger = await insertLedgerEntry({
    participantId: input.participantId,
    transactionDate: input.paymentDate,
    financialCode: "EVENT_PMT",
    description: `Event Payment Milestone — ${input.eventTitle} [event:${input.eventId}]`,
    amount: input.paymentAmount,
    isReconciled: true,
  });

  return { booking, ledger };
}

// ---------- update booking (status + notes, optional cancellation refund) ----------

export interface BookingRefundInput {
  amount: number; // positive value of refund issued
  date: string; // YYYY-MM-DD
  eventId: string;
  eventTitle: string;
  participantId: string;
  reason?: string | null;
}

export interface UpdateBookingInput {
  bookingId: string;
  bookingStatus: string;
  notes: string | null;
  /** Amended booking cost ($). When provided, triggers delta logic vs current amount_paid. */
  amendedPrice?: number | null;
  /** Snapshot of current amount_paid (for delta calc). */
  currentAmountPaid?: number;
  /** Event context for price-adjustment ledger marker. */
  eventTitle?: string;
  eventId?: string;
  participantId?: string;
  refund?: BookingRefundInput | null;
  /** Carer companion controls. Pass undefined to leave columns untouched. */
  bringsCarer?: boolean;
  carerId?: string | null;
  carerTransportRequired?: boolean;
  participantTransportRequired?: boolean;
  /** One-off pickup override for this event. `null` clears it; `undefined` leaves it. */
  tripPickupAddressOverride?: string | null;
}

export interface UpdateBookingResult {
  booking: EventRosterBooking;
  refundLedger: LedgerEntry | null;
  priceAdjustmentLedger: LedgerEntry | null;
}

export async function updateEventBooking(
  input: UpdateBookingInput,
): Promise<UpdateBookingResult> {
  const trimmed = (input.notes ?? "").trim();
  const isCancelled = input.bookingStatus === "Cancelled";
  const issueRefund =
    isCancelled &&
    !!input.refund &&
    Number.isFinite(input.refund.amount) &&
    input.refund.amount > 0;

  const updatePayload: Record<string, unknown> = {
    booking_status: input.bookingStatus,
    notes: trimmed.length > 0 ? trimmed : null,
  };
  if (issueRefund) {
    updatePayload.amount_paid = 0;
    updatePayload.is_fully_paid = false;
  }

  if (input.bringsCarer !== undefined) {
    updatePayload.brings_carer = input.bringsCarer;
    if (input.bringsCarer) {
      if (input.carerId !== undefined) updatePayload.carer_id = input.carerId;
      if (input.carerTransportRequired !== undefined)
        updatePayload.carer_transport_required = input.carerTransportRequired;
    } else {
      updatePayload.carer_id = null;
      updatePayload.carer_transport_required = false;
  }

  if (input.participantTransportRequired !== undefined) {
    updatePayload.participant_transport_required = input.participantTransportRequired;
  }
  }

  if (input.tripPickupAddressOverride !== undefined) {
    const v = (input.tripPickupAddressOverride ?? "").toString().trim();
    updatePayload.trip_pickup_address_override = v.length > 0 ? v : null;
  }


  // ----- Price amendment delta (skipped when a cancellation refund is firing) -----
  let priceAdjustmentDelta = 0;
  const currentPaid = Number(input.currentAmountPaid ?? 0);
  const amended =
    input.amendedPrice != null && Number.isFinite(input.amendedPrice)
      ? Number(input.amendedPrice)
      : null;
  if (!issueRefund && amended != null && amended >= 0) {
    updatePayload.custom_price = amended;
    if (amended < currentPaid) {
      // Case B — cap amount_paid, flip fully paid, queue refund delta ledger
      priceAdjustmentDelta = Number((currentPaid - amended).toFixed(2));
      updatePayload.amount_paid = amended;
      updatePayload.is_fully_paid = true;
    } else {
      // Case A / C — recalc fully-paid flag against new threshold, no ledger entry
      updatePayload.is_fully_paid = amended > 0 && currentPaid >= amended;
    }
  }

  const { data, error } = await supabase
    .from("event_roster_bookings")
    .update(updatePayload)
    .eq("id", input.bookingId)
    .select(BOOKING_PARTICIPANT_SELECT)
    .single();
  if (error) {
    console.error("[updateEventBooking] failed", error);
    throw error;
  }
  const booking = rowToBooking(data as BookingRow);

  let refundLedger: LedgerEntry | null = null;
  if (issueRefund && input.refund) {
    const refundAmt = Number(input.refund.amount.toFixed(2));
    try {
      refundLedger = await insertLedgerEntry({
        participantId: input.refund.participantId,
        transactionDate: input.refund.date,
        financialCode: "EVENT_REFUND",
        description: `Refund · Event Cancelled - ${input.refund.eventTitle} [event:${input.refund.eventId}]`,
        amount: -refundAmt,
        isReconciled: true,
      });
    } catch (ledgerErr) {
      console.error("[updateEventBooking] refund ledger insert failed", ledgerErr);
      throw ledgerErr;
    }
  }

  let priceAdjustmentLedger: LedgerEntry | null = null;
  if (priceAdjustmentDelta > 0 && input.participantId && input.eventId) {
    const today = new Date().toISOString().slice(0, 10);
    const reason = (trimmed.length > 0 ? trimmed : "Booking cost amended");
    const evTitle = input.eventTitle ?? "Event";
    try {
      priceAdjustmentLedger = await insertLedgerEntry({
        participantId: input.participantId,
        transactionDate: today,
        financialCode: "EVENT_REFUND",
        description: `Price Adjustment Credit · ${reason} - ${evTitle} [event:${input.eventId}]`,
        amount: -priceAdjustmentDelta,
        isReconciled: true,
      });
    } catch (ledgerErr) {
      console.error("[updateEventBooking] price-adjustment ledger insert failed", ledgerErr);
      throw ledgerErr;
    }
  }

  return { booking, refundLedger, priceAdjustmentLedger };
}

// ---------- per-participant per-event payment history ----------
//
// participant_financial_ledger has no event_id FK in the live schema;
// recordEventPaymentMilestone tags each milestone with the marker
// "[event:<eventId>]" inside the description. We filter on that marker.

export async function listEventPaymentLedger(
  participantId: string,
  eventId: string,
): Promise<LedgerEntry[]> {
  const marker = `%[event:${eventId}]%`;
  const { data, error } = await supabase
    .from("participant_financial_ledger")
    .select(
      "id, participant_id, transaction_date, financial_code, description, amount, is_reconciled, created_at",
    )
    .eq("participant_id", participantId)
    .ilike("description", marker)
    .order("transaction_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => rowToLedgerEntry(r as LedgerRow));
}

export async function listEventPaymentLedgerForEvent(
  eventId: string,
): Promise<LedgerEntry[]> {
  const marker = `%[event:${eventId}]%`;
  const { data, error } = await supabase
    .from("participant_financial_ledger")
    .select(
      "id, participant_id, transaction_date, financial_code, description, amount, is_reconciled, created_at",
    )
    .ilike("description", marker)
    .order("transaction_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => rowToLedgerEntry(r as LedgerRow));
}




// ---------- event_financial_ledger ----------

export interface EventLedgerEntry {
  id: string;
  eventId: string;
  transactionDate: string;
  description: string;
  amount: number;
  financialCode: string;
  vendorName: string | null;
  createdAt: string;
}

interface EventLedgerRow {
  id: string;
  event_id: string;
  transaction_date: string;
  description: string;
  amount: number | string;
  financial_code: string;
  vendor_name: string | null;
  created_at: string;
}

function rowToEventLedger(r: EventLedgerRow): EventLedgerEntry {
  return {
    id: r.id,
    eventId: r.event_id,
    transactionDate: r.transaction_date,
    description: r.description,
    amount: Number(r.amount ?? 0),
    financialCode: r.financial_code,
    vendorName: r.vendor_name,
    createdAt: r.created_at,
  };
}

export async function listEventLedger(eventId: string): Promise<EventLedgerEntry[]> {
  const { data, error } = await supabase
    .from("event_financial_ledger")
    .select("*")
    .eq("event_id", eventId)
    .order("transaction_date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => rowToEventLedger(r as EventLedgerRow));
}

export interface NewEventLedger {
  eventId: string;
  transactionDate: string;
  description: string;
  amount: number;
  financialCode: string;
  vendorName?: string | null;
}

export async function insertEventLedger(input: NewEventLedger): Promise<void> {
  const { error } = await supabase.from("event_financial_ledger").insert({
    event_id: input.eventId,
    transaction_date: input.transactionDate,
    description: input.description,
    amount: input.amount,
    financial_code: input.financialCode,
    vendor_name: input.vendorName ?? null,
  });
  if (error) {
    console.error("[insertEventLedger] failed", error);
    throw error;
  }
}

// ============================================================================
// DRIVER MANIFEST: transport_trips + trip_legs
// SQL: docs/sql/2026-06-19_driver_manifest.sql
// ============================================================================

export type TripStatus = "active" | "completed";
export type LegStatus = "pending" | "en_route" | "arrived" | "completed";
export type LegKind =
  | "depot_to_client"
  | "client_to_client"
  | "client_to_venue"
  | "venue_to_depot";

export interface TransportTrip {
  id: string;
  driverStaffId: string | null;
  eventId: string | null;
  tripDate: string;
  startOdometerKm: number;
  endOdometerKm: number | null;
  status: TripStatus;
  startedAt: string;
  completedAt: string | null;
}

interface TripRow {
  id: string;
  driver_staff_id: string | null;
  event_id: string | null;
  trip_date: string;
  start_odometer: number | string;
  end_odometer_km: number | string | null;
  status: TripStatus;
  started_at: string;
  completed_at: string | null;
}

function rowToTrip(r: TripRow): TransportTrip {
  return {
    id: r.id,
    driverStaffId: r.driver_staff_id,
    eventId: r.event_id,
    tripDate: r.trip_date,
    startOdometerKm: Number(r.start_odometer),
    endOdometerKm: r.end_odometer_km == null ? null : Number(r.end_odometer_km),
    status: r.status,
    startedAt: r.started_at,
    completedAt: r.completed_at,
  };
}

export interface TripLeg {
  id: string;
  tripId: string;
  legIndex: number;
  legKind: LegKind;
  fromLabel: string;
  toLabel: string;
  fromParticipantId: string | null;
  toParticipantId: string | null;
  status: LegStatus;
  startLat: number | null;
  startLng: number | null;
  startAt: string | null;
  endLat: number | null;
  endLng: number | null;
  endAt: string | null;
  gpsDistanceKm: number | null;
  loggedDistanceKm: number | null;
  passengerPresent: boolean | null;
  noShowTriggeredAt: string | null;
  medicationExpected: boolean;
  medicationHandoverConfirmed: boolean;
  medicationHandoverStatus: MedicationHandoverStatus | null;
  unexpectedMedicationLogged: boolean;
  unexpectedMedicationNotes: string | null;
  completedAt: string | null;
  /** Resolved destination address for this leg, populated at seed time via
   * the 3-tier fallback override → permanent → street. */
  targetAddress: string | null;
}

export type MedicationHandoverStatus =
  | "collected"
  | "collected_intact"
  | "collected_damaged"
  | "expected_not_provided"
  | "not_required";

interface LegRow {
  id: string;
  trip_id: string;
  leg_index: number;
  leg_kind: LegKind;
  from_label: string;
  to_label: string;
  from_participant_id: string | null;
  to_participant_id: string | null;
  status: LegStatus;
  start_lat: number | string | null;
  start_lng: number | string | null;
  start_at: string | null;
  end_lat: number | string | null;
  end_lng: number | string | null;
  end_at: string | null;
  gps_distance_km: number | string | null;
  logged_distance_km: number | string | null;
  passenger_present: boolean | null;
  no_show_triggered_at: string | null;
  medication_expected: boolean;
  medication_handover_confirmed: boolean;
  medication_handover_status: MedicationHandoverStatus | null;
  unexpected_medication_logged: boolean;
  unexpected_medication_notes: string | null;
  completed_at: string | null;
  target_address: string | null;
}

const numOrNull = (v: number | string | null) => (v == null ? null : Number(v));

function rowToLeg(r: LegRow): TripLeg {
  return {
    id: r.id,
    tripId: r.trip_id,
    legIndex: r.leg_index,
    legKind: r.leg_kind,
    fromLabel: r.from_label,
    toLabel: r.to_label,
    fromParticipantId: r.from_participant_id,
    toParticipantId: r.to_participant_id,
    status: r.status,
    startLat: numOrNull(r.start_lat),
    startLng: numOrNull(r.start_lng),
    startAt: r.start_at,
    endLat: numOrNull(r.end_lat),
    endLng: numOrNull(r.end_lng),
    endAt: r.end_at,
    gpsDistanceKm: numOrNull(r.gps_distance_km),
    loggedDistanceKm: numOrNull(r.logged_distance_km),
    passengerPresent: r.passenger_present,
    noShowTriggeredAt: r.no_show_triggered_at,
    medicationExpected: r.medication_expected,
    medicationHandoverConfirmed: r.medication_handover_confirmed,
    medicationHandoverStatus: r.medication_handover_status ?? null,
    unexpectedMedicationLogged: r.unexpected_medication_logged,
    unexpectedMedicationNotes: r.unexpected_medication_notes,
    completedAt: r.completed_at,
    targetAddress: r.target_address ?? null,
  };
}

export interface ActiveTripBundle {
  trip: TransportTrip;
  legs: TripLeg[];
  eventTitle: string | null;
}

async function fetchEventTitle(eventId: string | null): Promise<string | null> {
  if (!eventId) return null;
  const { data, error } = await supabase
    .from("event_manifest")
    .select("title")
    .eq("id", eventId)
    .maybeSingle();
  if (error) {
    console.warn("[fetchEventTitle]", error);
    return null;
  }
  return (data?.title as string | undefined) ?? null;
}

function throwPg(prefix: string, error: { message: string; details?: string | null; hint?: string | null; code?: string | null }): never {
  const parts = [
    error.message,
    error.details ? `details: ${error.details}` : null,
    error.hint ? `hint: ${error.hint}` : null,
    error.code ? `code: ${error.code}` : null,
  ].filter(Boolean);
  console.error(prefix, error);
  throw new Error(parts.join(" · "));
}

export async function getActiveTripForDriver(
  driverStaffId: string,
): Promise<ActiveTripBundle | null> {
  const { data: tripRow, error: tripErr } = await supabase
    .from("transport_trips")
    .select("*")
    .eq("driver_staff_id", driverStaffId)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (tripErr) throwPg("[getActiveTripForDriver]", tripErr);
  if (!tripRow) return null;
  const trip = rowToTrip(tripRow as TripRow);
  const { data: legRows, error: legErr } = await supabase
    .from("trip_legs")
    .select("*")
    .eq("trip_id", trip.id)
    .order("leg_index", { ascending: true });
  if (legErr) throwPg("[getActiveTripForDriver:legs]", legErr);
  const eventTitle = await fetchEventTitle(trip.eventId);
  return { trip, legs: (legRows ?? []).map((r) => rowToLeg(r as LegRow)), eventTitle };
}

export interface MedicationExceptionRow {
  legId: string;
  tripId: string;
  legNumber: number;
  participantName: string;
  eventTitle: string | null;
  status: Extract<MedicationHandoverStatus, "collected_damaged" | "expected_not_provided">;
  exceptionLabel: string;
}

/** Live feed for the Operations Exception Hub. Returns medication handover
 * exceptions on legs belonging to currently active trips (status = 'active'
 * OR completed_at is null). */
export async function listActiveMedicationExceptions(): Promise<MedicationExceptionRow[]> {
  // 1) Find currently active trips.
  const { data: tripRows, error: tripErr } = await supabase
    .from("transport_trips")
    .select("id, event_id, status, completed_at")
    .or("status.eq.active,completed_at.is.null");
  if (tripErr) {
    console.warn("[listActiveMedicationExceptions:trips]", tripErr);
    return [];
  }
  const trips = tripRows ?? [];
  if (trips.length === 0) return [];
  const eventIdByTrip = new Map<string, string | null>();
  for (const t of trips) eventIdByTrip.set(t.id as string, (t.event_id as string | null) ?? null);
  const activeTripIds = trips.map((r) => r.id as string);

  // 2) Pull legs in those trips with an exception handover status.
  const { data: legRows, error: legErr } = await supabase
    .from("trip_legs")
    .select("id, trip_id, leg_index, to_participant_id, from_participant_id, medication_handover_status")
    .in("trip_id", activeTripIds)
    .in("medication_handover_status", ["collected_damaged", "expected_not_provided"]);
  if (legErr) {
    console.warn("[listActiveMedicationExceptions:legs]", legErr);
    return [];
  }
  const legs = legRows ?? [];
  if (legs.length === 0) return [];

  // 3) Resolve participant names (first_name + last_name).
  const participantIds = Array.from(
    new Set(
      legs
        .map((l) => (l.to_participant_id as string | null) ?? (l.from_participant_id as string | null))
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const nameById = new Map<string, string>();
  if (participantIds.length > 0) {
    const { data: pRows } = await supabase
      .from("participants")
      .select("id, first_name, last_name")
      .in("id", participantIds);
    for (const p of pRows ?? []) {
      const full = `${(p.first_name as string | null) ?? ""} ${(p.last_name as string | null) ?? ""}`.trim();
      nameById.set(p.id as string, full || "Unknown participant");
    }
  }

  // 4) Resolve event titles in a single batched query.
  const eventIds = Array.from(
    new Set(Array.from(eventIdByTrip.values()).filter((id): id is string => Boolean(id))),
  );
  const eventTitleById = new Map<string, string>();
  if (eventIds.length > 0) {
    const { data: eRows } = await supabase
      .from("event_manifest")
      .select("id, title")
      .in("id", eventIds);
    for (const e of eRows ?? []) eventTitleById.set(e.id as string, (e.title as string) ?? "");
  }

  return legs.map((l) => {
    const pid = (l.to_participant_id as string | null) ?? (l.from_participant_id as string | null);
    const status = l.medication_handover_status as MedicationExceptionRow["status"];
    const tripId = l.trip_id as string;
    const eventId = eventIdByTrip.get(tripId) ?? null;
    const eventTitle = eventId ? (eventTitleById.get(eventId) ?? null) : null;
    return {
      legId: l.id as string,
      tripId,
      legNumber: (l.leg_index as number) + 1,
      participantName: pid ? (nameById.get(pid) ?? "Unknown participant") : "Unknown participant",
      eventTitle,
      status,
      exceptionLabel:
        status === "collected_damaged"
          ? "Medication bag damaged / compromised"
          : "Medication expected but not provided",
    };
  });
}

export interface StartTripInput {
  driverStaffId: string;
  eventId: string;
  startOdometerKm: number;
  varianceReason?: string | null;
}

/** Returns the most recent closing odometer (end_odometer_km) recorded across
 * all completed trips. Used for the variance check on the Initialize Run screen. */
export async function getLastEndOdometer(): Promise<number | null> {
  const { data, error } = await supabase
    .from("transport_trips")
    .select("end_odometer, end_odometer_km, start_odometer_km, completed_at, updated_at, created_at")
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[getLastEndOdometer]", error);
    return null;
  }
  if (!data) return null;
  const row = data as {
    end_odometer?: number | null;
    end_odometer_km?: number | null;
    start_odometer_km?: number | null;
  };
  const raw =
    row.end_odometer_km ??
    row.end_odometer ??
    row.start_odometer_km ??
    null;
  return raw == null ? null : Number(raw);
}


export async function startTrip(input: StartTripInput): Promise<ActiveTripBundle> {
  // 0. Defensive guard: if an active (not completed/cancelled) trip already
  //    exists for this driver + event, return it instead of inserting again.
  //    Prevents unique-key violations from double-clicks or double-mounts.
  const { data: existingTrip, error: existingErr } = await supabase
    .from("transport_trips")
    .select("*")
    .eq("event_id", input.eventId)
    .eq("driver_staff_id", input.driverStaffId)
    .not("status", "in", "(completed,cancelled)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingErr) throwPg("[startTrip:existingLookup]", existingErr);
  if (existingTrip) {
    const existing = rowToTrip(existingTrip as TripRow);
    const { data: legRows, error: legErr } = await supabase
      .from("trip_legs")
      .select("*")
      .eq("trip_id", existing.id)
      .order("leg_index", { ascending: true });
    if (legErr) throwPg("[startTrip:existingLegs]", legErr);
    const eventTitle = await fetchEventTitle(existing.eventId);
    return {
      trip: existing,
      legs: (legRows ?? []).map((r) => rowToLeg(r as LegRow)),
      eventTitle,
    };
  }

  // 1. Build roster (ordered participants for this event) and pull every
  //    address signal needed for the 3-tier target_address fallback.
  const { data: bookingRows, error: bookingErr } = await supabase
    .from("event_roster_bookings")
    .select(
      "participant_id, trip_pickup_address_override, participants!inner(first_name, last_name, regular_pickup_address, street_address)",
    )
    .eq("event_id", input.eventId)
    .order("created_at", { ascending: true });
  if (bookingErr) throwPg("[startTrip:bookings]", bookingErr);

  type RosterEntry = {
    id: string;
    name: string;
    /** Strict 3-tier fallback: override → permanent → street → null. */
    address: string | null;
  };
  const roster: RosterEntry[] = (bookingRows ?? []).map((r) => {
    const row = r as unknown as {
      participant_id: string;
      trip_pickup_address_override: string | null;
      participants:
        | {
            first_name: string;
            last_name: string;
            regular_pickup_address: string | null;
            street_address: string | null;
          }
        | Array<{
            first_name: string;
            last_name: string;
            regular_pickup_address: string | null;
            street_address: string | null;
          }>
        | null;
    };
    const p = Array.isArray(row.participants) ? row.participants[0] : row.participants;
    const override = (row.trip_pickup_address_override ?? "").trim();
    const regular = (p?.regular_pickup_address ?? "").trim();
    const street = (p?.street_address ?? "").trim();
    return {
      id: row.participant_id,
      name: `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || "(participant)",
      address:
        override.length > 0
          ? override
          : regular.length > 0
            ? regular
            : street.length > 0
              ? street
              : null,
    };
  });

  // 2. Resolve event venue.
  const { data: eventRow, error: eventErr } = await supabase
    .from("event_manifest")
    .select("venue_name, title")
    .eq("id", input.eventId)
    .single();
  if (eventErr) throwPg("[startTrip:event]", eventErr);
  const venueLabel = (eventRow as { venue_name: string | null; title: string }).venue_name || (eventRow as { title: string }).title || "Venue";

  // 3. Resolve which participants have active medication schedules.
  const participantIds = roster.map((p) => p.id);
  const medSet = new Set<string>();
  if (participantIds.length) {
    const { data: medRows } = await supabase
      .from("participant_medication_schedules")
      .select("participant_id")
      .eq("active", true)
      .in("participant_id", participantIds);
    for (const m of medRows ?? []) medSet.add((m as { participant_id: string }).participant_id);
  }

  // 4. Insert trip row.
  const { data: tripRow, error: tripErr } = await supabase
    .from("transport_trips")
    .insert({
      driver_staff_id: input.driverStaffId,
      event_id: input.eventId,
      status: "active",
      start_odometer: input.startOdometerKm,
      start_odometer_km: input.startOdometerKm,
      start_odometer_variance_reason:
        input.varianceReason && input.varianceReason.trim().length > 0
          ? input.varianceReason.trim()
          : null,
    })
    .select("*")
    .single();
  if (tripErr) throwPg("[startTrip:insert]", tripErr);
  const trip = rowToTrip(tripRow as TripRow);

  // 5. Build leg chain: depot → client1 → ... → clientN → venue → depot.
  const DEPOT = "Depot";
  type LegSeed = {
    leg_kind: LegKind;
    from_label: string;
    to_label: string;
    from_participant_id: string | null;
    to_participant_id: string | null;
    medication_expected: boolean;
    target_address: string | null;
  };
  const seeds: LegSeed[] = [];
  if (roster.length === 0) {
    seeds.push({
      leg_kind: "venue_to_depot",
      from_label: DEPOT,
      to_label: venueLabel,
      from_participant_id: null,
      to_participant_id: null,
      medication_expected: false,
      target_address: null,
    });
  } else {
    for (let i = 0; i < roster.length; i++) {
      const to = roster[i];
      const from = i === 0 ? null : roster[i - 1];
      seeds.push({
        leg_kind: i === 0 ? "depot_to_client" : "client_to_client",
        from_label: from ? from.name : DEPOT,
        to_label: to.name,
        from_participant_id: from ? from.id : null,
        to_participant_id: to.id,
        medication_expected: medSet.has(to.id),
        target_address: to.address,
      });
    }
    const last = roster[roster.length - 1];
    seeds.push({
      leg_kind: "client_to_venue",
      from_label: last.name,
      to_label: venueLabel,
      from_participant_id: last.id,
      to_participant_id: null,
      medication_expected: false,
      target_address: null,
    });
  }
  seeds.push({
    leg_kind: "venue_to_depot",
    from_label: venueLabel,
    to_label: DEPOT,
    from_participant_id: null,
    to_participant_id: null,
    medication_expected: false,
    target_address: null,
  });

  const legPayload = seeds.map((s, i) => ({
    trip_id: trip.id,
    leg_index: i + 1,
    status: "pending" as LegStatus,
    medication_handover_status: "not_required" as MedicationHandoverStatus,
    ...s,
  }));

  const { data: legRows, error: legErr } = await supabase
    .from("trip_legs")
    .insert(legPayload)
    .select("*")
    .order("leg_index", { ascending: true });
  if (legErr) throwPg("[startTrip:legs]", legErr);

  const eventTitle = await fetchEventTitle(trip.eventId);
  return { trip, legs: (legRows ?? []).map((r) => rowToLeg(r as LegRow)), eventTitle };
}

export type LegPatch = Partial<{
  status: LegStatus;
  startLat: number | null;
  startLng: number | null;
  startAt: string | null;
  endLat: number | null;
  endLng: number | null;
  endAt: string | null;
  gpsDistanceKm: number | null;
  loggedDistanceKm: number | null;
  passengerPresent: boolean | null;
  noShowTriggeredAt: string | null;
  medicationHandoverConfirmed: boolean;
  medicationHandoverStatus: MedicationHandoverStatus | null;
  unexpectedMedicationLogged: boolean;
  unexpectedMedicationNotes: string | null;
  completedAt: string | null;
}>;

export async function patchTripLeg(legId: string, patch: LegPatch): Promise<TripLeg> {
  const map: Record<string, unknown> = {};
  if (patch.status !== undefined) map.status = patch.status;
  if (patch.startLat !== undefined) map.start_lat = patch.startLat;
  if (patch.startLng !== undefined) map.start_lng = patch.startLng;
  if (patch.startAt !== undefined) map.start_at = patch.startAt;
  if (patch.endLat !== undefined) map.end_lat = patch.endLat;
  if (patch.endLng !== undefined) map.end_lng = patch.endLng;
  if (patch.endAt !== undefined) map.end_at = patch.endAt;
  if (patch.gpsDistanceKm !== undefined) map.gps_distance_km = patch.gpsDistanceKm;
  if (patch.loggedDistanceKm !== undefined) map.logged_distance_km = patch.loggedDistanceKm;
  if (patch.passengerPresent !== undefined) map.passenger_present = patch.passengerPresent;
  if (patch.noShowTriggeredAt !== undefined) map.no_show_triggered_at = patch.noShowTriggeredAt;
  if (patch.medicationHandoverConfirmed !== undefined) map.medication_handover_confirmed = patch.medicationHandoverConfirmed;
  if (patch.medicationHandoverStatus !== undefined) map.medication_handover_status = patch.medicationHandoverStatus;
  if (patch.unexpectedMedicationLogged !== undefined) map.unexpected_medication_logged = patch.unexpectedMedicationLogged;
  if (patch.unexpectedMedicationNotes !== undefined) map.unexpected_medication_notes = patch.unexpectedMedicationNotes;
  if (patch.completedAt !== undefined) map.completed_at = patch.completedAt;
  map.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from("trip_legs")
    .update(map)
    .eq("id", legId)
    .select("*")
    .single();
  if (error) throwPg("[patchTripLeg]", error);
  return rowToLeg(data as LegRow);
}

export async function completeTrip(tripId: string, endOdometerKm: number): Promise<TransportTrip> {
  const { data, error } = await supabase
    .from("transport_trips")
    .update({
      end_odometer_km: endOdometerKm,
      status: "completed",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", tripId)
    .select("*")
    .single();
  if (error) throwPg("[completeTrip]", error);
  return rowToTrip(data as TripRow);
}

export async function cancelTrip(tripId: string): Promise<TransportTrip> {
  // Clear medication exception flags first so ghost alerts don't leak onto
  // the coordinator's Operations Exception Hub after cancellation. If the trip
  // has zero legs attached, skip the leg update entirely and proceed straight
  // to flipping the parent trip status so the driver is never left in limbo.
  const { count: legCount, error: legCountErr } = await supabase
    .from("trip_legs")
    .select("id", { count: "exact", head: true })
    .eq("trip_id", tripId);
  if (legCountErr) console.warn("[cancelTrip:legCount]", legCountErr);

  if ((legCount ?? 0) > 0) {
    const { error: legResetErr } = await supabase
      .from("trip_legs")
      .update({ medication_handover_status: "not_required" })
      .eq("trip_id", tripId)
      .in("medication_handover_status", ["collected_damaged", "expected_not_provided"]);
    if (legResetErr) console.warn("[cancelTrip:legReset]", legResetErr);
  }


  const { data, error } = await supabase
    .from("transport_trips")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", tripId)
    .select("*")
    .single();
  if (error) throwPg("[cancelTrip]", error);
  return rowToTrip(data as TripRow);
}

// ============================================================================
// TRANSPORT ASSETS REGISTER + DAILY OPERATIONAL CLEARANCE LOG
// SQL: docs/sql/2026-06-22_transport_assets_and_clearance.sql
// ============================================================================

export interface TransportAsset {
  id: string;
  name: string;
  makeModel: string;
  regoPlate: string;
  passengerCapacity: number;
  isActive: boolean;
  vehicleCategory: string | null;
}

interface TransportAssetRow {
  id: string;
  name: string;
  make_model: string;
  rego_plate: string;
  passenger_capacity: number;
  is_active: boolean;
  vehicle_category: string | null;
}

function rowToAsset(r: TransportAssetRow): TransportAsset {
  return {
    id: r.id,
    name: r.name,
    makeModel: r.make_model,
    regoPlate: r.rego_plate,
    passengerCapacity: Number(r.passenger_capacity),
    isActive: r.is_active,
    vehicleCategory: r.vehicle_category ?? null,
  };
}

export type ClearanceStatus = "passed" | "failed";

export interface AssetDailyClearance {
  id: string;
  assetId: string;
  clearanceDate: string; // YYYY-MM-DD
  driverStaffId: string;
  startOdometer: number;
  status: ClearanceStatus;
  notes: string | null;
  createdAt: string;
}

interface AssetDailyClearanceRow {
  id: string;
  asset_id: string;
  clearance_date: string;
  driver_staff_id: string;
  start_odometer: number | string;
  status: ClearanceStatus;
  notes: string | null;
  created_at: string;
}

function rowToClearance(r: AssetDailyClearanceRow): AssetDailyClearance {
  return {
    id: r.id,
    assetId: r.asset_id,
    clearanceDate: r.clearance_date,
    driverStaffId: r.driver_staff_id,
    startOdometer: Number(r.start_odometer),
    status: r.status,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

/** Lists all transport assets, active first then alphabetical by name. */
export async function listTransportAssets(): Promise<TransportAsset[]> {
  const { data, error } = await supabase
    .from("transport_assets")
    .select(
      "id, name, make_model, rego_plate, passenger_capacity, is_active, vehicle_category",
    )
    .order("is_active", { ascending: false })
    .order("name", { ascending: true });
  if (error) {
    console.error("[listTransportAssets] failed", error);
    return [];
  }
  return ((data ?? []) as TransportAssetRow[]).map(rowToAsset);
}

/** Lists every clearance log for a given calendar date string (YYYY-MM-DD). */
export async function listClearancesForDate(
  dateStr: string,
): Promise<AssetDailyClearance[]> {
  const { data, error } = await supabase
    .from("asset_daily_clearance")
    .select("*")
    .eq("clearance_date", dateStr)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[listClearancesForDate] failed", error);
    return [];
  }
  return ((data ?? []) as AssetDailyClearanceRow[]).map(rowToClearance);
}

/** Fetches the single clearance for an asset on a date, or null. */
export async function getClearanceForAssetOnDate(
  assetId: string,
  dateStr: string,
): Promise<AssetDailyClearance | null> {
  const { data, error } = await supabase
    .from("asset_daily_clearance")
    .select("*")
    .eq("asset_id", assetId)
    .eq("clearance_date", dateStr)
    .maybeSingle();
  if (error) {
    console.error("[getClearanceForAssetOnDate] failed", error);
    return null;
  }
  return data ? rowToClearance(data as AssetDailyClearanceRow) : null;
}

export interface NewAssetDailyClearance {
  assetId: string;
  clearanceDate: string; // YYYY-MM-DD
  driverStaffId: string;
  startOdometer: number;
  status: ClearanceStatus;
}

/**
 * Records a daily operational clearance for a vehicle. Enforces the
 * one-per-asset-per-calendar-date rule both client-side (pre-check) and via
 * the DB UNIQUE(asset_id, clearance_date) constraint as the authoritative
 * guard. Throws if a clearance already exists for that asset on that date.
 */
export async function insertAssetDailyClearance(
  input: NewAssetDailyClearance,
): Promise<AssetDailyClearance> {
  const existing = await getClearanceForAssetOnDate(input.assetId, input.clearanceDate);
  if (existing) {
    throw new Error(
      `Clearance already recorded for this vehicle on ${input.clearanceDate}.`,
    );
  }
  const { data, error } = await supabase
    .from("asset_daily_clearance")
    .insert({
      asset_id: input.assetId,
      clearance_date: input.clearanceDate,
      driver_staff_id: input.driverStaffId,
      start_odometer: input.startOdometer,
      status: input.status,
    })
    .select("*")
    .single();
  if (error) throwPg("[insertAssetDailyClearance]", error);
  return rowToClearance(data as AssetDailyClearanceRow);
}

// ============================================================================
// ASSET CHECKPOINTS + CLEARANCE ITEMS (drill-down walkaround results)
// SQL: docs/sql/2026-06-23_asset_checkpoints_and_items.sql
// ============================================================================

export interface AssetCheckpoint {
  id: string;
  assetId: string | null;
  vehicleCategory: string | null;
  /** UI label — sourced from the `checkpoint_text` column. */
  label: string;
  /** Optional grouping label for UI; falls back to impactLevel. */
  category: string | null;
  impactLevel: string | null;
  isMandatory: boolean;
}

interface AssetCheckpointRow {
  id: string;
  asset_id?: string | null;
  vehicle_category: string | null;
  checkpoint_text: string;
  impact_level: string | null;
  is_mandatory: boolean;
}

function rowToCheckpoint(r: AssetCheckpointRow): AssetCheckpoint {
  return {
    id: r.id,
    assetId: r.asset_id ?? null,
    vehicleCategory: r.vehicle_category ?? null,
    label: r.checkpoint_text,
    category: r.impact_level ?? null,
    impactLevel: r.impact_level ?? null,
    isMandatory: r.is_mandatory,
  };
}

/**
 * Loads the active checkpoint library applicable to a given vehicle.
 * Matches: checkpoints scoped directly to the asset, checkpoints scoped
 * to the asset's vehicle_category, and the global 'all' fallback list.
 */
export async function listCheckpointsForAsset(
  assetId: string,
  vehicleCategory: string | null,
): Promise<AssetCheckpoint[]> {
  const category = vehicleCategory ?? "all";
  const { data, error } = await supabase
    .from("asset_checkpoints")
    .select("id, checkpoint_text, vehicle_category, impact_level, is_mandatory")
    .or(
      `vehicle_category.eq.${category},vehicle_category.eq.all,asset_id.eq.${assetId}`,
    );
  if (error) {
    console.error("[listCheckpointsForAsset] failed", error);
    return [];
  }
  return ((data ?? []) as AssetCheckpointRow[]).map(rowToCheckpoint);
}

export interface AssetClearanceItem {
  id: string;
  clearanceId: string;
  checkpointId: string | null;
  checkpointLabel: string;
  passed: boolean;
  isMandatory: boolean;
  notes: string | null;
}

interface AssetClearanceItemRow {
  id: string;
  clearance_id: string;
  checkpoint_id: string | null;
  checkpoint_label: string;
  passed: boolean;
  is_mandatory: boolean;
  notes: string | null;
}

function rowToClearanceItem(r: AssetClearanceItemRow): AssetClearanceItem {
  return {
    id: r.id,
    clearanceId: r.clearance_id,
    checkpointId: r.checkpoint_id,
    checkpointLabel: r.checkpoint_label,
    passed: r.passed,
    isMandatory: r.is_mandatory,
    notes: r.notes,
  };
}

export interface NewClearanceItemInput {
  checkpointId: string | null;
  checkpointLabel: string;
  passed: boolean;
  isMandatory: boolean;
  notes?: string | null;
}

export interface AssetClearanceBundle {
  clearance: AssetDailyClearance;
  items: AssetClearanceItem[];
}

/**
 * Inserts the master clearance row and the per-question result rows.
 * Status is computed authoritatively from the items: any mandatory checkpoint
 * failed → 'failed', else 'passed'. The DB UNIQUE(asset_id, clearance_date)
 * remains the final guard.
 */
export async function insertAssetClearanceWithItems(input: {
  assetId: string;
  clearanceDate: string;
  driverStaffId: string;
  startOdometer: number;
  items: NewClearanceItemInput[];
}): Promise<AssetClearanceBundle> {
  const computedStatus: ClearanceStatus = input.items.some(
    (i) => i.isMandatory && !i.passed,
  )
    ? "failed"
    : "passed";

  const clearance = await insertAssetDailyClearance({
    assetId: input.assetId,
    clearanceDate: input.clearanceDate,
    driverStaffId: input.driverStaffId,
    startOdometer: input.startOdometer,
    status: computedStatus,
  });

  if (input.items.length === 0) {
    return { clearance, items: [] };
  }

  const itemRows = input.items.map((i) => ({
    clearance_id: clearance.id,
    checkpoint_id: i.checkpointId,
    checkpoint_label: i.checkpointLabel,
    passed: i.passed,
    is_mandatory: i.isMandatory,
    notes: i.notes ?? null,
  }));
  const { data, error } = await supabase
    .from("asset_clearance_items")
    .insert(itemRows)
    .select("*");
  if (error) {
    // Best-effort cleanup of the master row so the day is retryable.
    await supabase.from("asset_daily_clearance").delete().eq("id", clearance.id);
    throwPg("[insertAssetClearanceWithItems:items]", error);
  }
  return {
    clearance,
    items: ((data ?? []) as AssetClearanceItemRow[]).map(rowToClearanceItem),
  };
}

export interface FailedClearanceReport {
  clearance: AssetDailyClearance;
  assetName: string;
  assetRego: string | null;
  failedItems: AssetClearanceItem[];
}

/**
 * Returns every FAILED clearance recorded for the given calendar date,
 * with the asset display name and the specific failed checkpoint rows
 * needed by the Start/End Day Anomaly dashboard feed.
 */
export async function listFailedClearancesWithItems(
  dateStr: string,
): Promise<FailedClearanceReport[]> {
  const { data: clearances, error } = await supabase
    .from("asset_daily_clearance")
    .select("*")
    .eq("clearance_date", dateStr)
    .eq("status", "failed")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[listFailedClearancesWithItems:master] failed", error);
    return [];
  }
  const masters = ((clearances ?? []) as AssetDailyClearanceRow[]).map(rowToClearance);
  if (masters.length === 0) return [];

  const ids = masters.map((m) => m.id);
  const assetIds = Array.from(new Set(masters.map((m) => m.assetId)));

  const [itemsRes, assetsRes] = await Promise.all([
    supabase
      .from("asset_clearance_items")
      .select("*")
      .in("clearance_id", ids)
      .eq("passed", false),
    supabase
      .from("transport_assets")
      .select("id,name,rego_plate")
      .in("id", assetIds),
  ]);

  if (itemsRes.error) {
    console.error("[listFailedClearancesWithItems:items]", itemsRes.error);
  }
  if (assetsRes.error) {
    console.error("[listFailedClearancesWithItems:assets]", assetsRes.error);
  }

  const items = ((itemsRes.data ?? []) as AssetClearanceItemRow[]).map(rowToClearanceItem);
  const assetById = new Map<string, { name: string; rego: string | null }>();
  for (const a of (assetsRes.data ?? []) as Array<{
    id: string;
    name: string;
    rego_plate: string | null;
  }>) {
    assetById.set(a.id, { name: a.name, rego: a.rego_plate });
  }

  return masters.map((m) => ({
    clearance: m,
    assetName: assetById.get(m.assetId)?.name ?? "Unknown vehicle",
    assetRego: assetById.get(m.assetId)?.rego ?? null,
    failedItems: items.filter((i) => i.clearanceId === m.id),
  }));
}

// ---------------------------------------------------------------------------
// CAPACITY + HOIST MANIFEST SUMMARY (used by clearance gate + day anomaly hub)
// ---------------------------------------------------------------------------

export interface HoistDependent {
  bookingId: string;
  eventId: string;
  eventTitle: string;
  participantId: string;
  participantName: string;
  reason: string;
}

export interface TodayManifestSummary {
  dateStr: string;
  eventIds: string[];
  totalSeatsBooked: number;
  hoistDependents: HoistDependent[];
}

const HOIST_HINT = /hoist|wheelchair/i;

/**
 * Aggregates today's confirmed bookings across all events that overlap the
 * given date and returns the combined seat demand + any hoist-dependent
 * passengers (detected via the dynamic medical notes snapshot).
 */
export async function getTodayManifestSummary(
  dateStr: string,
): Promise<TodayManifestSummary> {
  const { data: events, error: evErr } = await supabase
    .from("event_manifest")
    .select("id,title,start_date,end_date,status")
    .eq("status", "Confirmed")
    .lte("start_date", dateStr);
  if (evErr) {
    console.warn("[getTodayManifestSummary:events]", evErr);
    return { dateStr, eventIds: [], totalSeatsBooked: 0, hoistDependents: [] };
  }
  const todays = (events ?? []).filter(
    (e: { start_date: string; end_date: string | null }) =>
      (e.end_date ?? e.start_date) >= dateStr,
  ) as Array<{ id: string; title: string }>;
  if (todays.length === 0) {
    return { dateStr, eventIds: [], totalSeatsBooked: 0, hoistDependents: [] };
  }
  const eventIds = todays.map((e) => e.id);
  const titleById = new Map(todays.map((e) => [e.id, e.title]));

  const { data: bookings, error: bkErr } = await supabase
    .from("event_roster_bookings")
    .select(BOOKING_PARTICIPANT_SELECT)
    .in("event_id", eventIds);
  if (bkErr) {
    console.warn("[getTodayManifestSummary:bookings]", bkErr);
    return {
      dateStr,
      eventIds,
      totalSeatsBooked: 0,
      hoistDependents: [],
    };
  }

  const rows = (bookings ?? []).map((r) => rowToBooking(r as BookingRow));
  let totalSeatsBooked = 0;
  const hoistDependents: HoistDependent[] = [];
  for (const b of rows) {
    // Skip explicitly cancelled/rerouted bookings.
    const status = (b.bookingStatus ?? "").toLowerCase();
    if (status.includes("cancel") || status.includes("rerout")) continue;
    if (b.participantTransportRequired) totalSeatsBooked += 1;
    if (b.bringsCarer && b.carerTransportRequired) totalSeatsBooked += 1;
    if (HOIST_HINT.test(b.dynamicMedicalNotesSnapshot ?? "")) {
      hoistDependents.push({
        bookingId: b.id,
        eventId: b.eventId,
        eventTitle: titleById.get(b.eventId) ?? "(event)",
        participantId: b.participantId,
        participantName: b.participantName,
        reason: (b.dynamicMedicalNotesSnapshot ?? "").trim(),
      });
    }
  }
  return { dateStr, eventIds, totalSeatsBooked, hoistDependents };
}

// ---------------------------------------------------------------------------
// SPLIT MANIFEST — reroute a hoist-dependent passenger to alt transport
// ---------------------------------------------------------------------------

export interface RerouteResult {
  bookingsUpdated: number;
  legsRemoved: number;
}

/**
 * Coordinator action when a vehicle's hoist fails. For every booking the
 * participant holds on the given date we flip the status to
 * "Rerouted-Alt-Transport", strip the bus-seat flags so the manifest
 * stops reserving capacity, and delete any pending trip_legs that still
 * reference them.
 */
export async function rerouteParticipantForDate(
  participantId: string,
  dateStr: string,
): Promise<RerouteResult> {
  const summary = await getTodayManifestSummary(dateStr);
  const targetBookings: Array<{ id: string; eventId: string }> = [];
  if (summary.eventIds.length > 0) {
    const { data: bookings } = await supabase
      .from("event_roster_bookings")
      .select("id,event_id,notes")
      .eq("participant_id", participantId)
      .in("event_id", summary.eventIds);
    for (const b of (bookings ?? []) as Array<{ id: string; event_id: string; notes: string | null }>) {
      const note = b.notes ?? "";
      const tag = "[REROUTED] Rerouted to Alternative Transport";
      const nextNote = note.includes(tag) ? note : `${tag}${note ? `\n${note}` : ""}`;
      const { error } = await supabase
        .from("event_roster_bookings")
        .update({
          booking_status: "Rerouted-Alt-Transport",
          participant_transport_required: false,
          carer_transport_required: false,
          notes: nextNote,
        })
        .eq("id", b.id);
      if (error) {
        console.error("[rerouteParticipantForDate:bookingUpdate]", error);
      } else {
        targetBookings.push({ id: b.id, eventId: b.event_id });
      }
    }
  }

  // Drop pending legs in active trips for this participant.
  const { data: activeTrips } = await supabase
    .from("transport_trips")
    .select("id")
    .eq("trip_date", dateStr)
    .eq("status", "active");
  let legsRemoved = 0;
  const tripIds = ((activeTrips ?? []) as Array<{ id: string }>).map((t) => t.id);
  if (tripIds.length > 0) {
    const { data: legs } = await supabase
      .from("trip_legs")
      .select("id")
      .in("trip_id", tripIds)
      .neq("status", "completed")
      .or(`to_participant_id.eq.${participantId},from_participant_id.eq.${participantId}`);
    const legIds = ((legs ?? []) as Array<{ id: string }>).map((l) => l.id);
    if (legIds.length > 0) {
      const { error } = await supabase.from("trip_legs").delete().in("id", legIds);
      if (error) {
        console.error("[rerouteParticipantForDate:legsDelete]", error);
      } else {
        legsRemoved = legIds.length;
      }
    }
  }

  return { bookingsUpdated: targetBookings.length, legsRemoved };
}
