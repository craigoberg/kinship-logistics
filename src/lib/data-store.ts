// Local-first data store. All reads/writes go through this module so a future
// Supabase adapter can slot in behind the same API surface.
import { SAMPLE_PARTICIPANTS, SAMPLE_TRANSPORT_LOGS, SAMPLE_SYNC_ITEMS } from "./sample-data";

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

const KEYS = {
  participants: "yada.participants.v1",
  transport: "yada.transportLogs.v1",
  seeded: "yada.seeded.v1",
} as const;

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function read<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode — silently ignore for now */
  }
}

function ensureSeeded() {
  if (!isBrowser()) return;
  if (localStorage.getItem(KEYS.seeded)) return;
  write(KEYS.participants, SAMPLE_PARTICIPANTS);
  write(KEYS.transport, SAMPLE_TRANSPORT_LOGS);
  // Sync queue seed handled inside sync-queue module.
  localStorage.setItem(KEYS.seeded, "1");
}

export function listParticipants(): Participant[] {
  ensureSeeded();
  return read<Participant[]>(KEYS.participants, SAMPLE_PARTICIPANTS);
}

export function getParticipant(id: string): Participant | undefined {
  return listParticipants().find((p) => p.id === id);
}

export function updateParticipant(id: string, patch: Partial<Participant>): Participant | undefined {
  const all = listParticipants();
  const idx = all.findIndex((p) => p.id === id);
  if (idx === -1) return undefined;
  const next = { ...all[idx], ...patch };
  all[idx] = next;
  write(KEYS.participants, all);
  return next;
}

export function listTransportLogs(): TransportLog[] {
  ensureSeeded();
  return read<TransportLog[]>(KEYS.transport, SAMPLE_TRANSPORT_LOGS);
}

export function addTransportLog(log: Omit<TransportLog, "id">): TransportLog {
  const all = listTransportLogs();
  const created: TransportLog = { ...log, id: `t-${Date.now().toString(36)}` };
  write(KEYS.transport, [created, ...all]);
  return created;
}

// Re-export sample sync items for the initial queue seed.
export { SAMPLE_SYNC_ITEMS };
