import { toast } from "sonner";
import { isManagerLevelAccess } from "@/lib/auth/pin-role";
import {
  resolveStaffFromPin,
  verifyNamedPersonPin,
} from "@/lib/auth/pin-session";

const announcedAt = new Map<string, number>();

/** One confirmation for the person whose PIN just succeeded. */
export function toastPinAccepted(fullName: string | null | undefined) {
  const name = fullName?.trim();
  if (!name) return;
  const now = Date.now();
  const prev = announcedAt.get(name) ?? 0;
  if (now - prev < 1500) return;
  announcedAt.set(name, now);
  toast.success(`${name} Pin accepted`);
}

/**
 * Staff id for the person who entered this PIN. Does not change the signed-in profile.
 */
export async function resolveOperatorStaffIdFromPin(
  pin: string,
  opts?: { announce?: boolean },
): Promise<string> {
  if (!/^\d{4}$|^\d{6}$/.test(pin)) {
    throw new Error("Incorrect operator PIN. Please try again.");
  }
  const who = await resolveStaffFromPin(pin);
  if (opts?.announce !== false) toastPinAccepted(who.fullName);
  return who.personId;
}

/** Any active staff PIN (action step-up). Does not switch the signed-in person. */
export async function verifyOperatorPin(
  pin: string,
  opts?: { announce?: boolean },
): Promise<void> {
  await resolveOperatorStaffIdFromPin(pin, opts);
}

/** Verify PIN belongs to a specific staff member (e.g. meal preparer attest). */
export async function verifyNamedStaffPin(
  staffId: string,
  pin: string,
  opts?: { announce?: boolean },
): Promise<void> {
  if (!staffId) throw new Error("Select the staff member first.");
  if (!/^\d{4}$|^\d{6}$/.test(pin)) {
    throw new Error("Incorrect PIN. Please try again.");
  }
  const who = await verifyNamedPersonPin({ personKind: "staff", personId: staffId, pin });
  if (opts?.announce !== false) toastPinAccepted(who.fullName);
}

/** Verify a manager or assistant manager PIN for a named person. */
export async function verifyManagerPin(
  managerStaffId: string,
  pin: string,
  opts?: { announce?: boolean },
): Promise<{ personnelType: string | null; roleTitle: string | null; fullName: string }> {
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
  if (opts?.announce !== false) toastPinAccepted(who.fullName);
  return who;
}
