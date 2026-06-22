import { useQuery } from "@tanstack/react-query";
import {
  listSystemParameters,
  type JsonValue,
  type SystemParameterRow,
} from "@/lib/api/system-parameters";
import {
  listCheckpointsForAsset,
  type AssetCheckpoint,
} from "@/lib/data-store";

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

// ---------------------------------------------------------------------------
// Typed getters for site_management.* parameters used by the Day Centre.
// All keep semantic fallbacks so the UI never blocks on a missing row.
// ---------------------------------------------------------------------------

export type MandatedCheckScope =
  | { kind: "site_day" }
  | { kind: "pre_trip"; assetId: string; vehicleCategory: string | null };

/**
 * Returns the user-facing labels for the operator's mandated visual checks.
 *
 * Registry-driven (MASTER_GUARDRAILS §5.1):
 *   - `site_day` reads `system_parameters.site_management.mandated_compliance_checks`.
 *   - `pre_trip` reads `asset_checkpoints` for the chosen vehicle (and its
 *      `vehicle_category` + global 'all' fallback) so adding a new check is a
 *      pure DB change with no app redeploy.
 *
 * The default (no-arg) call preserves backwards-compat with the original
 * Start-of-Day hook signature.
 */
export function useMandatedChecks(scope?: MandatedCheckScope): string[] {
  const isPreTrip = scope?.kind === "pre_trip";
  const value = useSystemParameter<JsonValue>(
    "site_management.mandated_compliance_checks",
    [] as unknown as JsonValue,
  );
  const checkpointsQ = useQuery<AssetCheckpoint[]>({
    queryKey: [
      "asset-checkpoints",
      isPreTrip ? scope.assetId : "none",
      isPreTrip ? scope.vehicleCategory : "none",
    ],
    queryFn: () =>
      isPreTrip
        ? listCheckpointsForAsset(scope.assetId, scope.vehicleCategory)
        : Promise.resolve([] as AssetCheckpoint[]),
    enabled: isPreTrip,
    staleTime: 5 * 60_000,
  });

  if (isPreTrip) {
    return (checkpointsQ.data ?? []).map((c) => c.label);
  }
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}

export interface CouncilSlaHoursMap {
  Sev_1: number;
  Sev_2: number;
  Sev_3: number;
}

export function useCouncilSlaHours(): CouncilSlaHoursMap {
  const fallback: CouncilSlaHoursMap = { Sev_1: 4, Sev_2: 24, Sev_3: 72 };
  const value = useSystemParameter<JsonValue>(
    "site_management.council_sla_hours",
    fallback as unknown as JsonValue,
  );
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, JsonValue>;
    const num = (k: string, d: number) => {
      const n = typeof o[k] === "number" ? (o[k] as number) : Number(o[k]);
      return Number.isFinite(n) && n > 0 ? n : d;
    };
    return {
      Sev_1: num("Sev_1", fallback.Sev_1),
      Sev_2: num("Sev_2", fallback.Sev_2),
      Sev_3: num("Sev_3", fallback.Sev_3),
    };
  }
  return fallback;
}

export function useNoShowThresholdMinutes(): number {
  return useSystemParameter<number>(
    "site_management.no_show_threshold_minutes",
    60,
  );
}

export function useCouncilEmailTo(): string {
  return useSystemParameter<string>("site_management.council_email_to", "");
}

export function useCouncilEmailTemplate(): { subject: string; body: string } {
  const value = useSystemParameter<JsonValue>(
    "site_management.council_email_template",
    {
      subject: "Council Maintenance Request — {severity}",
      body:
        "Hello Council Maintenance,\n\n" +
        "We are logging a {severity} maintenance request from the Day Centre.\n\n" +
        "Issue: {description}\n" +
        "Current workaround: {workaround}\n" +
        "Expected resolution by (per contract SLA): {deadline}\n\n" +
        "Please confirm receipt and ETA.\n\nThank you,\nDay Centre Operations",
    } as unknown as JsonValue,
  );
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, JsonValue>;
    const subject = typeof o.subject === "string" ? o.subject : "";
    const body = typeof o.body === "string" ? o.body : "";
    return { subject, body };
  }
  if (typeof value === "string") {
    return { subject: "Council Maintenance Request", body: value };
  }
  return {
    subject: "Council Maintenance Request — {severity}",
    body:
      "Hello Council Maintenance,\n\nIssue: {description}\nWorkaround: {workaround}\nDeadline: {deadline}\n\nThank you.",
  };
}
