/**
 * Hide the floating Incident / Raise ticket pills while PIN, incident, or
 * ticket dialogs are open so they cannot sit on top of the pad or File CTA.
 */
import { useEffect, useSyncExternalStore } from "react";

let hideCount = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const cb of listeners) cb();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): boolean {
  return hideCount > 0;
}

export function useGlobalFabsHidden(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** While `hidden` is true, floating Incident / ticket pills are not shown. */
export function useHideGlobalFabs(hidden: boolean): void {
  useEffect(() => {
    if (!hidden) return;
    hideCount += 1;
    emit();
    return () => {
      hideCount = Math.max(0, hideCount - 1);
      emit();
    };
  }, [hidden]);
}
