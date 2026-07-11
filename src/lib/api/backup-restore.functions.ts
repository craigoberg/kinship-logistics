import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  createFullBackup,
  restoreFullBackup,
  summarizeBackupTarget,
} from "@/lib/backup-restore/engine.server";
import { parseBackupManifest } from "@/lib/backup-restore/manifest";

export const getBackupSummary = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const summary = await summarizeBackupTarget();
    return { ok: true as const, summary };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "Backup summary failed.",
    };
  }
});

export const runFullBackup = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const manifest = await createFullBackup();
    return { ok: true as const, manifest };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "Backup failed.",
    };
  }
});

const restoreInput = z.object({
  manifest: z.unknown(),
  preserveAuthCredentials: z.boolean().optional(),
  managerStaffId: z.string().uuid(),
  managerPin: z.string().min(4).max(6),
});

export const runFullRestore = createServerFn({ method: "POST" })
  .inputValidator(restoreInput)
  .handler(async ({ data }) => {
    try {
      const manifest = parseBackupManifest(data.manifest);
      const result = await restoreFullBackup(manifest, {
        preserveAuthCredentials: data.preserveAuthCredentials !== false,
        managerStaffId: data.managerStaffId,
        managerPin: data.managerPin,
      });
      return { ok: true as const, result };
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : "Restore failed.",
      };
    }
  });
