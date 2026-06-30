import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { GripVertical, UserX } from "lucide-react";
import { toast } from "sonner";
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
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { BusRunRosterEntry, TripLeg } from "@/lib/data-store";
import { isPassengerPickupLeg } from "@/lib/data-store";
import { useCancelTripPickup } from "@/hooks/use-supabase-data";

export { isPassengerPickupLeg };

export function canCancelPickupLeg(leg: TripLeg): boolean {
  return isPassengerPickupLeg(leg) && leg.status !== "completed";
}

/** Shared cancel flow — use from ActiveLegCard and LegRow. */
export function usePickupCancelDialog(tripId: string) {
  const cancelPickup = useCancelTripPickup();
  const [cancelTarget, setCancelTarget] = useState<TripLeg | null>(null);

  const requestCancel = (leg: TripLeg) => setCancelTarget(leg);

  const confirmCancel = () => {
    if (!cancelTarget) return;
    const name = cancelTarget.toLabel;
    cancelPickup.mutate(
      {
        legId: cancelTarget.id,
        tripId,
        participantName: name,
        reason: "Office advised passenger called in sick / not travelling today.",
      },
      {
        onSuccess: (result) => {
          setCancelTarget(null);
          toast.success(`${name} pickup cancelled`, {
            description: result.smsDispatched
              ? "Manager SMS sent · YELLOW issue opened in Hub."
              : "YELLOW issue opened in Hub for manager follow-up.",
          });
        },
      },
    );
  };

  const dialog = (
    <AlertDialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel pickup for {cancelTarget?.toLabel}?</AlertDialogTitle>
          <AlertDialogDescription>
            The driver will skip this stop and move to the next passenger. This sends an SMS alert
            to managers and creates a YELLOW issue in the Governance Hub for follow-up.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep stop</AlertDialogCancel>
          <AlertDialogAction
            className="bg-amber-600 hover:bg-amber-700"
            disabled={cancelPickup.isPending}
            onClick={(e) => {
              e.preventDefault();
              confirmCancel();
            }}
          >
            Cancel pickup
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { requestCancel, dialog, isCancelling: cancelPickup.isPending };
}

type SortableRowProps = {
  id: string;
  index: number;
  title: string;
  subtitle?: string | null;
  dragDisabled?: boolean;
  isDragging?: boolean;
  trailing?: ReactNode;
  highlight?: boolean;
  onGripPointerDown: (e: React.PointerEvent) => void;
  rowRef: (el: HTMLDivElement | null) => void;
};

function SortablePickupRow({
  id,
  index,
  title,
  subtitle,
  dragDisabled,
  isDragging,
  trailing,
  highlight,
  onGripPointerDown,
  rowRef,
}: SortableRowProps) {
  return (
    <div
      ref={rowRef}
      data-sort-id={id}
      className={cn(
        "flex items-center gap-2 rounded-xl border bg-card px-3 py-2.5 touch-manipulation select-none",
        highlight ? "border-blue-500/50 bg-blue-500/10" : "border-border",
        isDragging && "z-10 opacity-90 shadow-lg ring-2 ring-blue-400",
        dragDisabled && "opacity-70",
      )}
    >
      <button
        type="button"
        className={cn(
          "flex h-10 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground",
          dragDisabled ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing",
        )}
        aria-label="Drag to reorder"
        disabled={dragDisabled}
        onPointerDown={onGripPointerDown}
      >
        <GripVertical className="h-5 w-5" />
      </button>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600/20 text-xs font-bold text-blue-400">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{title}</div>
        {subtitle && (
          <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        )}
      </div>
      {trailing}
    </div>
  );
}

/** Touch-friendly drag reorder — no external deps (works on iPhone). */
export function PointerSortableList({
  itemIds,
  onReorder,
  disabled,
  children,
}: {
  itemIds: string[];
  onReorder: (nextIds: string[]) => void;
  disabled?: boolean;
  children: (ctx: {
    ids: string[];
    dragId: string | null;
    bindRow: (id: string) => {
      rowRef: (el: HTMLDivElement | null) => void;
      onGripPointerDown: (e: React.PointerEvent) => void;
      isDragging: boolean;
    };
  }) => ReactNode;
}) {
  const [order, setOrder] = useState(itemIds);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragRef = useRef<{ id: string; pointerId: number } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => {
    setOrder(itemIds);
  }, [itemIds.join("|")]);

  const swapByPointerY = useCallback((clientY: number, activeId: string) => {
    setOrder((prev) => {
      const fromIndex = prev.indexOf(activeId);
      if (fromIndex < 0) return prev;

      let toIndex = fromIndex;
      for (let i = 0; i < prev.length; i++) {
        if (i === fromIndex) continue;
        const el = rowRefs.current.get(prev[i]);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (i < fromIndex && clientY < mid) toIndex = Math.min(toIndex, i);
        if (i > fromIndex && clientY > mid) toIndex = Math.max(toIndex, i);
      }
      if (toIndex === fromIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.current || e.pointerId !== dragRef.current.pointerId) return;
      e.preventDefault();
      swapByPointerY(e.clientY, dragRef.current.id);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!dragRef.current || e.pointerId !== dragRef.current.pointerId) return;
      dragRef.current = null;
      setDragId(null);
      setOrder((current) => {
        onReorder(current);
        return current;
      });
    };

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [onReorder, swapByPointerY]);

  const bindRow = useCallback(
    (id: string) => ({
      rowRef: (el: HTMLDivElement | null) => {
        if (el) rowRefs.current.set(id, el);
        else rowRefs.current.delete(id);
      },
      onGripPointerDown: (e: React.PointerEvent) => {
        if (disabled) return;
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        dragRef.current = { id, pointerId: e.pointerId };
        setDragId(id);
      },
      isDragging: dragId === id,
    }),
    [disabled, dragId],
  );

  return <>{children({ ids: order, dragId, bindRow })}</>;
}

/** Pre-start: drag to reorder roster before opening manifest. */
export function PreviewPickupOrderPanel({
  entries,
  order,
  onOrderChange,
}: {
  entries: BusRunRosterEntry[];
  order: string[];
  onOrderChange: (ids: string[]) => void;
}) {
  const entryMap = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  if (entries.length === 0) return null;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
      <div className="text-sm font-semibold">Pickup order</div>
      <p className="text-xs text-muted-foreground">
        Press and drag the handle to reorder. Route auto-optimisation coming later.
      </p>
      <PointerSortableList itemIds={order} onReorder={onOrderChange}>
        {({ ids, bindRow }) => (
          <div className="space-y-2">
            {ids.map((id, index) => {
              const entry = entryMap.get(id);
              if (!entry) return null;
              const bind = bindRow(id);
              return (
                <SortablePickupRow
                  key={id}
                  id={id}
                  index={index}
                  title={entry.name}
                  subtitle={entry.address}
                  {...bind}
                />
              );
            })}
          </div>
        )}
      </PointerSortableList>
    </div>
  );
}

export type PickupDragBind = {
  rowRef: (el: HTMLDivElement | null) => void;
  onGripPointerDown: (e: React.PointerEvent) => void;
  isDragging: boolean;
};

/** Compact cancel control for leg rows and active leg header. */
export function PickupCancelButton({
  onClick,
  disabled,
  className,
  size = "default",
}: {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  size?: "default" | "sm";
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size={size === "sm" ? "sm" : "icon"}
      className={cn(
        size === "sm" ? "h-8 gap-1 px-2 text-xs" : "h-9 w-9",
        "shrink-0 border-amber-500/50 text-amber-600 hover:bg-amber-500/10 hover:text-amber-700",
        className,
      )}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label="Cancel pickup"
    >
      <UserX className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
      {size === "sm" && <span>Cancel</span>}
    </Button>
  );
}
