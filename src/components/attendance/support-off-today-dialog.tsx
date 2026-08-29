import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { useOperationalTodayIso } from "@/lib/operational-clock";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  applySupportDayExemption,
  SUPPORT_SCHEDULES_KEY,
} from "@/lib/api/support-attendance";
import { RUN_PLANNING_PEOPLE_KEY } from "@/lib/api/run-planning";
import type { SupportPersonKind } from "@/lib/support-person";

const STATUSES = ["Cancelled", "Sick"] as const;
const MIN_REASON = 20;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personKind: SupportPersonKind;
  staffId?: string | null;
  carerId?: string | null;
  personName: string;
  runCodes?: string[];
}

export function SupportOffTodayDialog({
  open,
  onOpenChange,
  personKind,
  staffId,
  carerId,
  personName,
  runCodes,
}: Props) {
  const today = useOperationalTodayIso();
  const qc = useQueryClient();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("Cancelled");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setStatus("Cancelled");
      setNotes("");
    }
  }, [open]);

  const reasonOk = notes.trim().length >= MIN_REASON;
  const apply = useMutation({
    mutationFn: () =>
      applySupportDayExemption({
        personKind,
        staffId,
        carerId,
        dateIso: today,
        notes: `[${status}] ${notes.trim()}`,
        displayName: personName,
        runCodes,
      }),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: SUPPORT_SCHEDULES_KEY });
      void qc.invalidateQueries({ queryKey: RUN_PLANNING_PEOPLE_KEY });
      void qc.invalidateQueries({ queryKey: ["bus-run-default-routes"] });
      toast.success("Off today recorded", {
        description: result.alreadyOnBoard
          ? `${personName} is already on the bus — driver has been notified.`
          : result.skippedTripCount > 0
            ? `${personName} removed from the live Manifest. Driver has been notified.`
            : `${personName} will not be on today's run.`,
      });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSubmit = reasonOk && !apply.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle>Off today</DialogTitle>
          <DialogDescription>
            {personName} will not attend on {formatDate(today)}. Recurring Centre
            run stays. Live Manifest is skipped.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
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
            id="support-off-today-reason"
            label="Reason"
            rows={3}
            minChars={MIN_REASON}
            maxChars={500}
            counterMode="minimum"
            value={notes}
            onValueChange={setNotes}
            placeholder="Why are they off today? Driver will see this."
          />
          {!canSubmit && (
            <p className="text-xs text-destructive">Reason (20+ characters)</p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={() => apply.mutate()} disabled={!canSubmit}>
            {apply.isPending ? "Saving…" : "Confirm Off today"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
