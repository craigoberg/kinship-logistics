// Live data layer backed by the external Supabase instance.
// Read/write helpers map between snake_case columns and the camelCase shape
// used by the UI. All functions are async; React components consume them via
// TanStack Query hooks in src/hooks.
import { supabase } from "@/integrations/supabase/client";

export interface Participant {
  id: string;
  fullName: string;
  ndisId: string;
  dob: string;
  iddsi: { liquids: number; foods: number };
  mobility: "Independent" | "Walking stick" | "Walking frame" | "Wheelchair";
  allergies: string[];
  flags: string[];
  primaryContact: { name: string; relation: string; phone: string };
  notes: string;
}

export type TransportStatus = "En route" | "Arrived" | "No-show";

export interface TransportLog {
  id: string;
  participantId: string;
  pickupOdometer: number;
  dropoffOdometer: number;
  passengerPresent: boolean;
  status: TransportStatus;
  timestamp: string;
  notes: string;
  syncedAt?: string | null;
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

// ---------- row mappers ----------

interface ParticipantRow {
  id: string;
  full_name: string;
  ndis_id: string;
  dob: string;
  iddssi_level_liquids: number | null;
  iddssi_level_solids: number | null;
  mobility: Participant["mobility"];
  allergies: string[] | null;
  flags: string[] | null;
  primary_contact: Participant["primaryContact"] | null;
  notes: string | null;
}

function rowToParticipant(r: ParticipantRow): Participant {
  return {
    id: r.id,
    fullName: r.full_name,
    ndisId: r.ndis_id,
    dob: r.dob,
    iddsi: {
      liquids: r.iddssi_level_liquids ?? 0,
      foods: r.iddssi_level_solids ?? 7,
    },
    mobility: r.mobility,
    allergies: r.allergies ?? [],
    flags: r.flags ?? [],
    primaryContact: r.primary_contact ?? { name: "", relation: "", phone: "" },
    notes: r.notes ?? "",
  };
}

interface TransportRow {
  id: string;
  participant_id: string;
  pickup_odometer: number;
  dropoff_odometer: number;
  passenger_present: boolean;
  status: TransportStatus;
  timestamp: string;
  notes: string | null;
  synced_at: string | null;
}

function rowToTransport(r: TransportRow): TransportLog {
  return {
    id: r.id,
    participantId: r.participant_id,
    pickupOdometer: r.pickup_odometer,
    dropoffOdometer: r.dropoff_odometer,
    passengerPresent: r.passenger_present,
    status: r.status,
    timestamp: r.timestamp,
    notes: r.notes ?? "",
    syncedAt: r.synced_at,
  };
}

// ---------- participants ----------

export async function listParticipants(): Promise<Participant[]> {
  const { data, error } = await supabase
    .from("participants")
    .select("*")
    .order("full_name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToParticipant);
}

export async function updateParticipant(
  id: string,
  patch: Partial<Participant>,
): Promise<Participant> {
  const row: Partial<ParticipantRow> = {};
  if (patch.fullName !== undefined) row.full_name = patch.fullName;
  if (patch.ndisId !== undefined) row.ndis_id = patch.ndisId;
  if (patch.dob !== undefined) row.dob = patch.dob;
  if (patch.iddsi !== undefined) {
    row.iddssi_level_liquids = patch.iddsi.liquids;
    row.iddssi_level_solids = patch.iddsi.foods;
  }
  if (patch.mobility !== undefined) row.mobility = patch.mobility;
  if (patch.allergies !== undefined) row.allergies = patch.allergies;
  if (patch.flags !== undefined) row.flags = patch.flags;
  if (patch.primaryContact !== undefined) row.primary_contact = patch.primaryContact;
  if (patch.notes !== undefined) row.notes = patch.notes;

  const { data, error } = await supabase
    .from("participants")
    .update(row)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return rowToParticipant(data as ParticipantRow);
}

// ---------- transport ----------

export async function listTransportLogs(): Promise<TransportLog[]> {
  const { data, error } = await supabase
    .from("offline_sync_logs")
    .select("*")
    .order("timestamp", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToTransport);
}

export interface NewTransportLog {
  participantId: string;
  pickupOdometer: number;
  dropoffOdometer: number;
  passengerPresent: boolean;
  status: TransportStatus;
  timestamp: string;
  notes: string;
}

export async function insertTransportLog(log: NewTransportLog): Promise<TransportLog> {
  const { data, error } = await supabase
    .from("offline_sync_logs")
    .insert({
      participant_id: log.participantId,
      pickup_odometer: log.pickupOdometer,
      dropoff_odometer: log.dropoffOdometer,
      passenger_present: log.passengerPresent,
      status: log.status,
      timestamp: log.timestamp,
      notes: log.notes,
      synced_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw error;
  return rowToTransport(data as TransportRow);
}
