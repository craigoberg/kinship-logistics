import { BACKUP_FORMAT_VERSION, BACKUP_PRODUCT_LABEL } from "./constants";

export interface BackupTableBundle {
  rowCount: number;
  rows: Record<string, unknown>[];
}

export interface BackupManifest {
  version: typeof BACKUP_FORMAT_VERSION;
  label: string;
  createdAt: string;
  sourceProjectRef: string;
  tableCount: number;
  rowCount: number;
  tables: Record<string, BackupTableBundle>;
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
  if (m.version !== BACKUP_FORMAT_VERSION) {
    throw new Error(`Unsupported backup version: ${String(m.version)}`);
  }
  if (!m.label || !m.createdAt || !m.tables || typeof m.tables !== "object") {
    throw new Error("Backup file is missing required manifest fields.");
  }
  return m as BackupManifest;
}
