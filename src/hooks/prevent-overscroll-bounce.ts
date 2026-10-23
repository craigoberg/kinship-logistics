import { useEffect } from "react";

/**
 * iPhone Chrome rubber-bands a scroll pane at the top and bottom even when
 * `overscroll-behavior` is set. That spring moves Depart / Arrive under the thumb.
 * Block the gesture only at the edge, and when nothing on the page can scroll.
 */
export function usePreventOverscrollBounce(active: boolean) {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;

    let startY = 0;

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      startY = event.touches[0]!.clientY;
    };

    const onMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const target = event.target;
      if (target instanceof Element && target.closest(".touch-none")) return;

      const dy = event.touches[0]!.clientY - startY;
      const scroller = scrollableAncestor(target);
      if (!scroller) {
        if (event.cancelable) event.preventDefault();
        return;
      }

      const atTop = scroller.scrollTop <= 0;
      const atBottom =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
      const pullingPastEdge =
        (atTop && atBottom) || (atTop && dy > 0) || (atBottom && dy < 0);
      if (pullingPastEdge && event.cancelable) event.preventDefault();
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
    };
  }, [active]);
}

function scrollableAncestor(target: EventTarget | null): HTMLElement | null {
  let node = target instanceof Element ? target.parentElement : null;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = getComputedStyle(node);
    const scrolls = /(auto|scroll)/.test(style.overflowY);
    if (scrolls && node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }
  return null;
}
