import { useEffect, useState, useSyncExternalStore } from "react";
import {
  isSimulatedOffline,
  subscribeSimulatedOffline,
} from "@/lib/simulated-offline";

/**
 * Effective online status for the app.
 * Respects DEV "Simulate offline" switch (BL-082) as well as navigator.onLine.
 */
export function useOnlineStatus(): boolean {
  // Default true during SSR/hydration to avoid server/client mismatches.
  const [browserOnline, setBrowserOnline] = useState(true);
  const simOffline = useSyncExternalStore(
    subscribeSimulatedOffline,
    isSimulatedOffline,
    () => false,
  );

  useEffect(() => {
    setBrowserOnline(navigator.onLine);
    const on = () => setBrowserOnline(true);
    const off = () => setBrowserOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (simOffline) return false;
  return browserOnline;
}
