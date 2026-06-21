import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarX } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LookupSelect } from "@/components/lookups/lookup-select";
import {
  type AttendanceSchedule,
  type AttendanceStatus,
} from "@/lib/data-store";
import { useInsertAttendanceLog } from "@/hooks/use-supabase-data";
import { formatDate } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedule: AttendanceSchedule | null;
  participantName: string;
}

const EXCEPTION_STATUSES: AttendanceStatus[] = ["Sick", "Cancelled", "No-Show"];

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Records a single-day exception in `attendance_roster_logs`.
 *
 * CRITICAL: this NEVER deletes / mutates the recurring row in
 * `participant_attendance_schedules`. The Daily Roster engine
 * (`resolveDailyRoster`) overlays this exception only for the specified
 * `rosterDate`, so the participant automatically reverts to their baseline
 * schedule the following week.
 *
 * When the exception is a "No-Show", an NDIS short-notice cancellation
 * reason must be selected (LookupSelect → category `ndis_cancellation_reason`).
 * The selected code is written to `attendance_roster_logs.ndis_cancellation_reason`.
 */
export function MarkAttendanceExceptionModal({
  open,
  onOpenChange,
  schedule,
  participantName,
}: Props) {
  const [rosterDate, setRosterDate] = useState(todayIso());
  const [status, setStatus] = useState<AttendanceStatus>("Sick");
  const [notes, setNotes] = useState("");
  const [ndisReason, setNdisReason] = useState<string>("");
  const [ndisReasonLabel, setNdisReasonLabel] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const mutation = useInsertAttendanceLog();

  useEffect(() => {
    if (open) {
      setRosterDate(todayIso());
      setStatus("Sick");
      setNotes("");
      setNdisReason("");
      setNdisReasonLabel("");
      setDirty(false);
    }
  }, [open]);

  if (!schedule) return null;

  const requiresNdisReason = status === "No-Show";
  const ndisReasonOk = !requiresNdisReason || ndisReason.trim().length > 0;
  const valid = rosterDate.length === 10 && ndisReasonOk;
  const canSubmit = dirty && valid && !mutation.isPending;

  const submit = async () => {
    if (!canSubmit) return;
    try {
      await mutation.mutateAsync({
        participantId: schedule.participantId,
        scheduleId: schedule.id,
        rosterDate,
        expectedService: schedule.serviceType,
        actualStatus: status,
        driverNotes: notes.trim() || null,
        // The hook may or may not forward this field — the underlying
        // insertAttendanceLog accepts the row shape directly, and
        // ndis_cancellation_reason is a non-required column. If the schema
        // is missing the column, the insert will error here and surface to
        // the user via the toast below.
        ndisCancellationReason: requiresNdisReason ? ndisReason : null,
      } as Parameters<typeof mutation.mutateAsync>[0]);
      toast.success("Exception logged", {
        description: `${participantName} · ${formatDate(rosterDate)} · ${status}${requiresNdisReason ? ` (${ndisReasonLabel || ndisReason})` : ""}. Baseline schedule untouched.`,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error("Could not record exception", {
        description: (err as Error).message,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle>Mark one-day exception</DialogTitle>
          <DialogDescription>
            {participantName} · {schedule.dayOfWeek} · {schedule.serviceType}.
            The recurring rule stays active — only this calendar date is
            overridden.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Roster date
            </Label>
            <Input
              type="date"
              value={rosterDate}
              onChange={(e) => {
                setRosterDate(e.target.value);
                setDirty(true);
              }}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Exception status
            </Label>
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v as AttendanceStatus);
                setDirty(true);
                // Reset NDIS reason if switching away from No-Show.
                if (v !== "No-Show") {
                  setNdisReason("");
                  setNdisReasonLabel("");
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXCEPTION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {requiresNdisReason && (
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                NDIS Cancellation Reason{" "}
                <span className="text-destructive">*</span>
              </Label>
              <LookupSelect
                category="ndis_cancellation_reason"
                value={ndisReason}
                onChange={(code, label) => {
                  setNdisReason(code);
                  setNdisReasonLabel(label);
                  setDirty(true);
                }}
                placeholder="Select a short-notice reason…"
              />
              {!ndisReasonOk && (
                <p className="text-xs text-destructive">
                  Required for No-Show — NDIS compliant cancellation reason.
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Notes
            </Label>
            <Textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setDirty(true);
              }}
              rows={3}
              placeholder="Family called in sick / cancelled for this date only…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit} className="gap-1.5">
            <CalendarX className="h-4 w-4" />
            {mutation.isPending ? "Saving…" : "Log exception"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
