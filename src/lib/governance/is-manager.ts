import { getActiveUserProfile } from "@/lib/data-store";

export function isManagerProfile(): boolean {
  const profile = getActiveUserProfile();
  if (!profile) return false;
  return (profile.staffRole ?? "").toLowerCase().includes("manager");
}
