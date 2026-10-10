/**
 * DEV/TEST tools (SIM time, simulate offline, Reset Start of Day, Show diag,
 * Cancel / Reset Trip on a test build) are presented only when Craig is the
 * signed-in person. Production builds never show them (`IS_TEST_BUILD`).
 */
import { useEffect, useState } from "react";
import { ACTIVE_PROFILE_EVENT } from "@/lib/active-profile-event";
import { getActiveUserProfile } from "@/lib/data-store";
import { IS_TEST_BUILD } from "@/lib/test-mode";

/** Live staff_registry id for Craig Oberg. Name match covers a restored row. */
const CRAIG_STAFF_ID = "68a17753-d387-4b53-a466-40cf1d06a384";

export function canUseDevTools(): boolean {
  if (!IS_TEST_BUILD) return false;
  if (typeof window === "undefined") return false;
  const profile = getActiveUserProfile();
  if (!profile || profile.personKind === "carer") return false;
  if (profile.staffId === CRAIG_STAFF_ID) return true;
  return profile.fullName.trim().toLowerCase() === "craig oberg";
}

/** False until mounted, then tracks sign-in / sign-out. */
export function useCanUseDevTools(): boolean {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const sync = () => setAllowed(canUseDevTools());
    sync();
    window.addEventListener(ACTIVE_PROFILE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ACTIVE_PROFILE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return allowed;
}
