import {
  AUTH_PROTECTED_TABLES,
  BACKUP_FORMAT_VERSION,
} from "@/lib/backup-restore/constants";
import {
  buildBackupLabel,
  projectRefFromSupabaseUrl,
  type BackupManifest,
  type BackupTableBundle,
} from "@/lib/backup-restore/manifest";
import {
  createPublishableServerClient,
  createServiceServerClient,
  getServerSupabaseUrl,
} from "@/lib/supabase.server";

const PAGE_SIZE = 1000;

export interface BackupSummary {
  label: string;
  tableCount: number;
  rowCount: number;
  tables: { name: string; rowCount: number }[];
}

async function listPublicTables(client = createPublishableServerClient()): Promise<string[]> {
  const { data, error } = await client.rpc("list_backup_tables");
  if (error) {
    throw new Error(
      `list_backup_tables RPC failed. Apply docs/sql/2026-07-11_backup_restore_rpcs.sql — ${error.message}`,
    );
  }
  return ((data ?? []) as { table_name: string }[] | string[]).map((row) =>
    typeof row === "string" ? row : row.table_name,
  );
}

async function orderTablesForRestore(
  tables: string[],
  client = createPublishableServerClient(),
): Promise<string[]> {
  const { data, error } = await client.rpc("order_tables_for_restore", {
    p_tables: tables,
  });
  if (error) throw new Error(`order_tables_for_restore failed: ${error.message}`);
  return (data as string[] | null) ?? tables;
}

async function fetchTableRows(
  tableName: string,
  client = createPublishableServerClient(),
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await client
      .from(tableName)
      .select("*")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Backup read failed on ${tableName}: ${error.message}`);
    const batch = (data ?? []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

export async function summarizeBackupTarget(): Promise<BackupSummary> {
  const tables = await listPublicTables();
  const preview = await Promise.all(
    tables.map(async (name) => {
      const { count, error } = await createPublishableServerClient()
        .from(name)
        .select("*", { count: "exact", head: true });
      if (error) throw new Error(`Count failed on ${name}: ${error.message}`);
      return { name, rowCount: count ?? 0 };
    }),
  );

  return {
    label: buildBackupLabel(),
    tableCount: preview.length,
    rowCount: preview.reduce((sum, t) => sum + t.rowCount, 0),
    tables: preview,
  };
}

export async function createFullBackup(): Promise<BackupManifest> {
  const client = createPublishableServerClient();
  const tableNames = await listPublicTables();
  const tables: Record<string, BackupTableBundle> = {};
  let totalRows = 0;

  for (const tableName of tableNames) {
    const rows = await fetchTableRows(tableName, client);
    tables[tableName] = { rowCount: rows.length, rows };
    totalRows += rows.length;
  }

  return {
    version: BACKUP_FORMAT_VERSION,
    label: buildBackupLabel(),
    createdAt: new Date().toISOString(),
    sourceProjectRef: projectRefFromSupabaseUrl(getServerSupabaseUrl()),
    tableCount: tableNames.length,
    rowCount: totalRows,
    tables,
  };
}

export async function verifyManagerPin(staffId: string, pin: string): Promise<void> {
  const client = createPublishableServerClient();
  const { data, error } = await client.rpc("verify_operator_pin", {
    entered_pin: pin,
  });
  if (error) throw new Error(`PIN verification failed: ${error.message}`);

  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<{
    id: string;
    role: string | null;
  }>;
  const row = rows.find((r) => r.id === staffId);
  if (!row) throw new Error("Incorrect manager PIN.");

  // Match verifyCoordinatorPin / classifyRole — do not rely on is_manager RPC,
  // which may be missing or use a different arg name in some environments.
  const normalized = (row.role ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  const isCoordinator =
    normalized === "coordinator" ||
    normalized.includes("manager") ||
    normalized === "assistant_manager";
  if (!isCoordinator) {
    throw new Error("Selected operator is not a manager.");
  }
}

export interface RestoreOptions {
  preserveAuthCredentials: boolean;
  managerStaffId: string;
  managerPin: string;
}

export interface RestoreResult {
  truncatedTables: string[];
  restoredTables: string[];
  preservedTables: string[];
  skippedTables: string[];
  rowCount: number;
  warnings: string[];
}

export async function restoreFullBackup(
  manifest: BackupManifest,
  options: RestoreOptions,
): Promise<RestoreResult> {
  await verifyManagerPin(options.managerStaffId, options.managerPin);

  const service = createServiceServerClient();
  const readClient = createPublishableServerClient();
  const currentTables = await listPublicTables(readClient);
  const currentSet = new Set(currentTables);

  const preservedTables = options.preserveAuthCredentials
    ? [...AUTH_PROTECTED_TABLES]
    : [];

  const backupTableNames = Object.keys(manifest.tables);
  const tablesToTruncate = currentTables.filter((t) => !preservedTables.includes(t));
  const tablesToRestore = backupTableNames.filter((t) => currentSet.has(t));
  const skippedTables = backupTableNames.filter((t) => !currentSet.has(t));

  const warnings: string[] = [];
  if (skippedTables.length > 0) {
    warnings.push(
      `Skipped ${skippedTables.length} table(s) from backup that do not exist in this database.`,
    );
  }
  if (options.preserveAuthCredentials) {
    warnings.push(
      `Preserved local login tables: ${preservedTables.join(", ")}. DEV dummy PINs were not overwritten.`,
    );
  }

  const orderedTruncate = await orderTablesForRestore(tablesToTruncate, readClient);
  const { error: truncateErr } = await service.rpc("truncate_backup_tables", {
    p_tables: orderedTruncate,
  });
  if (truncateErr) {
    throw new Error(
      `Truncate failed. Ensure SUPABASE_SERVICE_ROLE_KEY is set and docs/sql/2026-07-11_backup_restore_rpcs.sql is applied — ${truncateErr.message}`,
    );
  }

  const orderedRestore = await orderTablesForRestore(
    tablesToRestore.filter((t) => !preservedTables.includes(t)),
    readClient,
  );

  let rowCount = 0;
  const restoredTables: string[] = [];

  for (const tableName of orderedRestore) {
    if (preservedTables.includes(tableName)) continue;
    const bundle = manifest.tables[tableName];
    if (!bundle?.rows?.length) {
      restoredTables.push(tableName);
      continue;
    }

    const chunkSize = 500;
    for (let i = 0; i < bundle.rows.length; i += chunkSize) {
      const chunk = bundle.rows.slice(i, i + chunkSize);
      const { error } = await service.from(tableName).insert(chunk);
      if (error) {
        throw new Error(`Restore insert failed on ${tableName}: ${error.message}`);
      }
    }

    rowCount += bundle.rows.length;
    restoredTables.push(tableName);
  }

  return {
    truncatedTables: orderedTruncate,
    restoredTables,
    preservedTables,
    skippedTables,
    rowCount,
    warnings,
  };
}
