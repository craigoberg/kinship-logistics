/**
 * Test-only — rewind this Event Deliver trip day to Start of Day.
 * Full ops wipe + DEV clock → session date @ 07:00.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { TestOnly } from "@/components/dev/test-only";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { resetEventDayToStartOfDay } from "@/lib/api/event-day-reset";
import {
  invalidateEventDayCaches,
  invalidateTransportCaches,
} from "@/lib/query/invalidation";
import { formatDate } from "@/lib/utils";

interface Props {
  sessionId: string;
  eventId: string;
  sessionDate: string;
  onReset?: () => void;
}

export function ResetEventDayButton({
  sessionId,
  eventId,
  sessionDate,
  onReset,
}: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const mut = useMutation({
    mutationFn: () => resetEventDayToStartOfDay(sessionId),
    onSuccess: (next) => {
      invalidateEventDayCaches(qc, {
        eventId,
        sessionDate,
        sessionId,
      });
      invalidateTransportCaches(qc);
      void qc.invalidateQueries({ queryKey: ["event-day-sessions", eventId] });
      void qc.invalidateQueries({ queryKey: ["event-deliver-today-sessions"] });
      void qc.invalidateQueries({ queryKey: ["event-attendance-log", sessionId] });
      void qc.invalidateQueries({ queryKey: ["event-accountability-roll"] });
      const overnight = (next.open_leader_notes ?? "").includes("overnight start of day");
      toast.success("Trip day reset to Start of Day", {
        description: overnight
          ? `Test clock ${formatDate(sessionDate)} · 07:00 Syd. Overnight base open — Morning Roll ready.`
          : `Test clock ${formatDate(sessionDate)} · 07:00 Syd. Open Location to begin (Day 1).`,
      });
      setOpen(false);
      onReset?.();
    },
    onError: (e: Error) => {
      toast.error("Reset failed", { description: e.message });
    },
  });

  return (
    <TestOnly>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-11 w-full gap-1.5 border-dashed border-amber-500/60 text-amber-700 hover:bg-amber-500/10"
            disabled={mut.isPending}
            title="TEST ONLY — wipe this day's floor ops and set test clock to 07:00"
          >
            {mut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
            Reset Start of Day
            <span className="ml-1 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider">
              Test
            </span>
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset this trip day to Start of Day?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Stays on <strong>{formatDate(sessionDate)}</strong> — same leader, roll times, and
                  itinerary.
                </p>
                <p>Discarded for this day only:</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  <li>Morning &amp; evening roll rows (including Yellow/Red + Hub issues)</li>
                  <li>Activity rolls, bus hops, outbound/return trips</li>
                  <li>Later venue-stop runtime (itinerary kept)</li>
                </ul>
                <p>
                  <strong>Day 2+:</strong> overnight base stays open — roster checked in so Morning
                  Roll is available (no re-arrival Check-In).{" "}
                  <strong>Day 1:</strong> location closes; Open Location + Check-In as usual.
                </p>
                <p>
                  Test clock will be set to <strong>{formatDate(sessionDate)} · 07:00 Syd</strong>.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mut.isPending}>Keep going</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 text-white hover:bg-amber-700"
              disabled={mut.isPending}
              onClick={(e) => {
                e.preventDefault();
                mut.mutate();
              }}
            >
              {mut.isPending ? "Resetting…" : "Reset Start of Day"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TestOnly>
  );
}
