import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ParticipantIndicators {
  days: string[]; // DAY-MON … DAY-FRI
  transport: boolean;
  meds: boolean;
}

function transportFlag(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const v = String(value).trim().toLowerCase();
  if (!v) return false;
  if (v === "none" || v === "transport-none" || v === "no" || v === "n/a") return false;
  return true;
}

export function useParticipantDirectoryIndicators() {
  return useQuery({
    queryKey: ["participant-directory-indicators"],
    queryFn: async (): Promise<Map<string, ParticipantIndicators>> => {
      const [schedRes, medRes] = await Promise.all([
        supabase
          .from("participant_attendance_schedules")
          .select("participant_id, day_of_week, transport_required, active")
          .eq("active", true),
        supabase
          .from("participant_medication_schedules")
          .select("participant_id, active")
          .eq("active", true),
      ]);
      if (schedRes.error) throw schedRes.error;
      if (medRes.error) throw medRes.error;

      const map = new Map<string, ParticipantIndicators>();
      const ensure = (id: string) => {
        let cur = map.get(id);
        if (!cur) {
          cur = { days: [], transport: false, meds: false };
          map.set(id, cur);
        }
        return cur;
      };

      for (const row of schedRes.data ?? []) {
        const id = row.participant_id as string;
        if (!id) continue;
        const entry = ensure(id);
        const dow = row.day_of_week as string | null;
        if (dow && !entry.days.includes(dow)) entry.days.push(dow);
        if (transportFlag(row.transport_required)) entry.transport = true;
      }
      for (const row of medRes.data ?? []) {
        const id = row.participant_id as string;
        if (!id) continue;
        ensure(id).meds = true;
      }
      return map;
    },
    staleTime: 60_000,
  });
}
