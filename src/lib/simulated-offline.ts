/**
 * DEV/TEST simulate network loss (BL-082).
 * Gated by IS_TEST_BUILD. Forces the app to treat the device as offline
 * without Airplane Mode — for Manifest outbox / future field offline QA.
 */
import { ACTIVE_PROFILE_EVENT } from "@/lib/active-profile-event";
import { canUseDevTools } from "@/lib/dev-tools-access";
import { IS_TEST_BUILD } from "@/lib/test-mode";

const KEY = "yada.simOffline.v1";
/** Set when a real database read fails or does not answer. Cleared by a successful probe. */
const LATCH_KEY = "yada.fieldLinkOffline";

type Listener = () => void;
const listeners = new Set<Listener>();

function canSimulate(): boolean {
  return IS_TEST_BUILD && typeof window !== "undefined";
}

function readFlag(): boolean {
  if (!canSimulate() || !canUseDevTools()) return false;
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

if (typeof window !== "undefined") {
  window.addEventListener(ACTIVE_PROFILE_EVENT, () => notify());
}

/** True when DEV switch is forcing offline (ignores real navigator.onLine). */
export function isSimulatedOffline(): boolean {
  return readFlag();
}

/** True after a database read failed, until a probe read succeeds. Survives refresh. */
export function isFieldLinkDown(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    return sessionStorage.getItem(LATCH_KEY) === "1";
  } catch {
    return false;
  }
}

export function latchFieldLinkDown(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (sessionStorage.getItem(LATCH_KEY) === "1") return;
    sessionStorage.setItem(LATCH_KEY, "1");
  } catch {
    return;
  }
  notify();
}

export function clearFieldLinkDown(): void {
  if (isSimulatedOffline()) return;
  if (typeof sessionStorage === "undefined") return;
  try {
    if (sessionStorage.getItem(LATCH_KEY) !== "1") return;
    sessionStorage.removeItem(LATCH_KEY);
  } catch {
    return;
  }
  notify();
}

export function setSimulatedOffline(forced: boolean): void {
  if (!canSimulate() || !canUseDevTools()) return;
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
  if (!navigator.onLine) return false;
  if (isFieldLinkDown()) return false;
  return true;
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => notify());
  window.addEventListener("offline", () => notify());
}
