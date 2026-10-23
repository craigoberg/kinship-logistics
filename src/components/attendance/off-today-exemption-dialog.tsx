import { useEffect, useState } from "react";
import { CalendarOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { useApplyOfficeRunExemption } from "@/hooks/use-supabase-data";
import { useOperationalTodayIso } from "@/lib/operational-clock";
import { formatDate } from "@/lib/utils";
import { toast } from "sonner";
import type { AttendanceSchedule, AttendanceStatus } from "@/lib/data-store";
import { cn } from "@/lib/utils";

const STATUSES: AttendanceStatus[] = ["Cancelled", "Sick"];
const MIN_REASON = 20;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedule: AttendanceSchedule | null;
  participantName: string;
}

export function OffTodayExemptionDialog({
  open,
  onOpenChange,
  schedule,
  participantName,
}: Props) {
  const today = useOperationalTodayIso();
  const [status, setStatus] = useState<AttendanceStatus>("Cancelled");
  const [notes, setNotes] = useState("");
  const apply = useApplyOfficeRunExemption();

  useEffect(() => {
    if (open) {
      setStatus("Cancelled");
      setNotes("");
    }
  }, [open]);

  if (!schedule) return null;

  const reasonOk = notes.trim().length >= MIN_REASON;
  const missing: string[] = [];
  if (!reasonOk) missing.push("Reason (20+ characters)");
  const canSubmit = reasonOk && !apply.isPending;

  const submit = async () => {
    if (!canSubmit) return;
    try {
      const result = await apply.mutateAsync({
        schedule,
        participantName,
        rosterDate: today,
        status,
        notes,
      });
      toast.success("Off today recorded", {
        description: result.alreadyOnBoard
          ? `${participantName} is already on the bus — driver has been notified.`
          : result.skippedTripCount > 0
            ? `${participantName} removed from the live Manifest. Driver has been notified.`
            : `${participantName} will not be on today's run.`,
      });
      onOpenChange(false);
    } catch {
      /* hook toast */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle>Off today</DialogTitle>
          <DialogDescription>
            {participantName} · {formatDate(today)}. Recurring schedule stays.
            If a run is already open, Manifest updates and the driver is alerted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  "rounded-full border-2 px-3 py-1 text-xs font-semibold",
                  status === s
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card hover:opacity-80",
                )}
              >
                {s}
              </button>
            ))}
          </div>

          <CharacterCountedTextarea
            label="Reason for the driver"
            value={notes}
            onValueChange={setNotes}
            minChars={MIN_REASON}
            required
            rows={3}
            placeholder="Family called — not attending today…"
          />

          {missing.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Still needed: {missing.join(" · ")}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={() => void submit()} disabled={!canSubmit} className="gap-1.5">
            <CalendarOff className="h-4 w-4" />
            {apply.isPending ? "Saving…" : "Confirm Off today"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
