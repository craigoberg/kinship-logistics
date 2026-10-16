/**
 * Step 3 — Today's transport runs for outing events (§11 / §12.4.3).
 *
 * Venue hops + Transport HOME: bus is assumed at the pickup (BL-T1) — no
 * Depot/Day Centre start picker, no Outbound/Return direction toggle.
 * Transport IN (outbound) still uses the parent's StartPointPicker via children.
 * BL-069: multiple Transport IN / HOME cards when roster uses R1/R2/….
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { AlertTriangle, CheckCircle2, Circle, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  useEventTransportRuns,
  useStartEventVenueHop,
  useStartTrip,
} from "@/hooks/use-supabase-data";
import { useSystemParameter } from "@/hooks/use-system-parameters";
import type { EventTransportRunCard } from "@/lib/api/event-hop-transport";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import {
  CAUTION_CALLOUT_BODY_CLASS,
  CAUTION_CALLOUT_CLASS,
  CAUTION_CALLOUT_ICON_CLASS,
} from "@/lib/ui/caution-callout";
import { revealInManifestScroll } from "@/lib/ui/manifest-scroll";

export type SelectedTransportRun =
  | { kind: "outbound"; busRunCode: string | null; card: EventTransportRunCard }
  | { kind: "return"; busRunCode: string | null; card: EventTransportRunCard }
  | { kind: "venue_hop"; hopIndex: number; card: EventTransportRunCard };

interface Props {
  eventId: string;
  sessionId: string;
  sessionDate: string;
  startOdometer: number;
  /** Fleet vehicle for trip.asset_id → Close Run current KM (BL-096). */
  assetId: string;
  selected: SelectedTransportRun | null;
  onSelect: (run: SelectedTransportRun | null) => void;
  onHopStarted: () => void;
  /** Outbound (Transport IN) only — Depot/Day Centre start picker + submit */
  children?: React.ReactNode;
  /** BL-126 — same Manager approval as parent Start Run. */
  dutyGate?: {
    needsGap: boolean;
    approved: boolean;
    ensureApproved: () => Promise<boolean>;
  };
}

function statusIcon(status: EventTransportRunCard["status"]) {
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (status === "active") return <Loader2 className="h-4 w-4 animate-spin text-blue-600" />;
  if (status === "released") return <CheckCircle2 className="h-4 w-4 text-slate-500" />;
  if (status === "ready") return <Circle className="h-4 w-4 text-amber-500" />;
  return <Circle className="h-4 w-4 text-muted-foreground/40" />;
}

function canStartRun(status: EventTransportRunCard["status"]): boolean {
  return status === "ready" || status === "released" || status === "active";
}

/** Venue hops require trip-leader Release first — never auto-prepare from Manifest. */
function canStartHop(status: EventTransportRunCard["status"]): boolean {
  return status === "released" || status === "active";
}

/** Why Start is absent. Shown on the Manifest, not left as a blank gap. */
function hopHoldMessage(card: EventTransportRunCard): { title: string; body: string } {
  const leg = card.label;
  const detail = card.detail ?? "";
  if (detail.includes("previous hop")) {
    return {
      title: "Current activity is still open",
      body: `Close it on Event Deliver before the bus can take ${leg}.`,
    };
  }
  if (detail.includes("Check-In") || detail.includes("Transport IN")) {
    const reason = detail.replace(/^Waiting — /, "");
    return {
      title: "Check-in is not finished",
      body: `${reason}. ${leg} can start after that.`,
    };
  }
  if (detail.includes("Open location")) {
    return {
      title: "Location is not open",
      body: `Open the location on Event Deliver before ${leg} can start.`,
    };
  }
  if (card.status === "ready" || detail.includes("Release") || detail.includes("By Bus")) {
    return {
      title: "Not released to the bus yet",
      body: `${leg}. The trip leader releases the group on Event Deliver. Start hop manifest appears here after that.`,
    };
  }
  return {
    title: "This manifest cannot start yet",
    body: detail || `${leg} is not ready.`,
  };
}

function sameBusRun(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return (a ?? null) === (b ?? null);
}

export function EventTransportRunsStep3({
  eventId,
  sessionId,
  sessionDate,
  startOdometer,
  assetId,
  selected,
  onSelect,
  onHopStarted,
  children,
  dutyGate,
}: Props) {
  const { data: runs = [], isLoading } = useEventTransportRuns(eventId, sessionId, sessionDate);
  const startHop = useStartEventVenueHop();
  const startTrip = useStartTrip();
  const focusRef = useRef<HTMLDivElement | null>(null);
  const defaultDepotAddress = useSystemParameter<string>("depot_address", "");
  const defaultCentreAddress = useSystemParameter<string>("day_centre_address", "");

  useRealtimeInvalidate({
    table: "transport_trips",
    queryKeys: [["event-transport-runs", eventId, sessionDate, sessionId]],
  });
  useRealtimeInvalidate({
    table: "event_bus_manifest",
    queryKeys: [["event-transport-runs", eventId, sessionDate, sessionId]],
  });
  useRealtimeInvalidate({
    table: "event_attendance_log",
    queryKeys: [["event-transport-runs", eventId, sessionDate, sessionId]],
  });

  const hopRuns = useMemo(() => runs.filter((r) => r.kind === "venue_hop"), [runs]);
  const hasHops = hopRuns.length > 0;
  const returnCards = useMemo(() => runs.filter((r) => r.kind === "return"), [runs]);
  const outboundCards = useMemo(() => runs.filter((r) => r.kind === "outbound"), [runs]);

  useEffect(() => {
    if (!runs.length) return;
    const readyHop = hopRuns.find((r) => canStartHop(r.status));
    if (readyHop) {
      const sameHop =
        selected?.kind === "venue_hop" && selected.hopIndex === readyHop.hopIndex;
      const staleCard =
        sameHop &&
        (selected.card.tripId !== readyHop.tripId ||
          selected.card.status !== readyHop.status);
      if (!sameHop || staleCard) {
        onSelect({
          kind: "venue_hop",
          hopIndex: readyHop.hopIndex!,
          card: readyHop,
        });
      }
      return;
    }
    const readyReturn = returnCards.find((r) => canStartRun(r.status));
    if (readyReturn) {
      const same =
        selected?.kind === "return" &&
        sameBusRun(selected.busRunCode, readyReturn.busRunCode ?? null);
      if (!same) {
        onSelect({
          kind: "return",
          busRunCode: readyReturn.busRunCode ?? null,
          card: readyReturn,
        });
      }
      return;
    }
    const readyOutbound = outboundCards.find(
      (r) => r.status === "ready" || r.status === "released",
    );
    if (readyOutbound && !selected) {
      onSelect({
        kind: "outbound",
        busRunCode: readyOutbound.busRunCode ?? null,
        card: readyOutbound,
      });
      return;
    }
    if (selected?.kind === "outbound" || selected?.kind === "return") return;
    const heldHop = hopRuns.find((r) => r.status !== "completed" && r.hopIndex != null);
    if (heldHop) {
      const sameHop =
        selected?.kind === "venue_hop" && selected.hopIndex === heldHop.hopIndex;
      const staleCard =
        sameHop &&
        (selected.card.tripId !== heldHop.tripId ||
          selected.card.status !== heldHop.status ||
          selected.card.detail !== heldHop.detail);
      if (!sameHop || staleCard) {
        onSelect({
          kind: "venue_hop",
          hopIndex: heldHop.hopIndex!,
          card: heldHop,
        });
      }
    }
  }, [runs, hopRuns, returnCards, outboundCards, selected, onSelect]);

  const hopHold =
    selected?.kind === "venue_hop" && !canStartHop(selected.card.status)
      ? hopHoldMessage(selected.card)
      : null;
  const focusKey = selected
    ? selected.kind === "venue_hop"
      ? `hop:${selected.hopIndex}:${selected.card.status}:${hopHold?.title ?? ""}`
      : `${selected.kind}:${selected.busRunCode ?? ""}:${selected.card.status}`
    : "";

  useLayoutEffect(() => {
    if (!focusKey || isLoading) return;
    const reveal = () => revealInManifestScroll(focusRef.current);
    reveal();
    const later = window.setTimeout(reveal, 300);
    return () => window.clearTimeout(later);
  }, [focusKey, isLoading]);

  const submitHop = async () => {
    if (!selected || selected.kind !== "venue_hop") return;
    const card = selected.card;
    if (!canStartHop(card.status)) {
      toast.error(
        card.status === "ready"
          ? "Waiting for trip leader to Release group to bus on Event Deliver."
          : "This hop is not ready yet.",
      );
      return;
    }

    if (dutyGate && !(await dutyGate.ensureApproved())) return;

    const tripId = card.tripId;
    if (!tripId) {
      toast.error(
        "Waiting for trip leader to Release group to bus on Event Deliver.",
      );
      return;
    }

    startHop.mutate(
      {
        tripId,
        startOdometerKm: startOdometer,
        assetId,
        varianceReason: null,
      },
      {
        onSuccess: () => {
          toast.success("Hop manifest open", {
            description: `${card.originLabel ?? "Origin"} → ${card.label.split(" → ")[1] ?? "destination"}`,
          });
          onHopStarted();
        },
      },
    );
  };

  const submitReturn = async () => {
    if (!selected || selected.kind !== "return") return;
    if (dutyGate && !(await dutyGate.ensureApproved())) return;
    const returnCard = selected.card;
    if (!canStartRun(returnCard.status)) {
      toast.error("Return home is not ready yet — finish Check-Out first.");
      return;
    }
    const rx = returnCard.busRunShortLabel;
    startTrip.mutate(
      {
        eventId,
        startOdometerKm: startOdometer,
        assetId,
        varianceReason: null,
        tripDirection: "return",
        busRunCode: selected.busRunCode,
        startPoint: "depot",
        depotAddress: defaultDepotAddress.trim() || null,
        centreAddress: defaultCentreAddress.trim() || null,
        returnSessionDate: sessionDate,
        returnDepartPoint: "last_itinerary_stop",
        returnDepartLabel: returnCard.originLabel ?? null,
        returnDepartAddress: returnCard.originAddress ?? null,
      },
      {
        onSuccess: () => {
          toast.success(rx ? `Return home started (${rx})` : "Return home started", {
            description: `Boarding at ${returnCard.originLabel ?? "last stop"} → depot`,
          });
          onHopStarted();
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading today&apos;s transport…
      </div>
    );
  }

  if (!hasHops && returnCards.length === 0 && outboundCards.length === 0) {
    return <>{children}</>;
  }

  const showOutboundStart = selected?.kind === "outbound";

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label>Today&apos;s Transport Legs</Label>
        <div className="space-y-2">
          {runs.map((run) => {
            const isHop = run.kind === "venue_hop";
            const isSelected =
              (selected?.kind === "outbound" &&
                run.kind === "outbound" &&
                sameBusRun(selected.busRunCode, run.busRunCode ?? null)) ||
              (selected?.kind === "return" &&
                run.kind === "return" &&
                sameBusRun(selected.busRunCode, run.busRunCode ?? null)) ||
              (selected?.kind === "venue_hop" &&
                isHop &&
                selected.hopIndex === run.hopIndex);
            const disabled =
              run.status === "waiting" ||
              run.status === "blocked" ||
              run.status === "completed";

            const hopReady =
              isSelected && isHop && selected?.kind === "venue_hop" && canStartHop(run.status);
            const hopHeld = isSelected && isHop && selected?.kind === "venue_hop" && !hopReady;

            return (
              <div
                key={run.key}
                ref={isSelected ? focusRef : undefined}
                className="space-y-2"
              >
                <button
                  type="button"
                  disabled={disabled && !isSelected}
                  onClick={() => {
                    if (run.kind === "outbound") {
                      onSelect({
                        kind: "outbound",
                        busRunCode: run.busRunCode ?? null,
                        card: run,
                      });
                    } else if (run.kind === "return") {
                      onSelect({
                        kind: "return",
                        busRunCode: run.busRunCode ?? null,
                        card: run,
                      });
                    } else if (run.kind === "venue_hop" && run.hopIndex != null) {
                      onSelect({ kind: "venue_hop", hopIndex: run.hopIndex, card: run });
                    }
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition",
                    isSelected
                      ? "border-blue-500 bg-blue-500/10"
                      : disabled
                        ? "border-border bg-muted/20"
                        : "border-border hover:border-blue-400",
                  )}
                >
                  <div className="mt-0.5">{statusIcon(run.status)}</div>
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        "text-sm font-semibold",
                        disabled && !isSelected && "text-foreground/80",
                      )}
                    >
                      {run.label}
                    </div>
                    {run.via && (
                      <div className="text-xs font-medium text-foreground/90">{run.via}</div>
                    )}
                    {run.detail && (
                      <div className="text-xs text-muted-foreground">{run.detail}</div>
                    )}
                  </div>
                </button>

                {hopHeld && hopHold && (
                  <div className={cn("flex items-start gap-2 px-4 py-3", CAUTION_CALLOUT_CLASS)}>
                    <AlertTriangle className={cn("mt-0.5 h-4 w-4", CAUTION_CALLOUT_ICON_CLASS)} />
                    <div>
                      <p className="text-sm font-semibold">{hopHold.title}</p>
                      <p className={cn("mt-0.5 text-xs leading-relaxed", CAUTION_CALLOUT_BODY_CLASS)}>
                        {hopHold.body}
                      </p>
                    </div>
                  </div>
                )}

                {hopReady && selected?.kind === "venue_hop" && (
                  <div className="space-y-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3">
                    <div className="flex items-start gap-2 text-sm">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
                      <div>
                        <p className="font-semibold text-emerald-900 dark:text-emerald-100">
                          Starting from: {selected.card.originLabel ?? "Where the group is"}
                        </p>
                        <p className="text-xs text-emerald-800/80 dark:text-emerald-200/80">
                          Bus is assumed at this pickup — board here and go. How it got here does not matter.
                        </p>
                        {selected.card.originAddress && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {selected.card.originAddress}
                          </p>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={
                        startHop.isPending ||
                        !selected.card.tripId ||
                        !!(dutyGate?.needsGap && !dutyGate.approved)
                      }
                      onClick={() => void submitHop()}
                      className="flex h-12 w-full items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white disabled:opacity-50"
                    >
                      {startHop.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Start hop manifest"
                      )}
                    </button>
                  </div>
                )}

                {isSelected && run.kind === "return" && selected?.kind === "return" && (
                  <div className="space-y-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3">
                    <div className="flex items-start gap-2 text-sm">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
                      <div>
                        <p className="font-semibold text-emerald-900 dark:text-emerald-100">
                          Starting from: {selected.card.originLabel ?? "Last stop"}
                          {selected.card.busRunShortLabel
                            ? ` · ${selected.card.busRunShortLabel}`
                            : ""}
                        </p>
                        <p className="text-xs text-emerald-800/80 dark:text-emerald-200/80">
                          Bus is assumed at this pickup — board return passengers and go home.
                        </p>
                        {selected.card.originAddress && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {selected.card.originAddress}
                          </p>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={
                        startTrip.isPending ||
                        !canStartRun(selected.card.status) ||
                        !!(dutyGate?.needsGap && !dutyGate.approved)
                      }
                      onClick={submitReturn}
                      className="flex h-12 w-full items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white disabled:opacity-50"
                    >
                      {startTrip.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : selected.card.busRunShortLabel ? (
                        `Start ${selected.card.busRunShortLabel} HOME`
                      ) : (
                        "Start return home"
                      )}
                    </button>
                  </div>
                )}

                {isSelected && run.kind === "outbound" && showOutboundStart && children}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
