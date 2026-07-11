import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Database, Download, Loader2, Upload } from "lucide-react";

import { PinEntryDialog } from "@/components/auth/pin-entry-dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  canManageSystemParameters,
} from "@/lib/api/system-parameters";
import {
  downloadFullBackup,
  fetchBackupSummary,
  getProtectedTableLabels,
  nextBackupLabelPreview,
  readBackupFile,
  restoreFromBackup,
  saveBackupToDisk,
  shouldDefaultPreserveAuth,
  type BackupManifest,
} from "@/lib/api/backup-restore";
import { getActiveUserProfile, listStaffRegistry } from "@/lib/data-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function isManagerRole(staffRole: string | null | undefined): boolean {
  return (staffRole ?? "").toLowerCase().includes("manager");
}

export function BackupRestoreWorkspace() {
  const profile = useMemo(() => getActiveUserProfile(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingManifest, setPendingManifest] = useState<BackupManifest | null>(null);
  const [confirmRestoreOpen, setConfirmRestoreOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [preserveAuth, setPreserveAuth] = useState(shouldDefaultPreserveAuth);
  const [managerStaffId, setManagerStaffId] = useState(profile?.staffId ?? "");

  const permissionQ = useQuery({
    queryKey: ["backup-restore", "can-manage", profile?.staffId ?? "auth-user"],
    queryFn: () => canManageSystemParameters(profile?.staffId),
    staleTime: 30_000,
  });
  const canManage =
    permissionQ.data === true || isManagerRole(profile?.staffRole);

  const summaryQ = useQuery({
    queryKey: ["backup-restore", "summary"],
    queryFn: fetchBackupSummary,
    enabled: canManage,
    staleTime: 60_000,
  });

  const managersQ = useQuery({
    queryKey: ["backup-restore", "managers"],
    queryFn: async () => {
      const all = await listStaffRegistry();
      return all.filter(
        (s) => s.active && (s.role ?? "").toLowerCase().includes("manager"),
      );
    },
    enabled: canManage,
    staleTime: 120_000,
  });

  const backupMut = useMutation({
    mutationFn: downloadFullBackup,
    onSuccess: ({ manifest }) => {
      saveBackupToDisk(manifest);
      toast.success("Backup saved", {
        description: `${manifest.tableCount} tables, ${manifest.rowCount.toLocaleString()} rows.`,
      });
      summaryQ.refetch();
    },
    onError: (e: Error) =>
      toast.error("Backup failed", { description: e.message }),
  });

  const restoreMut = useMutation({
    mutationFn: async (pin: string) => {
      if (!pendingManifest) throw new Error("No backup file loaded.");
      const staffId = managerStaffId || profile?.staffId;
      if (!staffId) throw new Error("Select the authorising manager.");
      return restoreFromBackup({
        manifest: pendingManifest,
        preserveAuthCredentials: preserveAuth,
        managerStaffId: staffId,
        managerPin: pin,
      });
    },
    onSuccess: (result) => {
      setPinOpen(false);
      setConfirmRestoreOpen(false);
      setPendingManifest(null);
      toast.success("Restore completed", {
        description: `${result.rowCount.toLocaleString()} rows restored across ${result.restoredTables.length} tables.`,
      });
      if (result.warnings.length > 0) {
        toast.message("Restore notes", { description: result.warnings.join(" ") });
      }
      summaryQ.refetch();
    },
    onError: (e: Error) =>
      toast.error("Restore failed", { description: e.message }),
  });

  const protectedTables = getProtectedTableLabels();
  const summary = summaryQ.data;
  const managers = managersQ.data ?? [];

  const onFileChosen = async (file: File | undefined) => {
    if (!file) return;
    try {
      const manifest = await readBackupFile(file);
      setPendingManifest(manifest);
      setConfirmRestoreOpen(true);
    } catch (e) {
      toast.error("Invalid backup file", {
        description: e instanceof Error ? e.message : "Could not parse JSON.",
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (!canManage) {
    return (
      <section className="rounded-lg border border-border bg-card/30 p-4">
        <p className="text-sm text-muted-foreground">
          Manager access required for database backup and restore.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-lg border border-border bg-card/30 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <Database className="h-4 w-4" />
              Full database backup
            </h3>
            <p className="text-sm text-muted-foreground">
              Scans the live database each run to discover all public tables, then
              exports a JSON bundle named{" "}
              <code>{nextBackupLabelPreview()}.json</code>.
            </p>
          </div>
          <Badge variant="outline">
            {summary ? `${summary.tableCount} tables` : "Scanning…"}
          </Badge>
        </div>

        {summaryQ.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading table list…
          </div>
        ) : summaryQ.isError ? (
          <p className="text-sm text-destructive">
            {(summaryQ.error as Error).message}
          </p>
        ) : summary ? (
          <>
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-md border border-border/60 bg-background/50 p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Filename
                </div>
                <div className="mt-1 font-medium">{summary.label}.json</div>
              </div>
              <div className="rounded-md border border-border/60 bg-background/50 p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Tables
                </div>
                <div className="mt-1 font-medium">{summary.tableCount}</div>
              </div>
              <div className="rounded-md border border-border/60 bg-background/50 p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Rows
                </div>
                <div className="mt-1 font-medium">
                  {summary.rowCount.toLocaleString()}
                </div>
              </div>
            </div>

            <div className="max-h-64 overflow-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Table</TableHead>
                    <TableHead className="text-right">Rows</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.tables.map((t) => (
                    <TableRow key={t.name}>
                      <TableCell className="font-mono text-xs">{t.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.rowCount.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : null}

        <Button
          onClick={() => backupMut.mutate()}
          disabled={backupMut.isPending || summaryQ.isLoading}
        >
          {backupMut.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Create &amp; download backup
        </Button>
      </section>

      <section className="space-y-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <div className="space-y-1">
          <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Restore from backup
          </h3>
          <p className="text-sm text-muted-foreground">
            Clears all public tables (except protected login tables when enabled),
            then reloads every table from the backup file. Requires manager PIN and{" "}
            <code>SUPABASE_SERVICE_ROLE_KEY</code> on the server.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/60 p-3">
          <div className="space-y-0.5">
            <Label htmlFor="preserve-auth" className="text-sm font-medium">
              Preserve local login credentials
            </Label>
            <p className="text-xs text-muted-foreground">
              Keeps <code>{protectedTables.join(", ")}</code> untouched so DEV dummy
              PINs are not overwritten by a PROD restore. Extend when RBAC lands
              (BL-002).
            </p>
          </div>
          <Switch
            id="preserve-auth"
            checked={preserveAuth}
            onCheckedChange={setPreserveAuth}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Authorising manager</Label>
          <Select value={managerStaffId} onValueChange={setManagerStaffId}>
            <SelectTrigger>
              <SelectValue placeholder="Select manager" />
            </SelectTrigger>
            <SelectContent>
              {managers.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => onFileChosen(e.target.files?.[0])}
        />
        <Button
          variant="destructive"
          onClick={() => fileInputRef.current?.click()}
          disabled={restoreMut.isPending}
        >
          <Upload className="mr-2 h-4 w-4" />
          Choose backup file to restore
        </Button>
      </section>

      <AlertDialog open={confirmRestoreOpen} onOpenChange={setConfirmRestoreOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore full database?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {pendingManifest ? (
                  <>
                    <p>
                      <strong>{pendingManifest.label}</strong> from project{" "}
                      <code>{pendingManifest.sourceProjectRef}</code> —{" "}
                      {pendingManifest.tableCount} tables,{" "}
                      {pendingManifest.rowCount.toLocaleString()} rows.
                    </p>
                    <p>
                      This will truncate existing data and reload from the backup.
                      {preserveAuth
                        ? ` Login table(s) (${protectedTables.join(", ")}) will be preserved.`
                        : " All tables including staff PINs will be overwritten."}
                    </p>
                  </>
                ) : (
                  <p>No backup loaded.</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoreMut.isPending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={!pendingManifest || restoreMut.isPending}
              onClick={() => {
                setConfirmRestoreOpen(false);
                setPinOpen(true);
              }}
            >
              Continue — manager PIN required
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PinEntryDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        title="Authorise restore"
        description="Enter the selected manager's PIN. This cannot be undone."
        length={4}
        busy={restoreMut.isPending}
        onVerify={async (pin) => {
          await restoreMut.mutateAsync(pin);
        }}
      />
    </div>
  );
}
