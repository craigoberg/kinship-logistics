import { useQuery } from "@tanstack/react-query";
import {
  listSystemParameters,
  type JsonValue,
  type SystemParameterRow,
} from "@/lib/api/system-parameters";

export const SYSTEM_PARAMETERS_QUERY_KEY = ["system-parameters"] as const;

export function useSystemParameters() {
  return useQuery<SystemParameterRow[]>({
    queryKey: SYSTEM_PARAMETERS_QUERY_KEY,
    queryFn: listSystemParameters,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Lookup a single parameter with a type-safe fallback. Falls back transparently
 * while the query is loading, missing, or shaped unexpectedly — callers can
 * treat this as a synchronous read of a tunable constant.
 */
export function useSystemParameter<T extends JsonValue>(
  key: string,
  fallback: T,
): T {
  const q = useSystemParameters();
  const row = q.data?.find((r) => r.key === key);
  if (!row) return fallback;
  // Coerce numeric fallbacks safely.
  if (typeof fallback === "number") {
    const n = typeof row.value === "number" ? row.value : Number(row.value);
    return (Number.isFinite(n) ? n : fallback) as T;
  }
  return (row.value as T) ?? fallback;
}
