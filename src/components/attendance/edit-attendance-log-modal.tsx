import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, WifiOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ATTENDANCE_STATUSES,
  getDeviceUuid,
  type AttendanceLog,
  type AttendanceStatus,
  type AttendanceSyncPayload,
} from "@/lib/data-store";
import { useUpdateAttendanceLog } from "@/hooks/use-supabase-data";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { enqueue } from "@/lib/sync-queue";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  log: AttendanceLog | null;
}

export function EditAttendanceLogModal({ open, onOpenChange, log }: Props) {
  const [status, setStatus] = useState<AttendanceStatus>("Pending");
  const [notes, setNotes] = useState("");
  const online = useOnlineStatus();
  const mutation = useUpdateAttendanceLog();

  useEffect(() => {
    if (log) {
      setStatus(log.actualStatus);
      setNotes(log.driverNotes ?? "");
    }
  }, [log, open]);

  if (!log) return null;

  const statusDirty = status !== log.actualStatus;
  const notesDirty = (notes ?? "") !== (log.driverNotes ?? "");
  const dirty = statusDirty || notesDirty;
  const canSubmit = dirty && !mutation.isPending;

  const buildPayload = (
    network: "online" | "offline",
  ): AttendanceSyncPayload => ({
    attendance_log_id: log.id,
    participant_id: log.participantId,
    roster_date: log.rosterDate,
    expected_service: log.expectedService,
    patch: {
      ...(statusDirty ? { actual_status: status } : {}),
      ...(notesDirty ? { driver_notes: notes.trim() || null } : {}),
    },
    network_state: network,
    device_uuid: getDeviceUuid(),
    timestamp: new Date().toISOString(),
  });

  const submit = async () => {
    if (!canSubmit) return;
    if (!online) {
      enqueue(
        "attendance_log",
        buildPayload("offline") as unknown as Record<string, unknown>,
      );
      toast.info("Queued offline", {
        description:
          "Attendance change is parked in the sync queue and will forward when back online.",
      });
      onOpenChange(false);
      return;
    }
    try {
      await mutation.mutateAsync({
        id: log.id,
        participantId: log.participantId,
        rosterDate: log.rosterDate,
        patch: {
          ...(statusDirty ? { actualStatus: status } : {}),
          ...(notesDirty ? { driverNotes: notes.trim() || null } : {}),
        },
      });
      toast.success("Attendance updated", {
        description: `${log.rosterDate} · ${status}.`,
      });
      onOpenChange(false);
    } catch (err) {
      // Network/server failure — fall back to offline queue with same envelope.
      enqueue(
        "attendance_log",
        buildPayload("offline") as unknown as Record<string, unknown>,
      );
      toast.warning("Saved offline", {
        description: `Will retry automatically. (${(err as Error).message})`,
      });
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle>Update attendance</DialogTitle>
          <DialogDescription>
            {log.rosterDate} · {log.expectedService}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Actual status
            </Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as AttendanceStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ATTENDANCE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Driver / coordinator notes
            </Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Optional context (illness, transport delay, etc.)"
            />
          </div>

          {!online && (
            <div className="flex items-center gap-2 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
              <WifiOff className="h-3.5 w-3.5" />
              Offline — change will be queued as ATTENDANCE_LOG.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit} className="gap-1.5">
            <Save className="h-4 w-4" />
            {mutation.isPending
              ? "Saving…"
              : online
                ? "Save changes"
                : "Queue offline"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
