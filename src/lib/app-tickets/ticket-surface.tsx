/**
 * Ticket surface — BL-116
 *
 * Open dialogs / sheets register their title so Raise ticket can stamp
 * "what form" without wiring every screen by hand.
 */
import {
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface TicketSurfaceEntry {
  id: string;
  title: string;
}

interface TicketSurfaceContextValue {
  activeFormTitle: string | null;
  lastControlLabel: string | null;
  raiseOpen: boolean;
  uiEnabled: boolean;
  setUiEnabled: (on: boolean) => void;
  requestRaise: () => void;
  setRaiseOpen: (open: boolean) => void;
  registerSurface: (id: string, title: string) => void;
  unregisterSurface: (id: string) => void;
}

const TicketSurfaceContext = createContext<TicketSurfaceContextValue | null>(null);

/** When true, Dialog/Sheet chrome hides the Ticket button and does not register the title. */
const HideFormTicketContext = createContext(false);

export function HideFormTicketProvider({
  hide,
  children,
}: {
  hide: boolean;
  children: ReactNode;
}) {
  return (
    <HideFormTicketContext.Provider value={hide}>
      {children}
    </HideFormTicketContext.Provider>
  );
}

export function useHideFormTicket(): boolean {
  return useContext(HideFormTicketContext);
}

export function nodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) {
    return node.map(nodeText).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }
  if (isValidElement(node)) {
    return nodeText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

function controlLabelFromEvent(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLElement)) return null;
  if (target.closest("[data-ticket-chrome]")) return null;

  const labelled =
    target.getAttribute("aria-label") ||
    target.closest("[aria-label]")?.getAttribute("aria-label");
  if (labelled?.trim()) return labelled.trim().slice(0, 80);

  const btn = target.closest("button, a, [role='button']");
  const text = btn?.textContent?.replace(/\s+/g, " ").trim();
  if (text && text.length > 0 && text.length <= 80) return text;

  const field =
    target.closest("label")?.textContent ||
    (target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
      ? target.getAttribute("placeholder") || target.name || target.id
      : null);
  if (field) return String(field).replace(/\s+/g, " ").trim().slice(0, 80);

  return null;
}

export function TicketSurfaceProvider({ children }: { children: ReactNode }) {
  const [surfaces, setSurfaces] = useState<TicketSurfaceEntry[]>([]);
  const [lastControlLabel, setLastControlLabel] = useState<string | null>(null);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [uiEnabled, setUiEnabled] = useState(false);

  const registerSurface = useCallback((id: string, title: string) => {
    const trimmed = title.replace(/\s+/g, " ").trim();
    if (!trimmed) return;
    setSurfaces((prev) => {
      const next = prev.filter((s) => s.id !== id);
      next.push({ id, title: trimmed.slice(0, 120) });
      return next;
    });
  }, []);

  const unregisterSurface = useCallback((id: string) => {
    setSurfaces((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const raiseOpenRef = useRef(false);
  raiseOpenRef.current = raiseOpen;

  useEffect(() => {
    const onPointer = (e: Event) => {
      if (raiseOpenRef.current) return;
      const label = controlLabelFromEvent(e.target);
      if (label) setLastControlLabel(label);
    };
    document.addEventListener("click", onPointer, true);
    document.addEventListener("focusin", onPointer, true);
    return () => {
      document.removeEventListener("click", onPointer, true);
      document.removeEventListener("focusin", onPointer, true);
    };
  }, []);

  const value = useMemo<TicketSurfaceContextValue>(
    () => ({
      activeFormTitle: surfaces.at(-1)?.title ?? null,
      lastControlLabel,
      raiseOpen,
      uiEnabled,
      setUiEnabled,
      requestRaise: () => setRaiseOpen(true),
      setRaiseOpen,
      registerSurface,
      unregisterSurface,
    }),
    [surfaces, lastControlLabel, raiseOpen, uiEnabled, registerSurface, unregisterSurface],
  );

  return (
    <TicketSurfaceContext.Provider value={value}>
      {children}
    </TicketSurfaceContext.Provider>
  );
}

export function useTicketSurface(): TicketSurfaceContextValue {
  const ctx = useContext(TicketSurfaceContext);
  if (!ctx) {
    throw new Error("useTicketSurface must be used inside TicketSurfaceProvider");
  }
  return ctx;
}

export function useOptionalTicketSurface(): TicketSurfaceContextValue | null {
  return useContext(TicketSurfaceContext);
}

/** Register the current dialog/sheet title while mounted. */
export function useRegisterTicketSurface(title: string, enabled = true) {
  const ctx = useOptionalTicketSurface();
  const id = useId();

  useEffect(() => {
    if (!ctx || !enabled) return;
    const t = title.replace(/\s+/g, " ").trim();
    if (!t) return;
    ctx.registerSurface(id, t);
    return () => ctx.unregisterSurface(id);
    // Intentionally omit `ctx` — registering would recreate context and loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, id, title]);
}
