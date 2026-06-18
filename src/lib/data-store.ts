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
  iddsi?: { liquids: number; foods: number };
  dualWitnessPinHash?: string | null;
}

export interface NewParticipant {
  firstName: string;
  lastName: string;
  ndisNumber: string;
  iddsi: { liquids: number; foods: number };
  dualWitnessPinHash?: string | null;
}

export async function insertParticipant(input: NewParticipant): Promise<Participant> {
  const row = {
    first_name: input.firstName,
    last_name: input.lastName,
    ndis_number: input.ndisNumber,
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
      "*, participants!inner(first_name, last_name), event_manifest!inner(title, start_date, end_date, ticket_price, status)",
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
        status: string | null;
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
      eventStatus: ev?.status ?? "—",
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
}

export async function insertEventBooking(input: NewEventBooking): Promise<void> {
  const amount = input.amountPaid ?? 0;
  const trimmedNotes = (input.notes ?? "").trim();
  const { error } = await supabase.from("event_roster_bookings").insert({
    event_id: input.eventId,
    participant_id: input.participantId,
    booking_status: input.bookingStatus?.trim() || "Confirmed",
    amount_paid: amount,
    is_fully_paid: amount >= input.ticketPrice && input.ticketPrice > 0,
    notes: trimmedNotes.length > 0 ? trimmedNotes : null,
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
