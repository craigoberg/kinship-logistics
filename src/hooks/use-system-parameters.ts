import { useQuery } from "@tanstack/react-query";
import {
  listSystemParameters,
  type JsonValue,
  type SystemParameterRow,
} from "@/lib/api/system-parameters";
import type { UrgencyParams } from "@/lib/governance/hub-workflow-status";
import { DEFAULT_COUNCIL_EMAIL_TEMPLATE } from "@/lib/governance/council-email";
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

/**
 * Close Centre mandated visual checks — separate Admin list from Open.
 * Key: `site_management.mandated_close_checks` (JSON string array).
 * Empty = high-trust close (no ticks required).
 */
export function useMandatedCloseChecks(): string[] {
  const value = useSystemParameter<JsonValue>(
    "site_management.mandated_close_checks",
    [] as unknown as JsonValue,
  );
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}

/**
 * Event Deliver Open location venue walkthrough checks (BL-070).
 * Key: `event_deliver.venue_open_checks` (JSON string array).
 * Empty = high-trust 1-tap open (no ticks required) until Admin fills the list.
 */
export function useVenueOpenChecks(): string[] {
  const value = useSystemParameter<JsonValue>(
    "event_deliver.venue_open_checks",
    [] as unknown as JsonValue,
  );
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}

/**
 * Meal prep walkthrough at Open meal (cooked/packed only) — BL-073.
 * Key: `meal.prep_checks` (JSON string array).
 * Empty = high-trust open (no ticks) until Admin fills / after Manager clears.
 */
export function useMealPrepChecks(): string[] {
  const value = useSystemParameter<JsonValue>(
    "meal.prep_checks",
    [] as unknown as JsonValue,
  );
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

/**
 * Dynamic Yellow lead-time defaults for the Compliance Governance engine.
 * Short-cycle assets (e.g. facility_drill, two_man_bus_walkaround) need a
 * tighter window than annual renewals like vehicle rego or staff certs.
 */
export function useComplianceWarningDays(): { default: number; shortCycle: number } {
  const def = useSystemParameter<number>("compliance_warning_days_default", 30);
  const shortCycle = useSystemParameter<number>(
    "compliance_warning_days_short_cycle",
    7,
  );
  return { default: def, shortCycle };
}

/**
 * Days before expiry that a compliance asset first appears on the Governance
 * Hub Active tab. Items with expiry further away than this (and RYGE = green)
 * stay hidden. Should be wider than the yellow warning threshold.
 * Default: 60 days. Configured via Admin → System Parameters.
 */
export function useComplianceHubVisibilityDays(): number {
  return useSystemParameter<number>("compliance_hub_visibility_days", 60);
}

/** Manifest soft-warn: |logged − GPS| ≥ km (BL-096). */
export function useOdoLegGpsWarnKm(): number {
  return useSystemParameter<number>("manifest.odo_leg_gps_warn_km", 3);
}

/** Manifest Close Run soft-warn: |end − (start+Σ)| ≥ km (BL-096). */
export function useOdoCloseSuggestWarnKm(): number {
  return useSystemParameter<number>("manifest.odo_close_suggest_warn_km", 5);
}

/** Manifest init soft-warn: |start − vehicle current| ≥ km (BL-096). */
export function useOdoStartVsLastWarnKm(): number {
  return useSystemParameter<number>("manifest.odo_start_vs_last_warn_km", 20);
}

/**
 * Days before a compliance asset deferral deadline expires that the item
 * moves from the Deferred tab back to the Active tab.
 * Default: 7 days. Configured via Admin → System Parameters.
 */
export function useComplianceDeferRewarnDays(): number {
  return useSystemParameter<number>("compliance_defer_rewarn_days", 7);
}

/**
 * Days before a deferred open issue deadline expires that it resurfaces on
 * the Active issues tab. Default: 7 days.
 * Configured via Admin → System Parameters.
 */
export function useIssueDeferRewarnDays(): number {
  return useSystemParameter<number>("issue_defer_rewarn_days", 7);
}

export function useCouncilEmailTo(): string {
  return useSystemParameter<string>("site_management.council_email_to", "");
}

/** Optional shared mailbox for Council mailto From (blank = operator account). */
export function useCouncilEmailFrom(): string {
  return useSystemParameter<string>("site_management.council_email_from", "");
}

/** Default bus depot street address (Admin → Day Centre Bus Runs). */
export function useDepotAddress(): string {
  return useSystemParameter<string>("depot_address", "");
}

/** Default Day Centre street address (Admin → Day Centre Bus Runs). */
export function useDayCentreAddress(): string {
  return useSystemParameter<string>("day_centre_address", "");
}

/** Default evening roll call for multi-day tours (Admin → System Parameters). */
export function useDefaultEveningRollCallTime(): string {
  return useSystemParameter<string>(
    "default_evening_roll_call_time",
    "21:00",
  );
}

/** Default morning roll call for multi-day tours (Admin → System Parameters). */
export function useDefaultMorningRollCallTime(): string {
  return useSystemParameter<string>(
    "default_morning_roll_call_time",
    "07:00",
  );
}

// ---------------------------------------------------------------------------
// Hub urgency param hooks (BL-021)
// ---------------------------------------------------------------------------

/**
 * Hours before a Human Issue defer deadline that it resurfaces on the Active
 * tab. Default: 1 hour. Replaces the old days-based rewarn for human issues.
 */
export function useIssueDeferRewarnMs(): number {
  const h = useSystemParameter<number>("issue_defer_rewarn_hours", 1);
  return h * 3_600_000;
}

/**
 * Urgency thresholds for the Human Issues tab.
 * All values are in milliseconds for direct comparison with Date.getTime().
 */
export function useIssueUrgencyParams(): UrgencyParams {
  const yellowH    = useSystemParameter<number>("issue_active_yellow_hours",    24);
  const redH       = useSystemParameter<number>("issue_active_red_hours",       48);
  const rewarnH    = useSystemParameter<number>("issue_defer_rewarn_hours",      1);
  const overdueH   = useSystemParameter<number>("issue_defer_overdue_red_hours", 1);
  return {
    activeYellowMs:   yellowH  * 3_600_000,
    activeRedMs:      redH     * 3_600_000,
    deferRewarnMs:    rewarnH  * 3_600_000,
    deferOverdueRedMs: overdueH * 3_600_000,
  };
}

/** Urgency thresholds for the Maintenance tab. */
export function useMaintenanceUrgencyParams(): UrgencyParams {
  const yellowD  = useSystemParameter<number>("maintenance_active_yellow_days",   7);
  const redD     = useSystemParameter<number>("maintenance_active_red_days",     14);
  const rewarnD  = useSystemParameter<number>("maintenance_defer_rewarn_days",    7);
  const overdueD = useSystemParameter<number>("maintenance_defer_overdue_red_days", 7);
  return {
    activeYellowMs:   yellowD  * 86_400_000,
    activeRedMs:      redD     * 86_400_000,
    deferRewarnMs:    rewarnD  * 86_400_000,
    deferOverdueRedMs: overdueD * 86_400_000,
  };
}

/**
 * Hours past expected_arrival_at before the No-Show dashboard tile turns red.
 * Yellow fires immediately when status = 'overdue'. Default: 2 hours.
 */
export function useAttendanceNoShowRedHours(): number {
  return useSystemParameter<number>("attendance_noshow_red_hours", 2);
}

/**
 * Minutes after roll call deadline before the Roll Call Breach tile turns red.
 * Yellow fires at the deadline. Default: 30 minutes.
 */
export function useRollCallGraceMinutes(): number {
  return useSystemParameter<number>("roll_call_grace_minutes", 30);
}

/** Urgency thresholds for the Compliance Assets tab. */
export function useComplianceUrgencyParams(): UrgencyParams {
  const yellowD  = useSystemParameter<number>("compliance_active_yellow_days",   7);
  const redD     = useSystemParameter<number>("compliance_active_red_days",     14);
  const rewarnD  = useSystemParameter<number>("compliance_defer_rewarn_days",    7); // existing key
  const overdueD = useSystemParameter<number>("compliance_defer_overdue_red_days", 7);
  return {
    activeYellowMs:   yellowD  * 86_400_000,
    activeRedMs:      redD     * 86_400_000,
    deferRewarnMs:    rewarnD  * 86_400_000,
    deferOverdueRedMs: overdueD * 86_400_000,
  };
}

export function useCouncilEmailTemplate(): { subject: string; body: string } {
  const value = useSystemParameter<JsonValue>(
    "site_management.council_email_template",
    DEFAULT_COUNCIL_EMAIL_TEMPLATE as unknown as JsonValue,
  );
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, JsonValue>;
    const subject = typeof o.subject === "string" ? o.subject : "";
    const body = typeof o.body === "string" ? o.body : "";
    return {
      subject: subject || DEFAULT_COUNCIL_EMAIL_TEMPLATE.subject,
      body: body || DEFAULT_COUNCIL_EMAIL_TEMPLATE.body,
    };
  }
  if (typeof value === "string") {
    return { subject: DEFAULT_COUNCIL_EMAIL_TEMPLATE.subject, body: value };
  }
  return { ...DEFAULT_COUNCIL_EMAIL_TEMPLATE };
}
