import { AUTH_PROTECTED_TABLES, PRESERVE_LOCAL_TABLES } from "@/lib/backup-restore/constants";
import {
  backupFilename,
  buildBackupLabel,
  parseBackupManifest,
  type BackupManifest,
} from "@/lib/backup-restore/manifest";
import {
  getBackupSummary,
  runFullBackup,
  runFullRestore,
} from "@/lib/api/backup-restore.functions";

export interface BackupTablePreview {
  name: string;
  rowCount: number;
}

export interface BackupSummary {
  label: string;
  tableCount: number;
  rowCount: number;
  tables: BackupTablePreview[];
}

export interface RestoreResult {
  truncatedTables: string[];
  restoredTables: string[];
  preservedTables: string[];
  skippedTables: string[];
  rowCount: number;
  warnings: string[];
}

/** True when running Vite dev or VITE_APP_ENV is not production. */
export function shouldDefaultPreserveAuth(): boolean {
  if (import.meta.env.VITE_APP_ENV === "production") return false;
  if (import.meta.env.VITE_APP_ENV === "development" || import.meta.env.VITE_APP_ENV === "dev") {
    return true;
  }
  return import.meta.env.DEV;
}

export function getProtectedTableLabels(): readonly string[] {
  return PRESERVE_LOCAL_TABLES;
}

export function getAuthProtectedTableLabels(): readonly string[] {
  return AUTH_PROTECTED_TABLES;
}

export async function fetchBackupSummary(): Promise<BackupSummary> {
  const json = await getBackupSummary();
  if (!json.ok || !json.summary) {
    throw new Error(json.error ?? "Could not load backup summary.");
  }
  return json.summary;
}

export async function downloadFullBackup(): Promise<{ manifest: BackupManifest; filename: string }> {
  const json = await runFullBackup();
  if (!json.ok || !json.manifest) {
    throw new Error(json.error ?? "Backup download failed.");
  }
  return { manifest: json.manifest, filename: backupFilename(json.manifest.label) };
}

export function saveBackupToDisk(manifest: BackupManifest): void {
  const blob = new Blob([JSON.stringify(manifest, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = backupFilename(manifest.label);
  a.click();
  URL.revokeObjectURL(url);
}

export async function restoreFromBackup(args: {
  manifest: BackupManifest;
  preserveAuthCredentials: boolean;
  managerStaffId: string;
  managerPin: string;
}): Promise<RestoreResult> {
  const json = await runFullRestore({
    data: {
      manifest: args.manifest,
      preserveAuthCredentials: args.preserveAuthCredentials,
      managerStaffId: args.managerStaffId,
      managerPin: args.managerPin,
    },
  });
  if (!json.ok || !json.result) {
    throw new Error(json.error ?? "Restore failed.");
  }
  return json.result;
}

export async function readBackupFile(file: File): Promise<BackupManifest> {
  const text = await file.text();
  return parseBackupManifest(JSON.parse(text));
}

export function nextBackupLabelPreview(): string {
  return buildBackupLabel();
}
