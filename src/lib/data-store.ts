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
  iddsi?: { liquids: number; foods: number };
  dualWitnessPinHash?: string | null;
}

export interface NewParticipant {
  firstName: string;
  lastName: string;
  ndisNumber: string;
  streetAddress?: string | null;
  iddsi: { liquids: number; foods: number };
  dualWitnessPinHash?: string | null;
}

export async function insertParticipant(input: NewParticipant): Promise<Participant> {
  const row = {
    first_name: input.firstName,
    last_name: input.lastName,
    ndis_number: input.ndisNumber,
    street_address: input.streetAddress ?? null,
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

export interface NewEvent {
  title: string;
  eventTypeCode: string;
  venue: string;
  startDate: string;
  endDate?: string | null;
  ticketPrice: number;
  description?: string | null;
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
  // title · event_type · venue_name · start_date · end_date · ticket_price · description
  const payload = {
    title: input.title,
    event_type: input.eventTypeCode,
    venue_name: input.venue,
    start_date: startIso,
    end_date: endIso,
    ticket_price: input.ticketPrice,
    description: input.description ?? null,
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

  return rowToEvent(data as EventManifestRow);
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
  created_at: string;
  updated_at: string;
  participants?: { first_name: string; last_name: string } | null;
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
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listEventBookings(eventId: string): Promise<EventRosterBooking[]> {
  const { data, error } = await supabase
    .from("event_roster_bookings")
    .select("*, participants!inner(first_name, last_name)")
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
      "*, participants!inner(first_name, last_name), event_manifest!inner(title, start_date, end_date, ticket_price)",
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
}

export async function insertEventBooking(input: NewEventBooking): Promise<void> {
  const amount = input.amountPaid ?? 0;
  const trimmedNotes = (input.notes ?? "").trim();
  const bringsCarer = !!input.bringsCarer;
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
    .select("*, participants!inner(first_name, last_name)")
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
    .select("*, participants!inner(first_name, last_name)")
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
  start_odometer_km: number | string;
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
    startOdometerKm: Number(r.start_odometer_km),
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
  unexpectedMedicationLogged: boolean;
  unexpectedMedicationNotes: string | null;
  completedAt: string | null;
}

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
  unexpected_medication_logged: boolean;
  unexpected_medication_notes: string | null;
  completed_at: string | null;
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
    unexpectedMedicationLogged: r.unexpected_medication_logged,
    unexpectedMedicationNotes: r.unexpected_medication_notes,
    completedAt: r.completed_at,
  };
}

export interface ActiveTripBundle {
  trip: TransportTrip;
  legs: TripLeg[];
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
  return { trip, legs: (legRows ?? []).map((r) => rowToLeg(r as LegRow)) };
}

export interface StartTripInput {
  driverStaffId: string;
  eventId: string;
  startOdometerKm: number;
}

export async function startTrip(input: StartTripInput): Promise<ActiveTripBundle> {
  // 1. Build roster (ordered participants for this event).
  const { data: bookingRows, error: bookingErr } = await supabase
    .from("event_roster_bookings")
    .select("participant_id, participants!inner(first_name, last_name)")
    .eq("event_id", input.eventId)
    .order("created_at", { ascending: true });
  if (bookingErr) throwPg("[startTrip:bookings]", bookingErr);

  const roster = (bookingRows ?? []).map((r) => {
    const row = r as { participant_id: string; participants: { first_name: string; last_name: string } | null };
    return {
      id: row.participant_id,
      name: `${row.participants?.first_name ?? ""} ${row.participants?.last_name ?? ""}`.trim() || "(participant)",
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
      start_odometer_km: input.startOdometerKm,
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
    });
  }
  seeds.push({
    leg_kind: "venue_to_depot",
    from_label: venueLabel,
    to_label: DEPOT,
    from_participant_id: null,
    to_participant_id: null,
    medication_expected: false,
  });

  const legPayload = seeds.map((s, i) => ({
    trip_id: trip.id,
    leg_index: i + 1,
    ...s,
  }));
  const { data: legRows, error: legErr } = await supabase
    .from("trip_legs")
    .insert(legPayload)
    .select("*")
    .order("leg_index", { ascending: true });
  if (legErr) throwPg("[startTrip:legs]", legErr);

  return { trip, legs: (legRows ?? []).map((r) => rowToLeg(r as LegRow)) };
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
