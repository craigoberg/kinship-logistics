/**
 * Single source of truth for the operational role taxonomy used by both the
 * Admin → Menu Access matrix columns and the Personnel role dropdown.
 *
 * Keep this list in sync with whatever the access matrix exposes — both UIs
 * read directly from `ACCESS_ROLES` so adding/renaming a role here updates
 * both places.
 */
export interface AccessRole {
  /** Stable machine key persisted on staff_registry.personnel_type. */
  key: string;
  /** Human label shown in the matrix header and personnel dropdown. */
  label: string;
}

export const ACCESS_ROLES: readonly AccessRole[] = [
  { key: "manager", label: "Manager" },
  { key: "assistant_manager", label: "Assistant Manager" },
  { key: "guardian", label: "Guardian" },
  { key: "support_worker", label: "Support Worker" },
  { key: "driver", label: "Driver" },
  { key: "dashboard", label: "Dashboard (Display Only)" },
] as const;

export type AccessRoleKey = (typeof ACCESS_ROLES)[number]["key"];

const ACCESS_ROLE_KEY_SET = new Set<string>(ACCESS_ROLES.map((r) => r.key));

/** Normalise free text / personnel_type to an ACCESS_ROLES key, or null. */
export function normalizeAccessRoleKey(
  value: string | null | undefined,
): AccessRoleKey | null {
  const n = (value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (ACCESS_ROLE_KEY_SET.has(n)) return n as AccessRoleKey;
  return null;
}

/** True only for SYSTEM ACCESS LEVEL = Manager (not Assistant Manager). */
export function isManagerAccessRole(value: string | null | undefined): boolean {
  return normalizeAccessRoleKey(value) === "manager";
}

export function accessRoleLabel(value: string | null | undefined): string | null {
  const key = normalizeAccessRoleKey(value);
  if (!key) return null;
  return ACCESS_ROLES.find((r) => r.key === key)?.label ?? key;
}
