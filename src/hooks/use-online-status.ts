import { useSyncExternalStore } from "react";
import { isAppOnline, subscribeSimulatedOffline } from "@/lib/simulated-offline";

/**
 * Effective online status for the app.
 * Off when the DEV switch is on, the browser has no link, or a database read has failed.
 * A successful health probe turns the failed-read latch back on.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribeSimulatedOffline, isAppOnline, () => true);
}
