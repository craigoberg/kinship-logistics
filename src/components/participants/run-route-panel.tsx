/**
 * Office default Manifest order per Day Centre bus run.
 * Same drag pattern as Event Manage → Roster. Driver can still reorder on Manifest.
 */
import { useCallback, useMemo, useState } from "react";
import { GripVertical, Route } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PointerSortableList } from "@/components/manifest/manage-pickups-panel";
import {
  useBusRunMap,
  useBusRunRouteRoster,
  useLookupParameters,
  useReorderBusRunDefaultRoute,
} from "@/hooks/use-supabase-data";
import { LOOKUP_CATEGORIES } from "@/lib/data-store";
import {
  shortDayLabel,
  type BusRunRouteDirection,
} from "@/lib/api/bus-run-routes";
import { cn } from "@/lib/utils";

export function RunRoutePanel() {
  const { data: busRuns = [] } = useLookupParameters(LOOKUP_CATEGORIES.busRun);
  const busRunMap = useBusRunMap();
  const [runCode, setRunCode] = useState("");
  const [direction, setDirection] = useState<BusRunRouteDirection>("morning");

  const selectedRun = runCode || busRuns[0]?.code || "";
  const { data: stops = [], isLoading, error } = useBusRunRouteRoster(selectedRun, direction);
  const reorder = useReorderBusRunDefaultRoute();

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
                          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground",
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
                      <span className="mt-1 w-6 shrink-0 text-xs font-mono tabular-nums text-muted-foreground">
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
                    </div>
                  );
                })
              }
            </PointerSortableList>
          </div>
        </>
      )}
    </Card>
  );
}
