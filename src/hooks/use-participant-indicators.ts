import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TransportMethod = "run" | "bus" | "private" | "walk_in" | "other";

export interface DaySchedule {
  /** Broad transport category for colouring. */
  inbound: TransportMethod;
  outbound: TransportMethod;
  /** Human-readable label: run display name (e.g. "R1"), "Bus", "Self", "Walk", or "—". */
  inboundLabel: string;
  outboundLabel: string;
  /** Raw DB code — used for transport-filter matching (e.g. "R1", "TRN-BUS"). */
  inboundCode: string;
  outboundCode: string;
  /** Hex badge color — always set for named runs (palette fallback), null for generic types. */
  inboundColor: string | null;
  outboundColor: string | null;
}

export interface ParticipantIndicators {
  /** Map of DAY-MON … DAY-SUN → per-day transport vectors (only present days). */
  schedule: Record<string, DaySchedule>;
  /** List of DAY-XXX codes (subset of schedule keys) when scheduled meds are due. */
  medDays: string[];
  /** True if the participant has any active PRN/as-needed med record. */
  hasPrnOnly: boolean;
  /** Derived convenience — any active attendance day. */
  hasSchedule: boolean;
  /** Derived convenience — any active medication schedule. */
  hasMeds: boolean;
}

function isPrn(frequency: unknown): boolean {
  const v = String(frequency ?? "").toLowerCase();
  return v.includes("prn") || v.includes("as needed") || v.includes("as-needed");
}

export const EMPTY_INDICATORS: ParticipantIndicators = {
  schedule: {},
  medDays: [],
  hasPrnOnly: false,
  hasSchedule: false,
  hasMeds: false,
};

/** Default palette cycled for named bus runs that have no configured color. */
export const BUS_RUN_PALETTE = [
  "#7c3aed", // violet  — run 1
  "#d97706", // amber   — run 2
  "#0891b2", // cyan    — run 3
  "#e11d48", // rose    — run 4
  "#059669", // emerald — run 5
  "#7c2d12", // deep-orange — run 6
];

/**
 * Classify a raw transport code into a broad category, display label and badge color.
 * runCodes: Set of codes that belong to the bus_runs lookup category.
 * runLabels: map of code → displayName for those runs.
 * runColors: map of code → badgeColor (hex string or null).
 */
function resolveTransport(
  raw: string | null | undefined,
  runCodes: Set<string>,
  runLabels: Map<string, string>,
  runColors: Map<string, string>,
): { method: TransportMethod; label: string; color: string | null } {
  const code = (raw ?? "").trim();
  const v = code.toLowerCase();

  if (!v || v === "none" || v === "transport-none" || v === "no" || v === "n/a") {
    return { method: "other", label: "—", color: null };
  }

  // Named bus run (any code in the bus_runs lookup, regardless of naming convention).
  if (runCodes.has(code)) {
    const label = runLabels.get(code) ?? code;
    const color = runColors.get(code) ?? null;
    return { method: "run", label, color };
  }

  // Generic bus/pickup fallback (e.g. legacy "TRN-BUS", "bus", "pickup").
  if (v.includes("bus") || v.includes("pickup")) {
    return { method: "bus", label: "Bus", color: null };
  }
  if (v.includes("private") || v.includes("self") || v.includes("family")) {
    return { method: "private", label: "Self", color: null };
  }
  if (v.includes("walk")) {
    return { method: "walk_in", label: "Walk", color: null };
  }
  return { method: "other", label: "—", color: null };
}

export function useParticipantDirectoryIndicators() {
  return useQuery({
    queryKey: ["participant-directory-indicators", "v3-split-transport"],
    queryFn: async (): Promise<Map<string, ParticipantIndicators>> => {
      const [schedRes, medRes, runRes] = await Promise.all([
        supabase
          .from("participant_attendance_schedules")
          .select(
            "participant_id, day_of_week, transport_required, inbound_transport, outbound_transport, active",
          )
          .eq("active", true),
        supabase
          .from("participant_medication_schedules")
          .select("participant_id, frequency, active")
          .eq("active", true),
        supabase
          .from("system_lookup_parameters")
          .select("code, display_name, badge_color")
          .eq("category", "bus_runs"),
      ]);
      if (schedRes.error) throw schedRes.error;
      if (medRes.error) throw medRes.error;
      // runRes errors are non-fatal — degrade gracefully if table is empty.

      // Build run lookup sets from system_lookup_parameters.
      // Runs are sorted alphabetically so palette assignment is stable across
      // sessions (R1 → palette[0], R2 → palette[1], …) even before the
      // badge_color migration has been applied.
      const runCodes = new Set<string>();
      const runLabels = new Map<string, string>();
      const runColors = new Map<string, string>();
      const sortedRuns = [...(runRes.data ?? [])].sort((a, b) =>
        ((a as { code: string }).code).localeCompare((b as { code: string }).code),
      );
      sortedRuns.forEach((r, idx) => {
        const row = r as { code: string; display_name: string; badge_color?: string | null };
        runCodes.add(row.code);
        runLabels.set(row.code, row.display_name);
        // Use the configured color if available, otherwise fall back to palette.
        runColors.set(row.code, row.badge_color ?? BUS_RUN_PALETTE[idx % BUS_RUN_PALETTE.length]);
      });

      const map = new Map<string, ParticipantIndicators>();
      const ensure = (id: string) => {
        let cur = map.get(id);
        if (!cur) {
          cur = { schedule: {}, medDays: [], hasPrnOnly: false, hasSchedule: false, hasMeds: false };
          map.set(id, cur);
        }
        return cur;
      };

      // 1) Attendance + transport per day.
      for (const row of schedRes.data ?? []) {
        const id = row.participant_id as string | null;
        const dow = row.day_of_week as string | null;
        if (!id || !dow) continue;

        const entry = ensure(id);
        entry.hasSchedule = true;

        const legacy = row.transport_required as string | null;
        const rawIn = (row.inbound_transport as string | null) ?? legacy;
        const rawOut = (row.outbound_transport as string | null) ?? legacy;

        const inRes = resolveTransport(rawIn, runCodes, runLabels, runColors);
        const outRes = resolveTransport(rawOut, runCodes, runLabels, runColors);

        // Last schedule for a given day wins (coordinator can create a replacement
        // before removing the old one — the new row is created later so sorts last).
        entry.schedule[dow] = {
          inbound: inRes.method,
          outbound: outRes.method,
          inboundLabel: inRes.label,
          outboundLabel: outRes.label,
          inboundCode: rawIn ?? "",
          outboundCode: rawOut ?? "",
          inboundColor: inRes.color,
          outboundColor: outRes.color,
        };
      }

      // 2) Medication flags.
      const scheduledMedIds = new Set<string>();
      const prnMedIds = new Set<string>();
      for (const row of medRes.data ?? []) {
        const id = row.participant_id as string | null;
        if (!id) continue;
        ensure(id).hasMeds = true;
        if (isPrn(row.frequency)) prnMedIds.add(id);
        else scheduledMedIds.add(id);
      }
      for (const [id, entry] of map.entries()) {
        if (scheduledMedIds.has(id)) entry.medDays = Object.keys(entry.schedule);
        entry.hasPrnOnly = prnMedIds.has(id) && !scheduledMedIds.has(id);
      }

      return map;
    },
    staleTime: 60_000,
  });
}
