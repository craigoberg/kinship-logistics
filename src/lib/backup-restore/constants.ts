/** Tables whose rows must never be overwritten when restoring into DEV. */
export const AUTH_PROTECTED_TABLES = ["staff_registry"] as const;

/**
 * Future RBAC tables — extend this list when BL-002 lands. Auth schema tables
 * (auth.users, sessions, etc.) are outside public.list_backup_tables() scope.
 */
export const FUTURE_AUTH_PROTECTED_TABLES = [
  "role_menu_access",
  "user_credentials",
  "staff_auth_links",
] as const;

/** Column-level preservation if row-level merge is added later. */
export const AUTH_PROTECTED_COLUMNS: Record<string, readonly string[]> = {
  staff_registry: ["pin_hash", "auth_user_id", "email", "phone"],
  participants: ["dual_witness_pin_hash"],
};

export const BACKUP_FORMAT_VERSION = 1 as const;

export const BACKUP_PRODUCT_LABEL = "Yada Connect";
