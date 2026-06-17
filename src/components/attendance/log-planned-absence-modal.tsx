import { useEffect, useState } from "react";
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
import { type AttendanceStatus } from "@/lib/data-store";
import { useInsertAttendanceLog } from "@/hooks/use-supabase-data";
import { formatDate } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participantId: string;
  participantName: string;
}

const EXCEPTION_STATUSES: AttendanceStatus[] = ["Sick", "Cancelled"];

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Logs a single-date Sick / Cancelled exception directly to
 * `attendance_roster_logs`. The participant's recurring schedule in
 * `participant_attendance_schedules` is untouched, so the baseline rule
 * automatically resumes the following week.
 */
export function LogPlannedAbsenceModal({
  open,
  onOpenChange,
  participantId,
  participantName,
}: Props) {
  const [rosterDate, setRosterDate] = useState(todayIso());
  const [status, setStatus] = useState<AttendanceStatus>("Sick");
  const [reason, setReason] = useState("");
  const [dirty, setDirty] = useState(false);
  const mutation = useInsertAttendanceLog();

  useEffect(() => {
    if (open) {
      setRosterDate(todayIso());
      setStatus("Sick");
      setReason("");
      setDirty(false);
    }
  }, [open]);

  const valid = rosterDate.length === 10 && reason.trim().length > 0;
  const canSubmit = dirty && valid && !mutation.isPending;

  const submit = async () => {
    if (!canSubmit) return;
    try {
      await mutation.mutateAsync({
        participantId,
        scheduleId: null,
        rosterDate,
        expectedService: "Planned absence",
        actualStatus: status,
        driverNotes: reason.trim(),
      });
      toast.success("Planned absence logged", {
        description: `${participantName} · ${formatDate(rosterDate)} · ${status}. Weekly schedule untouched.`,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error("Could not log absence", {
        description: (err as Error).message,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle>Log planned absence / sick leave</DialogTitle>
          <DialogDescription>
            Records a one-day exception for {participantName}. The recurring
            weekly rule stays active and resumes the following week.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Date
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
              placeholder="Family notified — flu, medical appointment, holiday…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit} className="gap-1.5">
            <CalendarOff className="h-4 w-4" />
            {mutation.isPending ? "Saving…" : "Log absence"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
