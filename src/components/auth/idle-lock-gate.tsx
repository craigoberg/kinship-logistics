import { getActiveUserProfile } from "@/lib/data-store";
import { useIdleLock } from "@/hooks/use-idle-lock";
import { PinReauthDialog } from "@/components/auth/pin-reauth-dialog";

/**
 * Global idle PIN lock (BL-002 screen lock). Mount only on signed-in shells.
 */
export function IdleLockGate() {
  const { locked, unlock, minutes } = useIdleLock();
  const profile = getActiveUserProfile();
  const staffId = profile?.staffId ?? "";
  const name = profile?.fullName ?? "the signed-in staff member";

  return (
    <PinReauthDialog
      open={locked && !!staffId}
      onOpenChange={(next) => {
        if (!next) unlock();
      }}
      dismissible={false}
      requiredStaffId={staffId}
      title="Screen locked"
      description={`This tablet locked after ${minutes} minute${minutes === 1 ? "" : "s"} idle. Enter ${name}'s PIN to continue where you left off.`}
      onAuthenticated={unlock}
    />
  );
}
