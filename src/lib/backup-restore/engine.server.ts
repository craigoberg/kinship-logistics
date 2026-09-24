import {
  BACKUP_FORMAT_VERSION,
  PRESERVE_LOCAL_TABLES,
} from "@/lib/backup-restore/constants";
import {
  buildBackupLabel,
  projectRefFromSupabaseUrl,
  type BackupManifest,
  type BackupTableBundle,
} from "@/lib/backup-restore/manifest";
import { orderTablesBySchemaCatalog } from "@/lib/backup-restore/order-tables";
import { prepareRowsForRestore } from "@/lib/backup-restore/sanitize-rows";
import { applySchemaCatalog } from "@/lib/backup-restore/schema-apply.server";
import {
  isSchemaCatalog,
  schemaCatalogSummary,
  type SchemaCatalog,
} from "@/lib/backup-restore/schema-catalog";
import { createServiceServerClient, getServerSupabaseUrl } from "@/lib/supabase.server";
import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE_SIZE = 1000;

export interface BackupSummary {
  label: string;
  tableCount: number;
  rowCount: number;
  tables: { name: string; rowCount: number }[];
}

async function listPublicTables(client = createServiceServerClient()): Promise<string[]> {
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
  client = createServiceServerClient(),
): Promise<string[]> {
  const { data, error } = await client.rpc("order_tables_for_restore", {
    p_tables: tables,
  });
  if (error) throw new Error(`order_tables_for_restore failed: ${error.message}`);
  return (data as string[] | null) ?? tables;
}

async function fetchSchemaCatalog(
  client = createServiceServerClient(),
): Promise<SchemaCatalog> {
  const { data, error } = await client.rpc("export_backup_schema_catalog");
  if (error) {
    throw new Error(
      `export_backup_schema_catalog failed. Apply docs/sql/2026-08-05_backup_schema_catalog_rpcs.sql — ${error.message}`,
    );
  }
  if (!isSchemaCatalog(data)) {
    throw new Error("export_backup_schema_catalog returned an unexpected shape.");
  }
  return data;
}

async function fetchTableRows(
  tableName: string,
  client = createServiceServerClient(),
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
      const { count, error } = await createServiceServerClient()
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
  const client = createServiceServerClient();
  const tableNames = await listPublicTables();
  const schema = await fetchSchemaCatalog(client);
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
    schema,
  };
}

export async function verifyManagerPin(staffId: string, pin: string): Promise<void> {
  const client = createServiceServerClient();
  const { data, error } = await client.rpc("verify_operator_pin", {
    entered_pin: pin,
  });
  if (error) throw new Error(`PIN verification failed: ${error.message}`);

  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<{
    id: string;
    role: string | null;
    personnel_type?: string | null;
  }>;
  const row = rows.find((r) => r.id === staffId);
  if (!row) throw new Error("Incorrect manager PIN.");

  const access = (row.personnel_type ?? row.role ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  const isCoordinator =
    access === "coordinator" ||
    access === "manager" ||
    access === "assistant_manager" ||
    access.includes("manager");
  if (!isCoordinator) {
    throw new Error("Selected operator is not a manager.");
  }
}

async function insertRestoreRows(
  service: SupabaseClient,
  tableName: string,
  rows: Record<string, unknown>[],
  warnings: string[],
  options?: { quietSkips?: boolean },
): Promise<{ inserted: number; failed: Record<string, unknown>[] }> {
  const prepared = prepareRowsForRestore(tableName, rows);
  warnings.push(...prepared.warnings);
  if (prepared.rows.length === 0) return { inserted: 0, failed: [] };

  const chunkSize = 500;
  let inserted = 0;
  const failed: Record<string, unknown>[] = [];
  const skipSamples: string[] = [];

  for (let i = 0; i < prepared.rows.length; i += chunkSize) {
    const chunk = prepared.rows.slice(i, i + chunkSize);
    const { error } = await service.from(tableName).insert(chunk);
    if (!error) {
      inserted += chunk.length;
      continue;
    }

    for (const row of chunk) {
      const { error: rowErr } = await service.from(tableName).insert(row);
      if (rowErr) {
        failed.push(row);
        if (!options?.quietSkips && skipSamples.length < 5) {
          const ref = String(row.id ?? row.key ?? row.uuid ?? "unknown");
          skipSamples.push(`${tableName} (${ref}): ${rowErr.message}`);
        }
      } else {
        inserted += 1;
      }
    }
  }

  if (!options?.quietSkips && failed.length > 0) {
    warnings.push(
      `Skipped ${failed.length} row(s) in ${tableName}` +
        (skipSamples.length
          ? ` — e.g. ${skipSamples[0]}${failed.length > 1 ? ` (+${failed.length - 1} more)` : ""}`
          : "."),
    );
  }

  return { inserted, failed };
}

async function orderTablesForDataRestore(
  tables: string[],
  catalog: SchemaCatalog | null,
  client: SupabaseClient,
): Promise<string[]> {
  if (catalog) {
    return orderTablesBySchemaCatalog(tables, catalog);
  }
  return orderTablesForRestore(tables, client);
}

export interface RestoreOptions {
  /** Create/align tables, FKs, indexes, RPCs, triggers, RLS from backup schema */
  applyStructure: boolean;
  /** Truncate + reload public table rows */
  restoreData: boolean;
  /**
   * When restoreData is true: overwrite staff_registry / env protected tables.
   * When false: preserve local login + env config (DEV-safe).
   */
  restoreLoginDetails: boolean;
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
  schemaApplied: boolean;
  schemaStatements: number;
}

export async function restoreFullBackup(
  manifest: BackupManifest,
  options: RestoreOptions,
): Promise<RestoreResult> {
  await verifyManagerPin(options.managerStaffId, options.managerPin);

  if (!options.applyStructure && !options.restoreData) {
    throw new Error("Select at least one of: Apply infrastructure, Restore table data.");
  }

  const service = createServiceServerClient();
  const warnings: string[] = [];
  let schemaApplied = false;
  let schemaStatements = 0;

  // ---- Structure first (discovers missing tables before data load) ----
  if (options.applyStructure) {
    if (!manifest.schema || !isSchemaCatalog(manifest.schema)) {
      throw new Error(
        "This backup has no schema catalog (v1 or incomplete v2). Create a new backup after applying 2026-08-05_backup_schema_catalog_rpcs.sql, or uncheck Apply infrastructure.",
      );
    }
    const applied = await applySchemaCatalog(service, manifest.schema);
    schemaApplied = true;
    schemaStatements = applied.statements;
    warnings.push(
      `Applied schema from backup (${schemaCatalogSummary(manifest.schema)}; ${applied.statements} DDL steps).`,
    );
    warnings.push(...applied.warnings);
  }

  if (!options.restoreData) {
    return {
      truncatedTables: [],
      restoredTables: [],
      preservedTables: [],
      skippedTables: [],
      rowCount: 0,
      warnings,
      schemaApplied,
      schemaStatements,
    };
  }

  // Re-list tables after schema apply (new tables appear)
  const currentTables = await listPublicTables(service);
  const currentSet = new Set(currentTables);

  const preservedTables = options.restoreLoginDetails
    ? []
    : [...PRESERVE_LOCAL_TABLES];

  const backupTableNames = Object.keys(manifest.tables);
  const tablesToTruncate = currentTables.filter((t) => !preservedTables.includes(t));
  const tablesToRestore = backupTableNames.filter((t) => currentSet.has(t));
  const skippedTables = backupTableNames.filter((t) => !currentSet.has(t));

  if (skippedTables.length > 0) {
    warnings.push(
      `Skipped ${skippedTables.length} table(s) from backup that do not exist in this database` +
        (options.applyStructure
          ? " even after schema apply."
          : ". Enable Apply infrastructure, or create tables first."),
    );
  }
  if (!options.restoreLoginDetails) {
    warnings.push(
      `Preserved local login/config tables: ${preservedTables.join(", ")}.`,
    );
  } else {
    warnings.push("Login details restored from backup (staff_registry and env tables overwritten).");
  }

  const catalog: SchemaCatalog | null =
    manifest.schema && isSchemaCatalog(manifest.schema) ? manifest.schema : null;

  const orderedTruncate = await orderTablesForDataRestore(
    tablesToTruncate,
    catalog,
    service,
  );
  const { error: truncateErr } = await service.rpc("truncate_backup_tables", {
    p_tables: orderedTruncate,
  });
  if (truncateErr) {
    throw new Error(
      `Truncate failed. Ensure SUPABASE_SERVICE_ROLE_KEY is set and docs/sql/2026-07-11_backup_restore_rpcs.sql is applied — ${truncateErr.message}`,
    );
  }

  // Hard gate: drop ALL public FKs before inserts (one RPC). Without this, child
  // tables fail when parents sort wrong or session rows load after attendance.
  const { data: droppedFkCount, error: dropFkErr } = await service.rpc(
    "backup_drop_all_public_fks",
  );
  if (dropFkErr) {
    throw new Error(
      `FK load window unavailable — apply docs/sql/2026-08-05_backup_fk_load_window.sql on this database, then hard-refresh. (${dropFkErr.message})`,
    );
  }
  warnings.push(
    `FK load window: dropped ${Number(droppedFkCount ?? 0)} foreign key(s) before data insert.`,
  );

  const restoreTargets = tablesToRestore.filter((t) => !preservedTables.includes(t));
  const orderedRestore = await orderTablesForDataRestore(
    restoreTargets,
    catalog,
    service,
  );

  let rowCount = 0;
  const restoredTables: string[] = [];
  /** Rows that failed first pass — retry after all parents are loaded */
  const retryQueue: { tableName: string; rows: Record<string, unknown>[] }[] = [];

  for (const tableName of orderedRestore) {
    const bundle = manifest.tables[tableName];
    if (!bundle?.rows?.length) {
      restoredTables.push(tableName);
      continue;
    }

    const result = await insertRestoreRows(service, tableName, bundle.rows, warnings, {
      quietSkips: true,
    });
    rowCount += result.inserted;
    restoredTables.push(tableName);
    if (result.failed.length) {
      retryQueue.push({ tableName, rows: result.failed });
    }
  }

  // Second pass: parents from earlier failures may now exist
  let retrySkipped = 0;
  for (const item of retryQueue) {
    const result = await insertRestoreRows(service, item.tableName, item.rows, warnings);
    rowCount += result.inserted;
    retrySkipped += result.failed.length;
  }
  if (retryQueue.length) {
    warnings.push(
      `Retry pass: re-attempted rows from ${retryQueue.length} table(s); ${retrySkipped} still skipped.`,
    );
  }

  const { data: restoredFkCount, error: restoreFkErr } = await service.rpc(
    "backup_restore_all_public_fks",
  );
  if (restoreFkErr) {
    warnings.push(
      `WARNING: could not re-apply FKs after data load — run SELECT backup_restore_all_public_fks(); in SQL Editor. (${restoreFkErr.message})`,
    );
  } else {
    warnings.push(
      `FK load window: re-applied ${Number(restoredFkCount ?? 0)} foreign key(s) (orphans left NOT VALID if validate failed).`,
    );
  }

  return {
    truncatedTables: orderedTruncate,
    restoredTables,
    preservedTables,
    skippedTables,
    rowCount,
    warnings,
    schemaApplied,
    schemaStatements,
  };
}
