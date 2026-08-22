import { useCallback, useEffect, useState } from "react";
import { useAuthReady } from "@/hooks/use-auth-ready";
import { useActiveTrip } from "@/hooks/use-supabase-data";
import { useAuthIdleLockMinutes } from "@/hooks/use-system-parameters";
import {
  isIdlePastLock,
  readLastActivityMs,
  touchLastActivity,
} from "@/lib/auth/idle-lock";
import {
  DEFAULT_STAFF_UUID,
  getActiveUserProfile,
  getStaffId,
} from "@/lib/data-store";

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  "pointerdown",
  "keydown",
  "touchstart",
  "wheel",
];

/**
 * Locks the signed-in UI after Admin-configured idle minutes.
 * Wall-clock idle (not SIM). Skips while this staff has an active Manifest.
 */
export function useIdleLock() {
  const { user, isReady } = useAuthReady();
  const minutes = useAuthIdleLockMinutes();
  const staffId = getStaffId();
  const hasRealStaff = !!staffId && staffId !== DEFAULT_STAFF_UUID;
  const tripQ = useActiveTrip();
  const suppressForManifest =
    hasRealStaff && (tripQ.isPending || tripQ.data != null);

  const [locked, setLocked] = useState(false);

  const signedIn =
    isReady && !!user && !!getActiveUserProfile();

  const unlock = useCallback(() => {
    touchLastActivity();
    setLocked(false);
  }, []);

  useEffect(() => {
    if (!signedIn || minutes <= 0) {
      setLocked(false);
      return;
    }
    if (readLastActivityMs() == null) {
      touchLastActivity();
    }
  }, [signedIn, minutes]);

  useEffect(() => {
    if (!signedIn || minutes <= 0 || locked || suppressForManifest) return;

    const onActivity = () => {
      touchLastActivity();
    };
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onActivity, { capture: true, passive: true });
    }
    window.addEventListener("scroll", onActivity, { capture: true, passive: true });

    return () => {
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, onActivity, true);
      }
      window.removeEventListener("scroll", onActivity, true);
    };
  }, [signedIn, minutes, locked, suppressForManifest]);

  useEffect(() => {
    if (!signedIn || minutes <= 0) return;

    const tick = () => {
      if (suppressForManifest) {
        if (locked) setLocked(false);
        touchLastActivity();
        return;
      }
      if (isIdlePastLock(minutes)) {
        setLocked(true);
      }
    };

    tick();
    const id = window.setInterval(tick, 1000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [signedIn, minutes, suppressForManifest, locked]);

  return {
    locked: signedIn && minutes > 0 && locked && !suppressForManifest,
    unlock,
    minutes,
  };
}
