// Store-and-forward sync queue. Persists pending payloads to localStorage when
// the device is offline (or when a direct write fails), and replays them
// against Supabase via flush(). All replays funnel through insertSyncLog so
// the JSONB payload column owns the variable shape (transport logs, IDDSI
// changes, participant edits).
import type {
  SyncQueueItem,
  SyncItemType,
  SyncStatus,
  NewSyncLog,
  ParticipantPatch,
  MedicationLogPayload,
} from "./data-store";
import { insertSyncLog, updateParticipant, insertComplianceLog } from "./data-store";

const KEY = "yada.syncQueue.v1";

type Listener = () => void;
const listeners = new Set<Listener>();

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function read(): SyncQueueItem[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SyncQueueItem[]) : [];
  } catch {
    return [];
  }
}

function write(items: SyncQueueItem[]) {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function listQueue(): SyncQueueItem[] {
  return read();
}

export function enqueue(
  type: SyncItemType,
  payload: Record<string, unknown>,
): SyncQueueItem {
  const item: SyncQueueItem = {
    id: `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    createdAt: new Date().toISOString(),
    status: "pending",
    attempts: 0,
    payload,
  };
  write([item, ...read()]);
  return item;
}

function patch(id: string, fields: Partial<SyncQueueItem>) {
  write(read().map((i) => (i.id === id ? { ...i, ...fields } : i)));
}

export function setStatus(id: string, status: SyncStatus, error?: string) {
  patch(id, { status, error });
}

export function discard(id: string) {
  write(read().filter((i) => i.id !== id));
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function processItem(item: SyncQueueItem): Promise<void> {
  if (item.type === "transport_log") {
    const log = item.payload as unknown as NewSyncLog;
    await insertSyncLog(log);
    return;
  }
  if (item.type === "medication_log") {
    const payload = item.payload as unknown as MedicationLogPayload;
    await insertComplianceLog({
      ...payload,
      metadata: { ...payload.metadata, network_state: "online" },
    });
    return;
  }
  if (item.type === "participant_update" || item.type === "iddsi_change") {
    const p = item.payload as { id: string; patch: ParticipantPatch };
    await updateParticipant(p.id, p.patch);
    return;
  }
}

/** Walk the queue and push each pending item to Supabase. */
export async function flush(): Promise<{ ok: number; failed: number }> {
  const items = read().filter((i) => i.status !== "synced");
  let ok = 0;
  let failed = 0;
  for (const item of items) {
    patch(item.id, { status: "retrying", attempts: item.attempts + 1 });
    try {
      await processItem(item);
      write(read().filter((i) => i.id !== item.id));
      ok += 1;
    } catch (e) {
      patch(item.id, { status: "failed", error: (e as Error).message });
      failed += 1;
    }
  }
  return { ok, failed };
}

export async function retry(id: string): Promise<void> {
  const item = read().find((i) => i.id === id);
  if (!item) return;
  patch(id, { status: "retrying", attempts: item.attempts + 1 });
  try {
    await processItem(item);
    write(read().filter((i) => i.id !== id));
  } catch (e) {
    patch(id, { status: "failed", error: (e as Error).message });
  }
}
