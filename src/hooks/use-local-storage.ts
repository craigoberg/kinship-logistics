import { useCallback, useEffect, useState } from "react";

// SSR-safe typed localStorage state hook. Reads lazily on mount to avoid
// hydration mismatches.
export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) setValue(JSON.parse(raw) as T);
    } catch {
      /* ignore */
    }
  }, [key]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        try {
          localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          /* ignore */
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, set] as const;
}
