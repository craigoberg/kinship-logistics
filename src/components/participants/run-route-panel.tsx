/**
 * Office default Manifest order per Day Centre bus run.
 * Same drag pattern as Event Manage → Roster. Driver can still reorder on Manifest.
 */
import { useCallback, useMemo, useState } from "react";
import { CalendarOff, GripVertical, Route } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PointerSortableList } from "@/components/manifest/manage-pickups-panel";
import { OffTodayExemptionDialog } from "@/components/attendance/off-today-exemption-dialog";
import {
  useBusRunMap,
  useBusRunRouteRoster,
  useLookupParameters,
  useReorderBusRunDefaultRoute,
  useTodaysRunLiveStatus,
} from "@/hooks/use-supabase-data";
import { LOOKUP_CATEGORIES, type AttendanceSchedule } from "@/lib/data-store";
import {
  dayCodeIsToday,
  shortDayLabel,
  type BusRunRouteDirection,
  type BusRunRouteStop,
} from "@/lib/api/bus-run-routes";
import { lookupRunLiveStatus } from "@/lib/api/run-live-status";
import { useOperationalTodayIso } from "@/lib/operational-clock";
import { todaysSydneyDayCode } from "@/lib/operational-time";
import { RunLiveStatusBadge } from "@/components/attendance/run-live-status-badge";
import { cn } from "@/lib/utils";

export function RunRoutePanel() {
  const { data: busRuns = [] } = useLookupParameters(LOOKUP_CATEGORIES.busRun);
  const busRunMap = useBusRunMap();
  const [runCode, setRunCode] = useState("");
  const [direction, setDirection] = useState<BusRunRouteDirection>("morning");

  const selectedRun = runCode || busRuns[0]?.code || "";
  const { data: stops = [], isLoading, error } = useBusRunRouteRoster(selectedRun, direction);
  const reorder = useReorderBusRunDefaultRoute();
  useOperationalTodayIso();
  const todayDayCode = todaysSydneyDayCode();
  const { data: liveStatusMap } = useTodaysRunLiveStatus();
  const [offTodayStop, setOffTodayStop] = useState<BusRunRouteStop | null>(null);

  const sortableIds = useMemo(() => stops.map((s) => s.participantId), [stops]);
  const stopById = useMemo(
    () => new Map(stops.map((s) => [s.participantId, s])),
    [stops],
  );

  const handleReorder = useCallback(
    (orderedIds: string[]) => {
      if (!selectedRun) return;
      reorder.mutate({
        busRunCode: selectedRun,
        direction,
        participantIds: orderedIds,
      });
    },
    [selectedRun, direction, reorder],
  );

  if (busRuns.length === 0) return null;

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Route className="h-4 w-4" />
          Default run routes
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Drag to set Manifest pickup order for each run. People not attending that
          day are skipped. The driver can still reorder on the active run.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {busRuns.map((run) => {
          const selected = selectedRun === run.code;
          const badge = busRunMap.get(run.code);
          const color = badge?.color ?? "#7c3aed";
          return (
            <button
              key={run.code}
              type="button"
              onClick={() => setRunCode(run.code)}
              style={
                selected
                  ? { backgroundColor: color, borderColor: color }
                  : { borderColor: color, color }
              }
              className={`rounded-full border-2 px-3 py-1 text-xs font-semibold transition ${
                selected ? "text-white" : "bg-card hover:opacity-80"
              }`}
            >
              {run.displayName}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["morning", "Morning pickup"],
            ["afternoon", "Afternoon return"],
          ] as const
        ).map(([code, label]) => {
          const selected = direction === code;
          return (
            <button
              key={code}
              type="button"
              onClick={() => setDirection(code)}
              className={cn(
                "rounded-full border-2 px-3 py-1 text-xs font-semibold transition",
                selected
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-foreground hover:opacity-80",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading route…</p>
      ) : stops.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
          No one is assigned to this run yet. Set Transport IN/OUT on a schedule first.
        </div>
      ) : (
        <>
          {sortableIds.length > 1 && (
            <p className="text-xs text-muted-foreground">
              Drag rows to set the default route. Saves as you drop.
            </p>
          )}
          <div className="overflow-hidden rounded-lg border border-border">
            <PointerSortableList
              itemIds={sortableIds}
              onReorder={handleReorder}
              disabled={reorder.isPending || sortableIds.length < 2}
            >
              {({ ids, bindRow }) =>
                ids.map((id, idx) => {
                  const stop = stopById.get(id);
                  if (!stop) return null;
                  const bind = bindRow(id);
                  const liveStatus = lookupRunLiveStatus(
                    liveStatusMap ?? new Map(),
                    stop.participantId,
                    selectedRun,
                    direction,
                  );
                  return (
                    <div
                      key={id}
                      ref={bind.rowRef}
                      className={cn(
                        "flex items-start gap-2 border-t border-border px-2 py-2 first:border-t-0",
                        bind.isDragging && "bg-muted/50 shadow-md",
                      )}
                    >
                      <button
                        type="button"
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground",
                          reorder.isPending || sortableIds.length < 2
                            ? "cursor-not-allowed opacity-50"
                            : "cursor-grab touch-manipulation active:cursor-grabbing",
                        )}
                        aria-label={`Drag to reorder ${stop.name}`}
                        disabled={reorder.isPending || sortableIds.length < 2}
                        onPointerDown={bind.onGripPointerDown}
                      >
                        <GripVertical className="h-4 w-4" />
                      </button>
                      <span className="w-6 shrink-0 text-xs font-mono tabular-nums text-muted-foreground">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{stop.name}</div>
                        {stop.address ? (
                          <div className="text-xs text-muted-foreground">{stop.address}</div>
                        ) : (
                          <div className="text-xs italic text-warning">No pickup address on file</div>
                        )}
                        <div className="mt-1 flex flex-wrap gap-1">
                          {stop.dayCodes.map((d) => (
                            <span
                              key={d}
                              className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                            >
                              {shortDayLabel(d)}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex w-[7.5rem] shrink-0 justify-end pt-0.5">
                        {stop.todaySchedule &&
                          liveStatus?.kind !== "off_today" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="shrink-0 gap-1"
                              onClick={() => setOffTodayStop(stop)}
                              title="Mark this person off today's run"
                            >
                              <CalendarOff className="h-3.5 w-3.5" />
                              Off today
                            </Button>
                          )}
                      </div>
                      <div className="flex w-[6.5rem] shrink-0 justify-end pt-0.5">
                        {stop.dayCodes.some((d) => dayCodeIsToday(d, todayDayCode)) && (
                          <RunLiveStatusBadge status={liveStatus} />
                        )}
                      </div>
                    </div>
                  );
                })
              }
            </PointerSortableList>
          </div>
        </>
      )}
      <OffTodayExemptionDialog
        open={offTodayStop != null}
        onOpenChange={(o) => {
          if (!o) setOffTodayStop(null);
        }}
        schedule={
          offTodayStop?.todaySchedule
            ? (offTodayStop.todaySchedule as AttendanceSchedule)
            : null
        }
        participantName={offTodayStop?.name ?? ""}
      />
    </Card>
  );
}
