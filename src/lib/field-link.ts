/**
 * Real offline: the short health read is what decides.
 * One slow Programme query must not latch the tablet.
 * The DEV switch stays off until the operator turns it off.
 */
import { onlineManager } from "@tanstack/react-query";
import {
  clearFieldLinkDown,
  isAppOnline,
  isFieldLinkDown,
  isSimulatedOffline,
  latchFieldLinkDown,
  subscribeSimulatedOffline,
} from "@/lib/simulated-offline";

const PROBE_MS = 2_000;
const POLL_MS = 60_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let probing = false;
let watchUrl = "";
let watchKey = "";

export async function probeFieldLink(supabaseUrl: string, apiKey: string): Promise<boolean> {
  if (isSimulatedOffline()) return false;
  if (probing) return !isFieldLinkDown();
  probing = true;
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/cms_pages?select=slug&status=eq.published&limit=1`,
      {
        method: "GET",
        headers: {
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(PROBE_MS),
      },
    );
    if (response.status < 500) {
      clearFieldLinkDown();
      return true;
    }
    latchFieldLinkDown();
    return false;
  } catch {
    latchFieldLinkDown();
    return false;
  } finally {
    probing = false;
  }
}

/** A data call failed. Latch only when the health read also fails. */
export function confirmLinkAfterFailure(): void {
  if (!watchUrl || isSimulatedOffline()) return;
  void probeFieldLink(watchUrl, watchKey);
}

export function startFieldLinkWatch(supabaseUrl: string, apiKey: string): void {
  if (typeof window === "undefined" || pollTimer) return;
  watchUrl = supabaseUrl;
  watchKey = apiKey;
  onlineManager.setEventListener((setOnline) => {
    const publish = () => {
      try {
        setOnline(isAppOnline());
      } catch {
        setOnline(true);
      }
    };
    const unsubscribe = subscribeSimulatedOffline(publish);
    publish();
    return unsubscribe;
  });
  const tick = () => {
    if (!isFieldLinkDown() && isAppOnline()) return;
    void probeFieldLink(supabaseUrl, apiKey);
  };
  pollTimer = window.setInterval(tick, POLL_MS);
  window.addEventListener("online", tick);
  void probeFieldLink(supabaseUrl, apiKey);
}
