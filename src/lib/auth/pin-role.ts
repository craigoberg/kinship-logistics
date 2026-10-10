/**
 * Go-live login roles. Everyone enters a PIN first.
 * Manager and Assistant Manager then confirm with their own email and password.
 * Everyone else who may use the app is PIN-only. Guardian and Dashboard cannot sign in.
 */
import { isManagerOrAssistantAccess, normalizeAccessRoleKey } from "@/lib/access-roles";

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

/**
 * System access level only. Role / title is a label and never grants or blocks this.
 * The second argument is ignored and kept so existing callers still compile.
 */
export function isManagerLevelAccess(
  personnelType: string | null | undefined,
  _roleTitle?: string | null,
): boolean {
  return isManagerOrAssistantAccess(personnelType);
}

export function isBlockedTerminalAccess(
  personnelType: string | null | undefined,
  _roleTitle?: string | null,
): "guardian" | "dashboard" | null {
  const access = normalizeAccessRoleKey(personnelType) ?? norm(personnelType);
  if (access === "guardian") return "guardian";
  if (access === "dashboard") return "dashboard";
  return null;
}

/** Office home for Manager and Assistant Manager. Everyone else who can sign in opens Manifest. */
export function floorRoleForStaff(
  personnelType: string | null | undefined,
  roleTitle?: string | null,
): FloorRole | null {
  if (isBlockedTerminalAccess(personnelType, roleTitle)) return null;
  if (isManagerLevelAccess(personnelType)) return "coordinator";
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
