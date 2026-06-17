import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarOff } from "lucide-react";
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
import {
  eachDateInRange,
  type AttendanceStatus,
  type NewAttendanceLog,
} from "@/lib/data-store";
import {
  useInsertAttendanceLog,
  useInsertAttendanceLogsBulk,
} from "@/hooks/use-supabase-data";
import { formatDate } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participantId: string;
  participantName: string;
}

const EXCEPTION_STATUSES: AttendanceStatus[] = ["Sick", "Cancelled", "Suspended"];

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Single-date Sick / Cancelled or multi-date Suspension exception writer.
 * Recurring `participant_attendance_schedules` rows are never mutated —
 * each day is written as a date-scoped row in `attendance_roster_logs`,
 * so the baseline schedule resumes the day after `endDate`. Any chargeable
 * ledger entry on those dates is automatically reconciled as
 * "Cancelled - No Charge".
 */
export function LogPlannedAbsenceModal({
  open,
  onOpenChange,
  participantId,
  participantName,
}: Props) {
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [status, setStatus] = useState<AttendanceStatus>("Sick");
  const [reason, setReason] = useState("");
  const [dirty, setDirty] = useState(false);
  const singleInsert = useInsertAttendanceLog();
  const bulkInsert = useInsertAttendanceLogsBulk();

  useEffect(() => {
    if (open) {
      const t = todayIso();
      setStartDate(t);
      setEndDate(t);
      setStatus("Sick");
      setReason("");
      setDirty(false);
    }
  }, [open]);

  const dates = useMemo(() => eachDateInRange(startDate, endDate), [startDate, endDate]);
  const pending = singleInsert.isPending || bulkInsert.isPending;
  const valid =
    startDate.length === 10 &&
    endDate.length === 10 &&
    dates.length > 0 &&
    reason.trim().length > 0;
  const canSubmit = dirty && valid && !pending;
  const isRange = dates.length > 1;
  const expectedService = isRange ? "Suspended (planned absence)" : "Planned absence";

  const submit = async () => {
    if (!canSubmit) return;
    try {
      if (isRange) {
        const rows: NewAttendanceLog[] = dates.map((d) => ({
          participantId,
          scheduleId: null,
          rosterDate: d,
          expectedService,
          actualStatus: status,
          driverNotes: reason.trim(),
        }));
        await bulkInsert.mutateAsync(rows);
        toast.success("Suspension range logged", {
          description: `${participantName} · ${dates.length} day${dates.length === 1 ? "" : "s"} (${formatDate(startDate)} → ${formatDate(endDate)}) · ${status}. Schedule auto-resumes after.`,
        });
      } else {
        await singleInsert.mutateAsync({
          participantId,
          scheduleId: null,
          rosterDate: startDate,
          expectedService: "Planned absence",
          actualStatus: status,
          driverNotes: reason.trim(),
        });
        toast.success("Planned absence logged", {
          description: `${participantName} · ${formatDate(startDate)} · ${status}. Weekly schedule untouched.`,
        });
      }
      onOpenChange(false);
    } catch (err) {
      toast.error("Could not log absence", { description: (err as Error).message });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle>Log planned absence / suspension</DialogTitle>
          <DialogDescription>
            Records date-scoped exceptions for {participantName}. The recurring
            weekly rule stays active and resumes after the suspension ends.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Start date
              </Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => {
                  const v = e.target.value;
                  setStartDate(v);
                  if (endDate < v) setEndDate(v);
                  setDirty(true);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                End date
              </Label>
              <Input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setDirty(true);
                }}
              />
            </div>
          </div>

          {dates.length > 0 && (
            <div className="rounded-md border border-info/40 bg-info/10 px-3 py-2 text-xs text-info-foreground">
              {isRange
                ? `Will write ${dates.length} day-scoped exception rows (${formatDate(startDate)} → ${formatDate(endDate)}).`
                : `One-day exception (${formatDate(startDate)}).`}
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Status
            </Label>
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v as AttendanceStatus);
                setDirty(true);
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

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Reason
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setDirty(true);
              }}
              rows={3}
              placeholder="Family notified — flu, medical appointment, extended holiday…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit} className="gap-1.5">
            <CalendarOff className="h-4 w-4" />
            {pending
              ? "Saving…"
              : isRange
                ? `Log ${dates.length}-day suspension`
                : "Log absence"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
