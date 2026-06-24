import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, UserX } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  markAttendanceAbsent,
  updateExpectedArrival,
  type ClientAttendanceRow,
} from "@/lib/api/client-attendance";
import { isoToSydneyClock } from "@/lib/operational-time";

interface Props {
  row: ClientAttendanceRow | null;
  participantName: string;
  yellowThresholdMins: number;
  onClose: (changed: boolean) => void;
}

export function AdjustExpectedTimeModal({
  row,
  participantName,
  yellowThresholdMins,
  onClose,
}: Props) {
  const [hhmm, setHhmm] = useState("09:00");

  useEffect(() => {
    if (row) setHhmm(isoToSydneyClock(row.expectedArrivalAt));
  }, [row]);

  const updateMut = useMutation({
    mutationFn: async () => {
      if (!row) throw new Error("No row");
      return updateExpectedArrival(row, hhmm, yellowThresholdMins);
    },
    onSuccess: () => {
      toast.success("Expected arrival updated", {
        description: `${participantName} now expected at ${hhmm} (Sydney).`,
      });
      onClose(true);
    },
    onError: (e: Error) => {
      toast.error("Could not adjust expected time", { description: e.message });
    },
  });

  const absentMut = useMutation({
    mutationFn: async () => {
      if (!row) throw new Error("No row");
      return markAttendanceAbsent(row);
    },
    onSuccess: (res) => {
      const closed = res.closedIssueId
        ? ` Closed ${res.prevSeverity?.toUpperCase() ?? "active"} anomaly.`
        : "";
      toast.success(`${participantName} marked absent for today.`, {
        description: `Removed from overdue queue.${closed}`,
      });
      onClose(true);
    },
    onError: (e: Error) => {
      toast.error("Could not mark absent", { description: e.message });
    },
  });

  const busy = updateMut.isPending || absentMut.isPending;

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && !busy && onClose(false)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Adjust Expected Time</DialogTitle>
          <DialogDescription>
            {participantName} — set the new expected arrival time (Sydney
            local). If this clears the overdue window, any active YELLOW
            warning is auto-resolved. RED escalations remain open.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="adjust-time">New expected arrival</Label>
          <input
            id="adjust-time"
            type="time"
            value={hhmm}
            onChange={(e) => setHhmm(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-base text-slate-900"
          />
        </div>

        <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-destructive">
            Or record this client as absent
          </div>
          <p className="mb-2 text-xs text-muted-foreground">
            Removes them from the overdue queue and auto-closes any active
            YELLOW or RED anomaly with the note
            “Client confirmed absent for today.”
          </p>
          <Button
            type="button"
            variant="destructive"
            className="w-full gap-2"
            disabled={busy}
            onClick={() => absentMut.mutate()}
          >
            {absentMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserX className="h-4 w-4" />
            )}
            Mark Absent for Today
          </Button>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onClose(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={() => updateMut.mutate()} disabled={busy}>
            {updateMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
