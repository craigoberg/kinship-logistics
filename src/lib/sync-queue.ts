// Store-and-forward sync queue. Persists to localStorage and exposes a small
// event API so UI can re-render on changes. The flush() method is a stub today
// and will dispatch to Supabase once external bindings are wired.
import type { SyncQueueItem, SyncItemType, SyncStatus } from "./data-store";
import { SAMPLE_SYNC_ITEMS } from "./data-store";

const KEY = "yada.syncQueue.v1";
const SEED_FLAG = "yada.syncQueue.seeded.v1";

type Listener = () => void;
const listeners = new Set<Listener>();

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function read(): SyncQueueItem[] {
  if (!isBrowser()) return [];
  try {
    if (!localStorage.getItem(SEED_FLAG)) {
      localStorage.setItem(KEY, JSON.stringify(SAMPLE_SYNC_ITEMS));
      localStorage.setItem(SEED_FLAG, "1");
      return SAMPLE_SYNC_ITEMS;
    }
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
    id: `s-${Date.now().toString(36)}`,
    type,
    createdAt: new Date().toISOString(),
    status: "pending",
    attempts: 0,
    payload,
  };
  write([item, ...read()]);
  return item;
}

export function setStatus(id: string, status: SyncStatus, error?: string) {
  const next = read().map((i) =>
    i.id === id ? { ...i, status, error, attempts: i.attempts + (status === "retrying" ? 1 : 0) } : i,
  );
  write(next);
}

export function retry(id: string) {
  // Placeholder until Supabase binding lands: simulate an in-flight retry.
  setStatus(id, "retrying");
}

export function discard(id: string) {
  write(read().filter((i) => i.id !== id));
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Future: walk the queue and POST to Supabase. Left as a no-op for now.
export async function flush(): Promise<void> {
  return;
}
