import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
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

  const mut = useMutation({
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

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && !mut.isPending && onClose(false)}>
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
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onClose(false)}
            disabled={mut.isPending}
          >
            Cancel
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
