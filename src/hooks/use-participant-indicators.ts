import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TransportMethod = "bus" | "private" | "walk_in" | "other";

export interface DaySchedule {
  /** Mapped inbound transport method for the day. */
  inbound: TransportMethod;
  /** Mapped outbound transport method for the day. */
  outbound: TransportMethod;
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

function mapTransport(value: unknown): TransportMethod {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v || v === "none" || v === "transport-none" || v === "no" || v === "n/a") return "other";
  if (v.includes("bus") || v.includes("pickup")) return "bus";
  if (v.includes("private") || v.includes("self") || v.includes("family")) return "private";
  if (v.includes("walk")) return "walk_in";
  return "other";
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

export function useParticipantDirectoryIndicators() {
  return useQuery({
    queryKey: ["participant-directory-indicators", "v2-daily-grid"],
    queryFn: async (): Promise<Map<string, ParticipantIndicators>> => {
      const [schedRes, medRes] = await Promise.all([
        supabase
          .from("participant_attendance_schedules")
          .select("participant_id, day_of_week, transport_required, active")
          .eq("active", true),
        supabase
          .from("participant_medication_schedules")
          .select("participant_id, frequency, active")
          .eq("active", true),
      ]);
      if (schedRes.error) throw schedRes.error;
      if (medRes.error) throw medRes.error;

      const map = new Map<string, ParticipantIndicators>();
      const ensure = (id: string) => {
        let cur = map.get(id);
        if (!cur) {
          cur = {
            schedule: {},
            medDays: [],
            hasPrnOnly: false,
            hasSchedule: false,
            hasMeds: false,
          };
          map.set(id, cur);
        }
        return cur;
      };

      // 1) Attendance + transport per day
      for (const row of schedRes.data ?? []) {
        const id = row.participant_id as string | null;
        const dow = row.day_of_week as string | null;
        if (!id || !dow) continue;
        const entry = ensure(id);
        entry.hasSchedule = true;
        const method = mapTransport(row.transport_required);
        // Schema currently stores a single transport vector per schedule row;
        // mirror it to inbound + outbound until a separate field exists.
        entry.schedule[dow] = { inbound: method, outbound: method };
      }

      // 2) Medication: aggregate scheduled vs PRN flags, then map to attendance days.
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
        if (scheduledMedIds.has(id)) {
          // Scheduled meds are administered on attendance days at the centre.
          entry.medDays = Object.keys(entry.schedule);
        }
        entry.hasPrnOnly = prnMedIds.has(id) && !scheduledMedIds.has(id);
      }

      return map;
    },
    staleTime: 60_000,
  });
}
