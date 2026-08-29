/**
 * Draggable, device-sticky floating action pill (Incident / Raise ticket).
 * Drag to park it off Save/Close; the spot is remembered in localStorage.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  clampFabPoint,
  FAB_DRAG_THRESHOLD_PX,
  readFabPosition,
  writeFabPosition,
  type FabId,
  type FabPoint,
} from "@/lib/ui/sticky-fab-position";

interface Props {
  id: FabId;
  /** CSS used until the user has dragged (or a saved spot is loaded). */
  defaultClassName: string;
  className?: string;
  ariaLabel: string;
  hidden?: boolean;
  onClick: () => void;
  children: ReactNode;
}

export function DraggableFab({
  id,
  defaultClassName,
  className,
  ariaLabel,
  hidden,
  onClick,
  children,
}: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<FabPoint | null>(null);
  const posRef = useRef<FabPoint | null>(null);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
    moved: boolean;
  } | null>(null);
  const movedRef = useRef(false);

  const applyPos = useCallback((next: FabPoint) => {
    posRef.current = next;
    setPos(next);
  }, []);

  const measureSize = useCallback(() => {
    const el = ref.current;
    if (!el) return { width: 160, height: 44 };
    const r = el.getBoundingClientRect();
    return {
      width: Math.max(44, r.width),
      height: Math.max(40, r.height),
    };
  }, []);

  useEffect(() => {
    const saved = readFabPosition(id);
    if (!saved) return;
    applyPos(clampFabPoint(saved, measureSize()));
  }, [id, measureSize, applyPos]);

  useEffect(() => {
    if (!pos) return;
    const onResize = () => {
      setPos((prev) => {
        if (!prev) return prev;
        const next = clampFabPoint(prev, measureSize());
        posRef.current = next;
        return next;
      });
    };
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [pos, measureSize]);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    el.setPointerCapture(e.pointerId);
    movedRef.current = false;
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const s = drag.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (!s.moved) {
      if (dx * dx + dy * dy < FAB_DRAG_THRESHOLD_PX * FAB_DRAG_THRESHOLD_PX) return;
      s.moved = true;
      movedRef.current = true;
    }
    const next = clampFabPoint(
      { left: s.originLeft + dx, top: s.originTop + dy },
      measureSize(),
    );
    applyPos(next);
  };

  const endDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const s = drag.current;
    if (!s || s.pointerId !== e.pointerId) return;
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (s.moved && posRef.current) writeFabPosition(id, posRef.current);
  };

  if (hidden) return null;

  return (
    <button
      ref={ref}
      type="button"
      data-ticket-chrome
      data-floating-fab
      aria-label={ariaLabel}
      title="Drag to move — this device remembers the spot"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={(e) => {
        if (movedRef.current) {
          e.preventDefault();
          e.stopPropagation();
          movedRef.current = false;
          return;
        }
        onClick();
      }}
      style={
        pos
          ? {
              position: "fixed",
              left: pos.left,
              top: pos.top,
              right: "auto",
              bottom: "auto",
            }
          : undefined
      }
      className={cn(
        pos ? "fixed z-[60]" : defaultClassName,
        "touch-none select-none cursor-grab active:cursor-grabbing",
        className,
      )}
    >
      {children}
    </button>
  );
}
