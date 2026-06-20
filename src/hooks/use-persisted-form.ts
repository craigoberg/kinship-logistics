import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Form draft persistence in sessionStorage with:
 *  - `hasDraft` detection on mount (does NOT auto-apply; the consuming form
 *    should render a "Resume draft?" banner that calls `resumeDraft()`).
 *  - Debounced writes on every `setValues`.
 *  - `beforeunload` warning while the form is dirty (browser-native prompt).
 *  - `reset()` / `discardDraft()` clear storage and reset to `initial`.
 *
 * Sensitive fields (PINs, signatures) MUST NOT be passed through this hook —
 * they belong in plain `useState` so they never touch sessionStorage.
 *
 * Storage shape:
 *   sessionStorage["form:<key>"] = JSON.stringify({ savedAt: number, values: T })
 */
export interface PersistedDraftMeta {
  savedAt: number;
}

export interface UsePersistedForm<T> {
  values: T;
  setValues: (patch: Partial<T> | ((prev: T) => Partial<T>)) => void;
  replace: (next: T) => void;
  reset: () => void;
  isDirty: boolean;
  hasDraft: boolean;
  draftMeta: PersistedDraftMeta | null;
  resumeDraft: () => void;
  discardDraft: () => void;
}

const STORAGE_PREFIX = "form:";

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`;
}

function readDraft<T>(key: string): { values: T; savedAt: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { values: T; savedAt: number };
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDraft<T>(key: string, values: T): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      storageKey(key),
      JSON.stringify({ savedAt: Date.now(), values }),
    );
  } catch {
    // sessionStorage may be unavailable (private mode, quota). Best-effort only.
  }
}

function clearDraft(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey(key));
  } catch {
    /* noop */
  }
}

function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const av = (a as Record<string, unknown>)[k];
    const bv = (b as Record<string, unknown>)[k];
    if (Object.is(av, bv)) continue;
    // Cheap deep-ish compare for plain object children (e.g. responses map).
    if (
      typeof av === "object" &&
      typeof bv === "object" &&
      av &&
      bv &&
      JSON.stringify(av) === JSON.stringify(bv)
    ) {
      continue;
    }
    return false;
  }
  return true;
}

export function usePersistedForm<T extends object>(
  key: string,
  initial: T,
): UsePersistedForm<T> {
  const initialRef = useRef(initial);
  const [values, setValuesState] = useState<T>(initial);

  // Inspect sessionStorage ONCE on mount — do not auto-apply.
  const [draftSnapshot] = useState(() => readDraft<T>(key));
  const [hasDraft, setHasDraft] = useState<boolean>(() => {
    if (!draftSnapshot) return false;
    return !shallowEqual(draftSnapshot.values, initial);
  });
  const [draftMeta, setDraftMeta] = useState<PersistedDraftMeta | null>(() =>
    draftSnapshot && !shallowEqual(draftSnapshot.values, initial)
      ? { savedAt: draftSnapshot.savedAt }
      : null,
  );

  const isDirty = useMemo(
    () => !shallowEqual(values, initialRef.current),
    [values],
  );

  // Debounced persist.
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    if (!isDirty) {
      // When the form returns to the initial state, drop the draft.
      clearDraft(key);
      return;
    }
    persistTimer.current = setTimeout(() => {
      writeDraft(key, values);
    }, 300);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [key, values, isDirty]);

  // beforeunload guard — only while dirty.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore the message, but a non-empty returnValue is
      // required to trigger the native confirmation prompt.
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const setValues = useCallback(
    (patch: Partial<T> | ((prev: T) => Partial<T>)) => {
      setValuesState((prev) => {
        const next = typeof patch === "function" ? patch(prev) : patch;
        return { ...prev, ...next };
      });
    },
    [],
  );

  const replace = useCallback((next: T) => {
    setValuesState(next);
  }, []);

  const reset = useCallback(() => {
    clearDraft(key);
    setValuesState(initialRef.current);
    setHasDraft(false);
    setDraftMeta(null);
  }, [key]);

  const resumeDraft = useCallback(() => {
    if (!draftSnapshot) return;
    setValuesState(draftSnapshot.values);
    setHasDraft(false);
  }, [draftSnapshot]);

  const discardDraft = useCallback(() => {
    clearDraft(key);
    setHasDraft(false);
    setDraftMeta(null);
  }, [key]);

  return {
    values,
    setValues,
    replace,
    reset,
    isDirty,
    hasDraft,
    draftMeta,
    resumeDraft,
    discardDraft,
  };
}
