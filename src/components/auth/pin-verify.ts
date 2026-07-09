import {
  DEFAULT_STAFF_UUID,
  getActiveUserProfile,
  getStaffId,
  verifyCoordinatorPin,
  verifyStaffPin,
  loginWithPin,
  GuardianPinError,
} from "@/lib/data-store";

/** Verify the signed-in operator's 4-digit PIN. */
export async function verifyOperatorPin(pin: string): Promise<void> {
  const operatorStaffId =
    getActiveUserProfile()?.staffId ?? getStaffId() ?? DEFAULT_STAFF_UUID;
  if (!/^\d{4}$/.test(pin)) {
    throw new Error("Incorrect operator PIN. Please try again.");
  }
  const ok = await verifyStaffPin(operatorStaffId, pin);
  if (!ok) throw new Error("Incorrect operator PIN. Please try again.");
}

/** Verify a manager/coordinator PIN (4–6 digits). */
export async function verifyManagerPin(managerStaffId: string, pin: string): Promise<void> {
  if (!managerStaffId) throw new Error("Please select the authorising manager.");
  if (!/^\d{4,6}$/.test(pin)) {
    throw new Error("Incorrect manager PIN. Please try again.");
  }
  try {
    const ok = await verifyCoordinatorPin(managerStaffId, pin);
    if (!ok) throw new Error("Incorrect manager PIN. Please try again.");
  } catch (roleErr: unknown) {
    throw new Error(
      roleErr instanceof Error ? roleErr.message : "Manager role verification failed.",
    );
  }
}

/** Terminal login — 4-digit PIN. Returns profile on success. */
export async function verifyLoginPin(pin: string) {
  if (!/^\d{4}$/.test(pin)) {
    throw new Error("Incorrect PIN. Please try again.");
  }
  try {
    const profile = await loginWithPin(pin);
    if (!profile) throw new Error("Incorrect PIN. Please try again.");
    return profile;
  } catch (e) {
    if (e instanceof GuardianPinError) throw e;
    throw new Error("Sign-in failed. Check your connection and retry.");
  }
}
