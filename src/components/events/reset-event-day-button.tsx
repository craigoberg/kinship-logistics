/**
 * Craig only — unwind Event Deliver for this day, or the whole trip.
 * Roster and itinerary stay. Floor progress is removed.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { TestOnly } from "@/components/dev/test-only";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  resetEventDayToStartOfDay,
  unwindEventDeliver,
} from "@/lib/api/event-day-reset";
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

type Scope = "day" | "trip";

export function ResetEventDayButton({
  sessionId,
  eventId,
  sessionDate,
  onReset,
}: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async (scope: Scope) => {
      if (scope === "trip") {
        const result = await unwindEventDeliver(eventId);
        return { scope, result } as const;
      }
      const session = await resetEventDayToStartOfDay(sessionId);
      return { scope, session } as const;
    },
    onSuccess: (payload) => {
      invalidateEventDayCaches(qc, {
        eventId,
        sessionDate,
        sessionId,
      });
      invalidateTransportCaches(qc);
      void qc.invalidateQueries({ queryKey: ["event-day-sessions", eventId] });
      void qc.invalidateQueries({ queryKey: ["event-deliver-today-sessions"] });
      void qc.invalidateQueries({ queryKey: ["event-attendance-log", sessionId] });
      void qc.invalidateQueries({ queryKey: ["event-support-attendance", sessionId] });
      void qc.invalidateQueries({ queryKey: ["event-accountability-roll"] });
      void qc.invalidateQueries({ queryKey: ["compliance_audit_logs"] });
      void qc.invalidateQueries({ queryKey: ["event-manifest"] });
      if (payload.scope === "trip") {
        const { days, firstDate, reopened } = payload.result;
        toast.success("Event Deliver unwound", {
          description: `${days} day${days === 1 ? "" : "s"} cleared from ${formatDate(firstDate)} · 07:00 Syd. Roster and itinerary kept.${reopened ? " Event is Open again." : ""}`,
        });
      } else {
        const notes = payload.session.open_leader_notes ?? "";
        const overnight = notes.includes("overnight start of day");
        const noRoster = notes.includes("no confirmed roster");
        toast.success("This day is back to the start", {
          description: noRoster
            ? `${formatDate(sessionDate)} · 07:00 Syd. Nobody is confirmed on the roster, so this day was left unopened.`
            : overnight
              ? `${formatDate(sessionDate)} · 07:00 Syd. Overnight base open — Morning Roll ready.`
              : `${formatDate(sessionDate)} · 07:00 Syd. Open Location to begin.`,
        });
      }
      setError(null);
      setOpen(false);
      onReset?.();
    },
    onError: (e: Error) => {
      setError(e.message);
    },
  });

  return (
    <TestOnly>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
      >
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-11 w-full gap-1.5 border-dashed border-amber-500/60 text-amber-700 hover:bg-amber-500/10"
            disabled={mut.isPending}
            title="Clear Event Deliver for this day or the whole trip. Roster and itinerary stay."
          >
            {mut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
            Unwind Deliver
            <span className="ml-1 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider">
              Test
            </span>
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unwind Event Deliver?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Field progress is removed so this trip can be run again. Roster, itinerary,
                  leaders, and roll times stay in Event Manage. People added on the day stay on
                  the roster. The Activity log of the field run stays.
                </p>
                <p>
                  <strong>This day</strong> ({formatDate(sessionDate)}) clears check-in, rolls,
                  programme, bus hops, meals, medication doses, and Hub issues. Day 1 is ready
                  to Open location. A later day wakes at the overnight base with Morning Roll
                  ready.
                </p>
                <p>
                  <strong>Whole trip</strong> puts every day back to before Open location. The
                  clock moves to day 1 at 07:00 Syd so you can SIM that morning and work through.
                </p>
                <p>
                  Vehicle walkaround records for those calendar dates are cleared so the bus
                  check can be done again. If the event was Closed, it returns to Open.
                </p>
                <p>
                  Turn on <strong>All operators</strong> on the SIM bar first if everyone should
                  jump to 07:00 with you.
                </p>
                {error && <p className="font-medium text-destructive">{error}</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setError(null);
                setOpen(false);
              }}
            >
              {error ? "Close" : "Keep going"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-amber-600 text-amber-800 hover:bg-amber-500/10"
              disabled={mut.isPending}
              onClick={() => {
                setError(null);
                mut.mutate("day");
              }}
            >
              {mut.isPending ? "Clearing…" : "This day"}
            </Button>
            <Button
              type="button"
              className="bg-amber-600 text-white hover:bg-amber-700"
              disabled={mut.isPending}
              onClick={() => {
                setError(null);
                mut.mutate("trip");
              }}
            >
              {mut.isPending ? "Clearing…" : "Whole trip"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TestOnly>
  );
}
