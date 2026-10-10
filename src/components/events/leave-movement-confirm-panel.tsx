/**
 * Leave movement confirm — after Bus | Walk | Other | On-site is planned.
 * Embedded Method + Undo chips (Check-In parity). Confirm creates Manifest
 * (bus) or opens next activity (walk/other/on_site).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bus, Footprints, Loader2, MapPin, RotateCcw, TrainFront } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FieldActionButton } from "@/components/ui/field-action-button";
import { EmbeddedMethodButton } from "@/components/ui/embedded-method-button";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import { cn } from "@/lib/utils";
import {
  clearPlannedVenueMovement,
  confirmNonBusLeave,
  leaveVenueForNext,
  type MovementMethod,
} from "@/lib/api/event-activity-roll";
import {
  eventTransportRunsKey,
  listEventTransportRuns,
  prepareEventHopManifest,
} from "@/lib/api/event-hop-transport";
import { listBusManifest } from "@/lib/api/event-day-ops";
import { invalidateTransportCaches } from "@/lib/query/invalidation";

const METHOD_CHIP: Record<MovementMethod, string> = {
  bus: "Bus",
  walk: "Walk",
  other: "Other",
  on_site: "On-site",
};

interface Props {
  eventId: string;
  sessionId: string;
  sessionDate: string;
  hopIndex: number;
  fromStopId: string;
  toStopId: string;
  fromLabel: string;
  toLabel: string;
  method: MovementMethod;
  fromVenueName: string | null;
  toVenueName: string | null;
  className?: string;
  onChanged: () => void;
  onNonBusConfirmed?: (openedStopId: string) => void;
}

export function LeaveMovementConfirmPanel({
  eventId,
  sessionId,
  sessionDate,
  hopIndex,
  fromStopId,
  toStopId,
  fromLabel,
  toLabel,
  method,
  fromVenueName,
  toVenueName,
  className,
  onChanged,
  onNonBusConfirmed,
}: Props) {
  const qc = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const runsKey = eventTransportRunsKey(eventId, sessionDate, sessionId);
  const label = `${fromLabel} → ${toLabel}`;

  const { data: runs = [] } = useQuery({
    queryKey: runsKey,
    queryFn: () => listEventTransportRuns({ eventId, sessionId, sessionDate }),
    staleTime: 10_000,
    enabled: method === "bus",
  });

  const hopCard = runs.find((r) => r.kind === "venue_hop" && r.hopIndex === hopIndex);
  const tripId = hopCard?.tripId;

  const { data: manifest = [] } = useQuery({
    queryKey: ["event-bus-manifest", tripId ?? "__none__"],
    queryFn: () => listBusManifest(tripId!),
    enabled: !!tripId && method === "bus",
    staleTime: 10_000,
  });

  const undoMut = useMutation({
    mutationFn: () =>
      clearPlannedVenueMovement({
        toStopId,
        eventId,
        sessionDate,
        hopIndex,
        eventDaySessionId: sessionId,
        venueName: toVenueName,
      }),
    onSuccess: () => {
      toast.message("Choose how you get there again.");
      qc.invalidateQueries({ queryKey: runsKey });
      invalidateTransportCaches(qc);
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const replanMut = useMutation({
    mutationFn: (next: MovementMethod) =>
      leaveVenueForNext({
        fromStop: {
          id: fromStopId,
          eventId,
          sessionDate,
          venueName: fromVenueName,
        },
        toStop: {
          id: toStopId,
          eventId,
          sessionDate,
          venueName: toVenueName,
        },
        method: next,
        eventDaySessionId: sessionId,
      }),
    onSuccess: () => {
      setPickerOpen(false);
      toast.message("Movement updated — confirm when ready.");
      qc.invalidateQueries({ queryKey: runsKey });
      invalidateTransportCaches(qc);
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
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
        description: "This stop is closed. Driver boards on Manifest.",
      });
      qc.invalidateQueries({ queryKey: runsKey });
      qc.invalidateQueries({ queryKey: ["event-bus-manifest", id] });
      invalidateTransportCaches(qc);
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const leaveMut = useMutation({
    mutationFn: () =>
      confirmNonBusLeave({
        fromStop: {
          id: fromStopId,
          eventId,
          sessionDate,
          venueName: fromVenueName,
        },
        toStop: {
          id: toStopId,
          eventId,
          sessionDate,
          venueName: toVenueName,
        },
        eventDaySessionId: sessionId,
      }),
    onSuccess: (result) => {
      toast.success(`At ${toLabel} — check everyone in.`);
      onNonBusConfirmed?.(result.openedStopId);
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const busy =
    undoMut.isPending ||
    replanMut.isPending ||
    releaseMut.isPending ||
    leaveMut.isPending;

  const onBoard = manifest.filter((r) => r.status === "on_bus").length;
  const total = manifest.filter((r) => r.status !== "not_travelling").length;
  const isActive = hopCard?.status === "active";
  const isDone = hopCard?.status === "completed";
  const isReleased =
    method === "bus" &&
    (hopCard?.status === "released" || (!!tripId && !isActive && !isDone));

  if (method === "bus" && isDone) {
    return (
      <div
        className={cn(
          "rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm",
          className,
        )}
      >
        ✓ {label} — hop complete
      </div>
    );
  }

  if (method === "bus" && isActive) {
    return (
      <div
        className={cn(
          "rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 space-y-2",
          className,
        )}
      >
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
      <div
        className={cn(
          "rounded-lg border border-muted bg-muted/40 p-3 space-y-2",
          className,
        )}
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Bus className="h-4 w-4" />
          Released — {label}
        </div>
        <p className="text-xs text-muted-foreground">
          Group released to the bus. Driver boards each person in Manifest (§11).
        </p>
        <Button variant="outline" size="sm" asChild className="w-full">
          <Link to="/manifest">Open Manifest</Link>
        </Button>
      </div>
    );
  }

  const MethodIcon =
    method === "bus"
      ? Bus
      : method === "walk"
        ? Footprints
        : method === "other"
          ? TrainFront
          : MapPin;

  return (
    <div
      className={cn(
        "rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-3",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
            <MethodIcon className="h-4 w-4 shrink-0" />
            Ready — {label}
          </div>
          <p className="text-xs text-amber-100/70">
            {method === "bus"
              ? "Confirm Release to create the bus Manifest and hand the group over. Closes this activity."
              : "Confirm leave to open the next stop for activity check-in. Closes this activity."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <EmbeddedMethodButton
            label={METHOD_CHIP[method]}
            disabled={busy}
            onClick={() => setPickerOpen(true)}
            aria-label={`Change leave method, currently ${METHOD_CHIP[method]}`}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => undoMut.mutate()}
            className={cn(
              "inline-flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-md px-2",
              "border border-slate-300 bg-white text-slate-900 shadow-sm",
              "hover:bg-slate-100 active:scale-[0.98] touch-manipulation",
              "disabled:opacity-50 disabled:pointer-events-none",
            )}
            title="Undo leave method"
            aria-label="Undo leave method — choose again"
          >
            {undoMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            <span className="text-[9px] font-medium uppercase leading-none text-slate-500">
              Undo
            </span>
          </button>
        </div>
      </div>

      {method === "bus" ? (
        <FieldActionButton
          variant="primary"
          disabled={
            busy ||
            hopCard?.status === "blocked" ||
            hopCard?.status === "waiting"
          }
          onClick={() => releaseMut.mutate()}
        >
          {releaseMut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Bus className="h-4 w-4" />
          )}
          Release group to bus
        </FieldActionButton>
      ) : (
        <FieldActionButton
          variant="success"
          disabled={busy}
          onClick={() => leaveMut.mutate()}
        >
          {leaveMut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MethodIcon className="h-4 w-4" />
          )}
          Leave for {toLabel}
        </FieldActionButton>
      )}

      <BottomSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={`Leave for ${toLabel}`}
        description="Change how the group is moving to the next stop."
      >
        <div className="space-y-2 pb-2">
          {(
            [
              {
                method: "bus" as const,
                label: "By Bus",
                sub: "Release here → driver boards via Manifest (§11)",
                icon: <Bus className="h-5 w-5" />,
              },
              {
                method: "walk" as const,
                label: "Walking",
                sub: "Opens next stop with individual check-in roll",
                icon: <Footprints className="h-5 w-5" />,
              },
              {
                method: "other" as const,
                label: "Other (train / tram / public…)",
                sub: "Not the trip bus — individual check-in at the next stop",
                icon: <TrainFront className="h-5 w-5" />,
              },
              {
                method: "on_site" as const,
                label: "On-site / Already there",
                sub: "Next activity is at the same place — check-in roll",
                icon: <MapPin className="h-5 w-5" />,
              },
            ] as const
          ).map((opt) => (
            <MobileFieldButton
              key={opt.method}
              title={opt.label}
              subtitle={opt.sub}
              icon={opt.icon}
              tone={opt.method === method ? "success" : "neutral"}
              active={opt.method === method}
              disabled={replanMut.isPending}
              onClick={() => replanMut.mutate(opt.method)}
            />
          ))}
        </div>
      </BottomSheet>
    </div>
  );
}
