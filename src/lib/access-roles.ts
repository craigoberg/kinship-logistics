/**
 * Single source of truth for the operational role taxonomy used by both the
 * Admin → Menu Access matrix columns and the Personnel role dropdown.
 *
 * Keep this list in sync with whatever the access matrix exposes — both UIs
 * read directly from `ACCESS_ROLES` so adding/renaming a role here updates
 * both places.
 */
export interface AccessRole {
  /** Stable machine key persisted on staff_registry.role. */
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
