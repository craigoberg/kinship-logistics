import {
  BACKUP_FORMAT_VERSION,
  BACKUP_FORMAT_VERSIONS,
  BACKUP_PRODUCT_LABEL,
} from "./constants";
import {
  isSchemaCatalog,
  type SchemaCatalog,
} from "./schema-catalog";

export interface BackupTableBundle {
  rowCount: number;
  rows: Record<string, unknown>[];
}

export interface BackupManifest {
  version: (typeof BACKUP_FORMAT_VERSIONS)[number];
  label: string;
  createdAt: string;
  sourceProjectRef: string;
  tableCount: number;
  rowCount: number;
  tables: Record<string, BackupTableBundle>;
  /** Present on v2 backups — live-discovered public schema at backup time */
  schema?: SchemaCatalog | null;
}

/** `20260711 - Yada Connect - Full Backup` */
export function buildBackupLabel(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d} - ${BACKUP_PRODUCT_LABEL} - Full Backup`;
}

export function backupFilename(label: string): string {
  return `${label}.json`;
}

export function projectRefFromSupabaseUrl(url: string | undefined): string {
  if (!url) return "unknown";
  const m = /https?:\/\/([^.]+)\.supabase\.co/i.exec(url);
  return m?.[1] ?? url;
}

export function parseBackupManifest(raw: unknown): BackupManifest {
  if (!raw || typeof raw !== "object") {
    throw new Error("Backup file is not valid JSON.");
  }
  const m = raw as Partial<BackupManifest>;
  const version = m.version as number | undefined;
  if (
    version == null ||
    !BACKUP_FORMAT_VERSIONS.includes(version as (typeof BACKUP_FORMAT_VERSIONS)[number])
  ) {
    throw new Error(`Unsupported backup version: ${String(m.version)}`);
  }
  if (!m.label || !m.createdAt || !m.tables || typeof m.tables !== "object") {
    throw new Error("Backup file is missing required manifest fields.");
  }
  let schema: SchemaCatalog | null | undefined = undefined;
  if (version >= 2) {
    if (m.schema != null && !isSchemaCatalog(m.schema)) {
      throw new Error("Backup v2 schema catalog is malformed.");
    }
    schema = m.schema ?? null;
  }
  return {
    ...(m as BackupManifest),
    version: version as BackupManifest["version"],
    schema,
  };
}

export { BACKUP_FORMAT_VERSION };
