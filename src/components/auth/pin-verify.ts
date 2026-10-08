import { isManagerLevelAccess } from "@/lib/auth/pin-role";
import {
  resolveStaffIdFromPin,
  verifyNamedPersonPin,
} from "@/lib/auth/pin-session";

/**
 * Staff id for the person who entered this PIN. Does not change the signed-in profile.
 */
export async function resolveOperatorStaffIdFromPin(pin: string): Promise<string> {
  if (!/^\d{4}$|^\d{6}$/.test(pin)) {
    throw new Error("Incorrect operator PIN. Please try again.");
  }
  return resolveStaffIdFromPin(pin);
}

/** Any active staff PIN (action step-up). Does not switch the signed-in person. */
export async function verifyOperatorPin(pin: string): Promise<void> {
  await resolveOperatorStaffIdFromPin(pin);
}

/** Verify PIN belongs to a specific staff member (e.g. meal preparer attest). */
export async function verifyNamedStaffPin(
  staffId: string,
  pin: string,
): Promise<void> {
  if (!staffId) throw new Error("Select the staff member first.");
  if (!/^\d{4}$|^\d{6}$/.test(pin)) {
    throw new Error("Incorrect PIN. Please try again.");
  }
  await verifyNamedPersonPin({ personKind: "staff", personId: staffId, pin });
}

/** Verify a manager or assistant manager PIN for a named person. */
export async function verifyManagerPin(
  managerStaffId: string,
  pin: string,
): Promise<{ personnelType: string | null; roleTitle: string | null }> {
  if (!managerStaffId) throw new Error("Please select the authorising manager.");
  if (!/^\d{4}$|^\d{6}$/.test(pin)) {
    throw new Error("Incorrect manager PIN. Please try again.");
  }
  const who = await verifyNamedPersonPin({
    personKind: "staff",
    personId: managerStaffId,
    pin,
  });
  if (!isManagerLevelAccess(who.personnelType)) {
    const level = who.personnelType?.trim() || "blank";
    throw new Error(
      `System access level is ${level}. Only Manager or Assistant Manager can do this.`,
    );
  }
  return who;
}
