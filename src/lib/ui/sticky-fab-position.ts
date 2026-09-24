/**
 * Persist draggable FAB coordinates on this device (localStorage).
 * Used by Incident / Fault and Raise ticket so office tablets can park
 * the pills away from Save / Close.
 */

export type FabId = "incident" | "ticket";
export type FabPoint = { left: number; top: number };

const STORAGE_PREFIX = "yada.fabPos.v1.";
const EDGE_PAD = 8;
const DRAG_THRESHOLD_PX = 8;

export const FAB_DRAG_THRESHOLD_PX = DRAG_THRESHOLD_PX;

function storageKey(id: FabId): string {
  return `${STORAGE_PREFIX}${id}`;
}

export function readFabPosition(id: FabId): FabPoint | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FabPoint>;
    if (typeof parsed.left !== "number" || typeof parsed.top !== "number") return null;
    if (!Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) return null;
    return { left: parsed.left, top: parsed.top };
  } catch {
    return null;
  }
}

export function writeFabPosition(id: FabId, point: FabPoint): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(id), JSON.stringify(point));
  } catch {
    // Quota / private mode — position still works for this session.
  }
}

function safeInset(side: "top" | "right" | "bottom" | "left"): number {
  if (typeof window === "undefined") return 0;
  const styles = window.getComputedStyle(document.documentElement);
  const raw = styles.getPropertyValue(`env(safe-area-inset-${side})`);
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

export function viewportSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 1024, height: 768 };
  const vv = window.visualViewport;
  return {
    width: Math.round(vv?.width ?? window.innerWidth),
    height: Math.round(vv?.height ?? window.innerHeight),
  };
}

export function clampFabPoint(
  point: FabPoint,
  size: { width: number; height: number },
): FabPoint {
  const { width: vw, height: vh } = viewportSize();
  const minLeft = EDGE_PAD + safeInset("left");
  const minTop = EDGE_PAD + safeInset("top");
  const maxLeft = Math.max(minLeft, vw - size.width - EDGE_PAD - safeInset("right"));
  const maxTop = Math.max(minTop, vh - size.height - EDGE_PAD - safeInset("bottom"));
  return {
    left: Math.min(maxLeft, Math.max(minLeft, point.left)),
    top: Math.min(maxTop, Math.max(minTop, point.top)),
  };
}

const FAB_SELECTOR = "[data-floating-fab]";

/** True when a Radix dismiss event started on a floating Incident / ticket pill. */
export function isFloatingFabEvent(event: {
  target: EventTarget | null;
  detail?: { originalEvent?: Event };
}): boolean {
  const fromDetail = event.detail?.originalEvent?.target ?? null;
  const t = fromDetail ?? event.target;
  return t instanceof Element && !!t.closest(FAB_SELECTOR);
}

