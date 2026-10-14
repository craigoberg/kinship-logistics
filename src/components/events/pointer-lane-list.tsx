import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export type LaneBind = {
  rowRef: (el: HTMLElement | null) => void;
  onGripPointerDown: (e: React.PointerEvent) => void;
  isDragging: boolean;
};

type Lane = { id: string; itemIds: string[] };

function isScrollable(el: HTMLElement): boolean {
  const { overflowY, overflow } = getComputedStyle(el);
  return /(auto|scroll)/.test(overflowY) || /(auto|scroll)/.test(overflow);
}

function lockScrollAncestors(from: HTMLElement): HTMLElement[] {
  const locked: HTMLElement[] = [];
  let node: HTMLElement | null = from.parentElement;
  while (node) {
    if (isScrollable(node)) {
      locked.push(node);
      node.dataset.laneScrollLock = node.style.overflow;
      node.style.overflow = "hidden";
      node.style.touchAction = "none";
    }
    node = node.parentElement;
  }
  return locked;
}

function unlockScrollAncestors(locked: HTMLElement[]): void {
  for (const node of locked) {
    node.style.overflow = node.dataset.laneScrollLock ?? "";
    node.style.touchAction = "";
    delete node.dataset.laneScrollLock;
  }
}

/**
 * Touch drag between stacked lists. Dropping in another list reports that move.
 * Order inside a list is not saved.
 */
export function PointerLaneList({
  lanes,
  onMove,
  disabled,
  children,
}: {
  lanes: Lane[];
  onMove: (itemId: string, toLaneId: string) => void;
  disabled?: boolean;
  children: (ctx: {
    lanes: Lane[];
    dragId: string | null;
    bindLane: (id: string) => (el: HTMLElement | null) => void;
    bindRow: (id: string) => LaneBind;
  }) => ReactNode;
}) {
  const [placement, setPlacement] = useState(lanes);
  const placementRef = useRef(lanes);
  const startLaneRef = useRef<string | null>(null);
  const laneRefs = useRef<Map<string, HTMLElement>>(new Map());
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const dragRef = useRef<{ id: string; pointerId: number; lockedScroll: HTMLElement[] } | null>(
    null,
  );
  const [dragId, setDragId] = useState<string | null>(null);

  const laneKey = lanes.map((l) => `${l.id}:${l.itemIds.join(",")}`).join("|");
  useEffect(() => {
    if (dragRef.current) return;
    setPlacement(lanes);
    placementRef.current = lanes;
  }, [laneKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const placeByPointer = useCallback((clientY: number, activeId: string) => {
    const current = placementRef.current;
    const boxes = current
      .map((lane) => {
        const el = laneRefs.current.get(lane.id);
        if (!el) return null;
        return { id: lane.id, rect: el.getBoundingClientRect() };
      })
      .filter((b): b is { id: string; rect: DOMRect } => !!b);
    if (boxes.length === 0) return;

    let targetId = boxes[boxes.length - 1]!.id;
    for (const box of boxes) {
      if (clientY <= box.rect.bottom) {
        targetId = box.id;
        break;
      }
    }

    const next = current.map((lane) => ({
      ...lane,
      itemIds: lane.itemIds.filter((id) => id !== activeId),
    }));
    const target = next.find((lane) => lane.id === targetId);
    if (!target) return;
    const others = target.itemIds;
    let insertAt = others.length;
    for (let i = 0; i < others.length; i++) {
      const el = rowRefs.current.get(others[i]!);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        insertAt = i;
        break;
      }
    }
    target.itemIds = [...others.slice(0, insertAt), activeId, ...others.slice(insertAt)];
    const same = next.every((lane, i) => lane.itemIds.join("|") === current[i]?.itemIds.join("|"));
    if (same) return;
    placementRef.current = next;
    setPlacement(next);
  }, []);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.current || e.pointerId !== dragRef.current.pointerId) return;
      e.preventDefault();
      placeByPointer(e.clientY, dragRef.current.id);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!dragRef.current || e.pointerId !== dragRef.current.pointerId) return;
      unlockScrollAncestors(dragRef.current.lockedScroll);
      const id = dragRef.current.id;
      dragRef.current = null;
      setDragId(null);
      const from = startLaneRef.current;
      startLaneRef.current = null;
      const to = placementRef.current.find((lane) => lane.itemIds.includes(id))?.id ?? null;
      if (from && to && from !== to) onMove(id, to);
      setPlacement(lanes);
      placementRef.current = lanes;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [lanes, onMove, placeByPointer]);

  useEffect(
    () => () => {
      if (dragRef.current) {
        unlockScrollAncestors(dragRef.current.lockedScroll);
        dragRef.current = null;
      }
    },
    [],
  );

  const bindLane = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) laneRefs.current.set(id, el);
      else laneRefs.current.delete(id);
    },
    [],
  );

  const bindRow = useCallback(
    (id: string) => ({
      rowRef: (el: HTMLElement | null) => {
        if (el) rowRefs.current.set(id, el);
        else rowRefs.current.delete(id);
      },
      onGripPointerDown: (e: React.PointerEvent) => {
        if (disabled) return;
        e.preventDefault();
        e.stopPropagation();
        const grip = e.currentTarget as HTMLElement;
        grip.setPointerCapture(e.pointerId);
        const lockedScroll = lockScrollAncestors(grip);
        dragRef.current = { id, pointerId: e.pointerId, lockedScroll };
        startLaneRef.current =
          placementRef.current.find((lane) => lane.itemIds.includes(id))?.id ?? null;
        setDragId(id);
      },
      isDragging: dragId === id,
    }),
    [disabled, dragId],
  );

  return <>{children({ lanes: placement, dragId, bindLane, bindRow })}</>;
}
