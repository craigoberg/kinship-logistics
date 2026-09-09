import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouterState } from "@tanstack/react-router";

const HIDE_DELTA = 12;
const SHOW_DELTA = 8;
const TOP_REVEAL_PX = 24;

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
 * scroll up or when the scroller is back near the top.
 * Dashboard uses the document (`"window"`). Manifest uses its inner pane.
 */
export function useHideChromeOnScroll(target: Window | HTMLElement | null | "window") {
  const { setChromeHidden } = useChromeVisibility();

  useEffect(() => {
    const el = target === "window" ? window : target;
    if (!el) return;

    let last = scrollTopOf(el);
    if (last <= TOP_REVEAL_PX) setChromeHidden(false);
    let frame = 0;

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const top = scrollTopOf(el);
        const delta = top - last;
        if (top <= TOP_REVEAL_PX) {
          setChromeHidden(false);
        } else if (delta > HIDE_DELTA) {
          setChromeHidden(true);
        } else if (delta < -SHOW_DELTA) {
          setChromeHidden(false);
        }
        last = top;
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
