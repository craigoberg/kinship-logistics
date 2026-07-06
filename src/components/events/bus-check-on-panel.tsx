/**
 * BusCheckOnPanel — pre-hop bus check-on roll (§12.4.2)
 *
 * Shows every participant/carer expected on a specific hop (transport_trip).
 * Tap a row → toggles on_bus ↔ expected.
 * "Not travelling" button records a note for a specific person.
 *
 * The panel auto-seeds the manifest from the event roster on first open.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bus,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Lock,
  RefreshCw,
  UserX,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getOrCreateEventHopTrip,
  listBusManifest,
  markNotTravelling,
  markOnBus,
  seedBusManifest,
  type EventBusManifestRow,
} from "@/lib/api/event-day-ops";
import { hasOpenRedIssueForSession } from "@/lib/api/site-issues";
import type { EventVenueStop } from "@/lib/api/event-outing";
import type { EventManifest } from "@/lib/data-store";

interface Props {
  event: EventManifest;
  sessionId: string;
  sessionDate: string;
  stops: EventVenueStop[];
}

const manifestKey = (tripId: string) => ["event-bus-manifest", tripId] as const;

function stopLabel(stop: EventVenueStop | undefined): string {
  return stop?.label_override ?? stop?.venue_name ?? "Unknown stop";
}

export function BusCheckOnPanel({ event, sessionId, sessionDate, stops }: Props) {
  const sorted = useMemo(
    () => [...stops].sort((a, b) => a.stop_order - b.stop_order),
    [stops],
  );

  const hopCount = Math.max(0, sorted.length - 1);

  if (hopCount === 0) {
    return (
      <div className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
        <Bus className="mx-auto mb-2 h-5 w-5" />
        No hops on this day — add at least 2 stops in the Itinerary tab first.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Mark each passenger on-board before the bus departs each hop.
        Missing passengers must be recorded as "Not travelling".
      </p>
      {sorted.slice(0, -1).map((fromStop, idx) => {
        const toStop = sorted[idx + 1];
        return (
          <HopRoll
            key={fromStop.id}
            event={event}
            sessionId={sessionId}
            sessionDate={sessionDate}
            fromStop={fromStop}
            toStop={toStop}
            hopIndex={idx}
          />
        );
      })}
    </div>
  );
}

// ─── One hop roll ─────────────────────────────────────────────────────────────

interface HopRollProps {
  event: EventManifest;
  sessionId: string;
  sessionDate: string;
  fromStop: EventVenueStop;
  toStop: EventVenueStop;
  hopIndex: number;
}

function HopRoll({ event, sessionId, sessionDate, fromStop, toStop, hopIndex }: HopRollProps) {
  const qc = useQueryClient();
  const [tripId, setTripId] = useState<string | null>(null);
  const [initialising, setInitialising] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const {
    data: manifest = [],
    isLoading: manifestLoading,
    isError: manifestError,
    error: manifestErr,
    refetch: refetchManifest,
  } = useQuery({
    queryKey: manifestKey(tripId ?? "__none__"),
    queryFn: () => listBusManifest(tripId!),
    enabled: !!tripId && expanded,
    staleTime: 20_000,
  });

  const invalidate = async () => {
    await qc.refetchQueries({ queryKey: manifestKey(tripId ?? "__none__") });
  };

  const handleExpand = async () => {
    if (!expanded) {
      // Lazily init the trip row.
      if (!tripId) {
        setInitialising(true);
        try {
          const id = await getOrCreateEventHopTrip({
            eventId: event.id,
            eventDaySessionId: sessionId,
            sessionDate,
            fromStopId: fromStop.id,
            toStopId: toStop.id,
            hopIndex,
          });
          setTripId(id);
        } catch (e) {
          toast.error((e as Error).message);
          setInitialising(false);
          return;
        }
        setInitialising(false);
      }
      setExpanded(true);
    } else {
      setExpanded(false);
    }
  };

  const handleSeed = async () => {
    if (!tripId) return;
    setSeeding(true);
    try {
      const n = await seedBusManifest({
        eventId: event.id,
        eventDaySessionId: sessionId,
        tripId,
        // Venue hops — passengers rostered for bus on this outing day.
        direction: "outbound",
      });
      if (n === 0) {
        toast.message(
          "No bus passengers found — check the Roster tab (bus transport) or Arrival roll for this day.",
        );
      } else {
        toast.success(`${n} passenger${n === 1 ? "" : "s"} on bus manifest.`);
      }
      await invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSeeding(false);
    }
  };

  const autoSeededRef = useRef<string | null>(null);

  // Auto-seed on first expand when manifest is empty (§12.4.2).
  useEffect(() => {
    if (!expanded || !tripId || manifestLoading || seeding) return;
    if (manifest.length > 0) return;
    if (autoSeededRef.current === tripId) return;
    autoSeededRef.current = tripId;
    void handleSeed();
  }, [expanded, tripId, manifestLoading, manifest.length, seeding]); // eslint-disable-line react-hooks/exhaustive-deps

  const onBoard = manifest.filter((r) => r.status === "on_bus").length;
  const total = manifest.length;
  const notTravelling = manifest.filter((r) => r.status === "not_travelling").length;
  const expected = manifest.filter((r) => r.status === "expected").length;

  // Depart gate — refresh every 15 s while expanded (§12.4.3).
  const { data: hasRedLock = false } = useQuery({
    queryKey: ["event-day-issues-red-check", sessionId],
    queryFn: () => hasOpenRedIssueForSession(sessionId),
    enabled: expanded && !!tripId,
    refetchInterval: 15_000,
  });

  const departReady = expanded && total > 0 && expected === 0 && !hasRedLock;

  return (
    <div className="rounded-lg border">
      {/* Hop header */}
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30"
        onClick={handleExpand}
        disabled={initialising}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
          {hopIndex + 1}
        </span>
        <span className="flex-1 min-w-0 text-sm font-semibold">
          {stopLabel(fromStop)} → {stopLabel(toStop)}
        </span>
        {tripId && total > 0 && (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {onBoard}/{total} on bus{notTravelling > 0 ? ` · ${notTravelling} not travelling` : ""}
          </span>
        )}
        {initialising ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        ) : expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {/* Roll */}
      {expanded && (
        <div className="border-t">
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-xs text-muted-foreground">Passengers on this hop</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleSeed} disabled={seeding}>
                {seeding ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                Re-seed
              </Button>
            </div>
          </div>

          {manifestLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : manifestError ? (
            <div className="space-y-2 px-4 pb-4 text-center">
              <p className="text-sm text-destructive">
                Could not load bus manifest: {(manifestErr as Error)?.message ?? "Unknown error"}
              </p>
              <Button size="sm" variant="outline" onClick={() => void refetchManifest()}>
                Retry
              </Button>
            </div>
          ) : manifest.length === 0 ? (
            <p className="px-4 pb-4 text-center text-sm text-muted-foreground">
              No passengers on manifest — click "Re-seed" to populate from the roster or arrival roll.
            </p>
          ) : (
            <div className="divide-y">
              {manifest.map((row) => (
                <ManifestRow
                  key={row.id}
                  row={row}
                  onChanged={invalidate}
                />
              ))}
            </div>
          )}

          {/* ── Depart gate ──────────────────────────────────────────── */}
          {total > 0 && (
            <div className="border-t px-4 py-3">
              {departReady ? (
                <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2.5 text-sm font-semibold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  All passengers accounted — bus may depart.
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Depart gate — not ready
                  </div>
                  {expected > 0 && (
                    <div className="flex items-center gap-2 rounded bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      {expected} passenger{expected > 1 ? "s" : ""} still expected — mark on-bus or not-travelling.
                    </div>
                  )}
                  {hasRedLock && (
                    <div className="flex items-center gap-2 rounded bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                      <Lock className="h-3.5 w-3.5 shrink-0" />
                      Open RED issue — resolve before departure.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Individual manifest row ──────────────────────────────────────────────────

interface ManifestRowProps {
  row: EventBusManifestRow;
  onChanged: () => void;
}

function ManifestRow({ row, onChanged }: ManifestRowProps) {
  const [ntOpen, setNtOpen] = useState(false);
  const [ntNotes, setNtNotes] = useState("");

  const markOnBusMut = useMutation({
    mutationFn: () => markOnBus(row),
    onSuccess: () => { toast.success(row.status === "on_bus" ? "Removed from on-bus" : "Marked on bus"); onChanged(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const markNtMut = useMutation({
    mutationFn: () => markNotTravelling(row, ntNotes),
    onSuccess: () => { toast.success("Marked not travelling."); setNtOpen(false); setNtNotes(""); onChanged(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const name = row.participant_name ?? (row.carer_id ? "Carer" : "Unknown");
  const isOnBus = row.status === "on_bus";
  const isNt = row.status === "not_travelling";

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-2.5">
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium">{name}</span>
          {row.carer_id && !row.participant_id && (
            <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">Carer</span>
          )}
          {row.notes && (
            <p className="text-[11px] italic text-muted-foreground truncate">{row.notes}</p>
          )}
        </div>

        {/* Status badge */}
        {isOnBus ? (
          <Badge className="bg-emerald-600 text-white text-[10px]">On bus</Badge>
        ) : isNt ? (
          <Badge className="bg-amber-500 text-white text-[10px]">Not travelling</Badge>
        ) : (
          <Badge variant="secondary" className="text-[10px]">Expected</Badge>
        )}

        {/* Actions */}
        <Button
          size="sm"
          variant={isOnBus ? "outline" : "default"}
          className="h-7 shrink-0"
          disabled={markOnBusMut.isPending || isNt}
          onClick={() => markOnBusMut.mutate()}
        >
          {markOnBusMut.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
        </Button>

        {!isNt && !isOnBus && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 shrink-0 text-destructive hover:text-destructive"
            onClick={() => setNtOpen(true)}
            title="Not travelling"
          >
            <UserX className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Not-travelling notes dialog */}
      <Dialog open={ntOpen} onOpenChange={setNtOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Not travelling — {name}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={ntNotes}
            onChange={(e) => setNtNotes(e.target.value)}
            placeholder="Reason (e.g. feeling unwell, family decision…)"
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNtOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={markNtMut.isPending}
              onClick={() => markNtMut.mutate()}
            >
              {markNtMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <AlertTriangle className="mr-1.5 h-4 w-4" />
              Confirm not travelling
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
