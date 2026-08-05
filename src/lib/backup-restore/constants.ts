/** Tables whose rows must never be overwritten when restoring into DEV. */
export const AUTH_PROTECTED_TABLES = ["staff_registry"] as const;

/**
 * Environment-specific config — preserved alongside login credentials when
 * restoring PROD → DEV so SMS recipients, thresholds, etc. stay local.
 */
export const ENV_PROTECTED_TABLES = [
  "system_parameters",
  "offline_sync_logs",
  "myob_export_batches",
] as const;

/** All tables skipped when "Restore login details" is OFF. */
export const PRESERVE_LOCAL_TABLES = [
  ...AUTH_PROTECTED_TABLES,
  ...ENV_PROTECTED_TABLES,
] as const;

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

/** v1 = data only; v2 = data + live schema catalog */
export const BACKUP_FORMAT_VERSION = 2 as const;
export const BACKUP_FORMAT_VERSIONS = [1, 2] as const;

export const BACKUP_PRODUCT_LABEL = "Yada Connect";
