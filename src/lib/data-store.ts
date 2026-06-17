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

export type SyncItemType = "participant_update" | "transport_log" | "iddsi_change";
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
