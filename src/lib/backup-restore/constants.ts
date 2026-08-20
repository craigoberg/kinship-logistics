/**
 * Tables the anonymous (public) key may SELECT after the 2026-08-20
 * day-login RLS lock. Everything else in public is authenticated / service_role.
 * Keep in sync with docs/sql/2026-08-20_day_login_operational_rls.sql.
 */
export const PUBLIC_ANON_SELECT_TABLES = [
  "cms_pages",
  "cms_nav",
  "cms_media",
  "cms_publish_snapshots",
  "public_form_definitions",
] as const;

/** RPCs the anonymous key may EXECUTE (public website forms). */
export const PUBLIC_ANON_EXECUTE_FUNCTIONS = ["submit_public_form"] as const;

/** Backup / DDL RPCs — service_role only (never anon or authenticated). */
export const SERVICE_ROLE_ONLY_FUNCTIONS = [
  "list_backup_tables",
  "order_tables_for_restore",
  "export_backup_schema_catalog",
  "truncate_backup_tables",
  "exec_backup_ddl",
  "backup_drop_all_public_fks",
  "backup_restore_all_public_fks",
] as const;

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
