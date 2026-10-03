/**
 * Go-live login roles. Everyone enters a PIN first.
 * Manager and Assistant Manager then confirm with their own email and password.
 * Everyone else who may use the app is PIN-only. Guardian and Dashboard cannot sign in.
 */

export type FloorRole = "driver" | "coordinator" | "carer";

export type PinPersonKind = "staff" | "carer";

export type PinProfile = {
  personKind: PinPersonKind;
  personId: string;
  fullName: string;
  role: FloorRole;
  staffRole: string | null;
  accessRole: string | null;
  authUserId: string;
};

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

/** System access level Manager or Assistant Manager. Job title is used only when access level is blank. */
export function isManagerLevelAccess(
  personnelType: string | null | undefined,
  roleTitle?: string | null,
): boolean {
  const access = norm(personnelType);
  if (access === "manager" || access === "assistant_manager") return true;
  if (access) return false;
  const title = norm(roleTitle);
  return (
    title === "manager" ||
    title === "assistant_manager" ||
    title === "coordinator" ||
    title.includes("manager")
  );
}

export function isBlockedTerminalAccess(
  personnelType: string | null | undefined,
  roleTitle?: string | null,
): "guardian" | "dashboard" | null {
  const access = norm(personnelType);
  const title = norm(roleTitle);
  if (access === "guardian" || title === "guardian") return "guardian";
  if (access === "dashboard" || title === "dashboard") return "dashboard";
  return null;
}

/** Same terminal split the app already uses: support workers and drivers open Manifest. */
export function floorRoleForStaff(
  personnelType: string | null | undefined,
  roleTitle: string | null | undefined,
): FloorRole | null {
  if (isBlockedTerminalAccess(personnelType, roleTitle)) return null;
  if (isManagerLevelAccess(personnelType, roleTitle)) return "coordinator";
  const access = norm(personnelType);
  const title = norm(roleTitle);
  const blob = `${access} ${title}`;
  if (
    access === "driver" ||
    access === "support_worker" ||
    access === "support" ||
    blob.includes("driver") ||
    blob.includes("support") ||
    blob.includes("volunteer") ||
    access === "" 
  ) {
    return "driver";
  }
  return "driver";
}

export function homeForRole(role: FloorRole): "/" | "/manifest" {
  return role === "driver" ? "/manifest" : "/";
}

const TRIVIAL_PINS = new Set(["123456", "654321", "012345"]);

export function trivialPinReason(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return "PIN must be 6 digits.";
  if (/^(\d)\1{5}$/.test(pin)) return "PIN cannot be the same digit repeated.";
  if (TRIVIAL_PINS.has(pin)) return "PIN is too easy to guess.";
  const nums = [...pin].map((d) => Number(d));
  const ascending = nums.every((n, i) => i === 0 || n === nums[i - 1]! + 1);
  const descending = nums.every((n, i) => i === 0 || n === nums[i - 1]! - 1);
  if (ascending || descending) return "PIN cannot be a straight run of digits.";
  return null;
}
