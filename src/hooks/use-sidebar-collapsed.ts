import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "yada_sidebar_collapsed";

/** Landscape phones/tablets often hit md width but need horizontal space for data tables. */
function isCompactLandscape(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-height: 520px) and (orientation: landscape)").matches;
}

function readStoredCollapsed(): boolean {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return isCompactLandscape();
}

export function useSidebarCollapsed() {
  // Must match SSR output on first paint — never read localStorage in useState initializer.
  const [collapsed, setCollapsedState] = useState(false);

  useEffect(() => {
    setCollapsedState(readStoredCollapsed());
  }, []);

  const setCollapsed = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setCollapsedState((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      localStorage.setItem(STORAGE_KEY, String(value));
      return value;
    });
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, [setCollapsed]);

  return { collapsed, setCollapsed, toggle };
}
