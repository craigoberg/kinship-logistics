/** Bring a Manifest block into the column scroller (`data-manifest-scroll`). */
export function revealInManifestScroll(el: HTMLElement | null) {
  if (!el) return;
  const scroller = el.closest("[data-manifest-scroll]");
  if (!(scroller instanceof HTMLElement)) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const scrollerRect = scroller.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  let delta = elRect.top - scrollerRect.top - 8;
  const bottomOverflow = elRect.bottom - scrollerRect.bottom;
  if (bottomOverflow > 8) {
    const room = scrollerRect.height - 16;
    if (elRect.height <= room) delta += bottomOverflow + 8;
    else delta = elRect.bottom - scrollerRect.bottom + 8;
  }
  if (Math.abs(delta) > 1) {
    scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + delta), behavior: "smooth" });
  }
}
