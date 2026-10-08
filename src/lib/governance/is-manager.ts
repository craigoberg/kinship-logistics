import { isManagerLevelAccess } from "@/lib/auth/pin-role";
import { getActiveUserProfile } from "@/lib/data-store";

/** Signed-in person's system access level is Manager or Assistant Manager. */
export function isManagerProfile(): boolean {
  const profile = getActiveUserProfile();
  if (!profile) return false;
  return isManagerLevelAccess(profile.accessRole);
}
