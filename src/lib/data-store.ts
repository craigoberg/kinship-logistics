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
import { supabase } from "@/integrations/supabase/client";

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
  const { data, error } = await supabase
    .from("offline_sync_logs")
    .insert({
      driver_or_staff_id: log.driverOrStaffId || getStaffId() || DEFAULT_STAFF_UUID,
      device_uuid: log.deviceUuid || getDeviceUuid() || DEFAULT_DEVICE_UUID,
      action_type: log.actionType,
      payload: log.payload,
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

export interface StaffMember {
  id: string;
  fullName: string;
  role: string | null;
  pinHash: string | null;
}

interface StaffRow {
  id: string;
  full_name: string;
  role: string | null;
  pin_hash: string | null;
}

export async function listStaffRegistry(): Promise<StaffMember[]> {
  const { data, error } = await supabase
    .from("staff_registry")
    .select("id, full_name, role, pin_hash")
    .order("full_name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: StaffRow) => ({
    id: r.id,
    fullName: r.full_name,
    role: r.role,
    pinHash: r.pin_hash,
  }));
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
    .eq("participant_id", participantId)
    .order("day_of_week", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToAttendanceSchedule);
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
  | "Pending" | "Attended" | "No-Show" | "Cancelled" | "Sick";

export const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  "Pending", "Attended", "No-Show", "Cancelled", "Sick",
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
    .select("id, category, code, display_name")
    .single();
  if (error) throw error;
  const r = data as LookupRow;
  return {
    id: r.id,
    category: r.category,
    code: r.code,
    displayName: r.display_name ?? r.code,
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
