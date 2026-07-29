/**
 * EventHopReleasePanel — trip leader releases group to bus (§12.4.3).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bus, Loader2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  eventTransportRunsKey,
  listEventTransportRuns,
  prepareEventHopManifest,
} from "@/lib/api/event-hop-transport";
import { listBusManifest } from "@/lib/api/event-day-ops";
import { invalidateTransportCaches } from "@/lib/query/invalidation";

interface Props {
  eventId: string;
  sessionId: string;
  sessionDate: string;
  hopIndex: number;
  fromStopId: string;
  toStopId: string;
  label: string;
  className?: string;
}

export function EventHopReleasePanel({
  eventId,
  sessionId,
  sessionDate,
  hopIndex,
  fromStopId,
  toStopId,
  label,
  className,
}: Props) {
  const qc = useQueryClient();
  const runsKey = eventTransportRunsKey(eventId, sessionDate, sessionId);

  const { data: runs = [] } = useQuery({
    queryKey: runsKey,
    queryFn: () => listEventTransportRuns({ eventId, sessionId, sessionDate }),
    staleTime: 10_000,
  });

  const hopCard = runs.find((r) => r.kind === "venue_hop" && r.hopIndex === hopIndex);
  const tripId = hopCard?.tripId;

  const { data: manifest = [] } = useQuery({
    queryKey: ["event-bus-manifest", tripId ?? "__none__"],
    queryFn: () => listBusManifest(tripId!),
    enabled: !!tripId,
    staleTime: 10_000,
  });

  const releaseMut = useMutation({
    mutationFn: () =>
      prepareEventHopManifest({
        eventId,
        eventDaySessionId: sessionId,
        sessionDate,
        hopIndex,
        fromStopId,
        toStopId,
      }),
    onSuccess: (id) => {
      toast.success("Group released to bus", {
        description: "Driver can start this hop from Manifest.",
      });
      qc.invalidateQueries({ queryKey: runsKey });
      qc.invalidateQueries({ queryKey: ["event-bus-manifest", id] });
      invalidateTransportCaches(qc);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onBoard = manifest.filter((r) => r.status === "on_bus").length;
  const total = manifest.filter((r) => r.status !== "not_travelling").length;
  const isActive = hopCard?.status === "active";
  const isDone = hopCard?.status === "completed";
  const isReleased =
    hopCard?.status === "released" || (!!tripId && !isActive && !isDone);

  if (isDone) {
    return (
      <div className={cn("rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm", className)}>
        ✓ {label} — hop complete
      </div>
    );
  }

  if (isActive) {
    return (
      <div className={cn("rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 space-y-2", className)}>
        <div className="flex items-center gap-2 text-sm font-semibold text-blue-300">
          <Bus className="h-4 w-4" />
          In transit — {label}
        </div>
        {total > 0 && (
          <p className="text-xs text-blue-200/80">
            {onBoard} / {total} on bus · driver Manifest active
          </p>
        )}
        <Button variant="outline" size="sm" asChild className="w-full">
          <Link to="/manifest">Open Manifest</Link>
        </Button>
      </div>
    );
  }

  if (isReleased) {
    return (
      <div className={cn("rounded-lg border border-muted bg-muted/40 p-3 space-y-2", className)}>
        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Bus className="h-4 w-4" />
          Released — {label}
        </div>
        <p className="text-xs text-muted-foreground">
          Group released to the bus. Driver boards each person in Manifest (§11).
        </p>
        {total > 0 && (
          <p className="text-xs text-muted-foreground">
            {onBoard} / {total} on bus so far
          </p>
        )}
        <Button
          type="button"
          variant="secondary"
          className="w-full opacity-70"
          disabled
        >
          Released to Bus
        </Button>
        <Button variant="outline" size="sm" asChild className="w-full">
          <Link to="/manifest">Open Manifest</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-2", className)}>
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
        <Bus className="h-4 w-4" />
        Ready — {label}
      </div>
      <p className="text-xs text-amber-100/70">
        Release the group to the bus. The driver boards each person in Manifest (§11).
      </p>
      <Button
        type="button"
        className="w-full"
        disabled={
          releaseMut.isPending ||
          hopCard?.status === "blocked" ||
          hopCard?.status === "waiting"
        }
        onClick={() => releaseMut.mutate()}
      >
        {releaseMut.isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Releasing…
          </>
        ) : (
          "Release group to bus"
        )}
      </Button>
    </div>
  );
}
