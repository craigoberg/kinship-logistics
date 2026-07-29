/**
 * DEV/TEST simulate network loss (BL-082).
 * Gated by IS_TEST_BUILD. Forces the app to treat the device as offline
 * without Airplane Mode — for Manifest outbox / future field offline QA.
 */
import { IS_TEST_BUILD } from "@/lib/test-mode";

const KEY = "yada.simOffline.v1";

type Listener = () => void;
const listeners = new Set<Listener>();

function canSimulate(): boolean {
  return IS_TEST_BUILD && typeof window !== "undefined";
}

function readFlag(): boolean {
  if (!canSimulate()) return false;
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function subscribeSimulatedOffline(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((l) => l());
}

/** True when DEV switch is forcing offline (ignores real navigator.onLine). */
export function isSimulatedOffline(): boolean {
  return readFlag();
}

export function setSimulatedOffline(forced: boolean): void {
  if (!canSimulate()) return;
  try {
    if (forced) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore quota */
  }
  notify();
}

/**
 * Effective online for field writes / Manifest outbox.
 * Simulated offline wins over navigator.onLine.
 */
export function isAppOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  if (isSimulatedOffline()) return false;
  return navigator.onLine;
}
