import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouterState } from "@tanstack/react-router";

/** Pixels of travel in one direction before chrome flips. */
const TRAVEL_PX = 48;
/** Ignore scroll events after a flip so layout resize cannot bounce the state. */
const LOCK_MS = 420;
const TOP_PX = 2;

type ChromeVisibilityValue = {
  chromeHidden: boolean;
  setChromeHidden: (hidden: boolean) => void;
};

const ChromeVisibilityContext = createContext<ChromeVisibilityValue>({
  chromeHidden: false,
  setChromeHidden: () => {},
});

export function ChromeVisibilityProvider({ children }: { children: ReactNode }) {
  const [chromeHidden, setChromeHidden] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    setChromeHidden(false);
  }, [pathname]);

  const value = useMemo(
    () => ({ chromeHidden, setChromeHidden }),
    [chromeHidden],
  );

  return (
    <ChromeVisibilityContext.Provider value={value}>
      {children}
    </ChromeVisibilityContext.Provider>
  );
}

export function useChromeVisibility() {
  return useContext(ChromeVisibilityContext);
}

function scrollTopOf(target: Window | HTMLElement): number {
  if (target instanceof Window) {
    return target.scrollY || document.documentElement.scrollTop || 0;
  }
  return target.scrollTop;
}

/**
 * Hide AppShell / BottomNav / Manifest Cancel on scroll down; reveal on
 * scroll up. Dashboard uses the document (`"window"`). Manifest uses its
 * inner pane. Travel is accumulated so touch jitter and layout-resize
 * scroll events cannot flicker the chrome.
 */
export function useHideChromeOnScroll(target: Window | HTMLElement | null | "window") {
  const { chromeHidden, setChromeHidden } = useChromeVisibility();
  const hiddenRef = useRef(chromeHidden);
  hiddenRef.current = chromeHidden;

  useEffect(() => {
    const el = target === "window" ? window : target;
    if (!el) return;

    let last = scrollTopOf(el);
    let frame = 0;
    let lockUntil = 0;
    let hideTravel = 0;
    let showTravel = 0;

    const apply = (hidden: boolean) => {
      if (hiddenRef.current === hidden) return;
      hiddenRef.current = hidden;
      setChromeHidden(hidden);
      hideTravel = 0;
      showTravel = 0;
      lockUntil = performance.now() + LOCK_MS;
      window.requestAnimationFrame(() => {
        last = scrollTopOf(el);
      });
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const top = scrollTopOf(el);
        const delta = top - last;
        last = top;

        if (performance.now() < lockUntil) return;
        if (top <= TOP_PX) {
          apply(false);
          return;
        }
        if (delta === 0) return;

        if (delta > 0) {
          hideTravel += delta;
          showTravel = 0;
          if (!hiddenRef.current && hideTravel >= TRAVEL_PX) apply(true);
        } else {
          showTravel += -delta;
          hideTravel = 0;
          if (hiddenRef.current && showTravel >= TRAVEL_PX) apply(false);
        }
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [target, setChromeHidden]);
}

export function useHideChromeOnScrollRef<T extends HTMLElement = HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  useHideChromeOnScroll(node);
  return useCallback((el: T | null) => {
    setNode(el);
  }, []);
}
