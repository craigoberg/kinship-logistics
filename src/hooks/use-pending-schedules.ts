import { useMemo } from "react";
import { useAllActiveSchedules, useTodaysComplianceLogs } from "@/hooks/use-supabase-data";
import type { MedicationSchedule } from "@/lib/data-store";

/**
 * Returns a Map of participant_id → the earliest-due pending medication
 * schedule for today (one whose expected_time has already passed with no
 * matching compliance log since). Map preserves `.has(id)` for badge gates
 * and `.get(id)` for click-to-administer flows.
 */
export function usePendingScheduleMap(): Map<string, MedicationSchedule> {
  const { data: schedules = [] } = useAllActiveSchedules();
  const { data: logs = [] } = useTodaysComplianceLogs();

  return useMemo(() => {
    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Group today's logs by participant.
    const logsByParticipant = new Map<string, typeof logs>();
    for (const log of logs) {
      if (!log.participantId) continue;
      const list = logsByParticipant.get(log.participantId) ?? [];
      list.push(log);
      logsByParticipant.set(log.participantId, list);
    }

    const pending = new Map<string, MedicationSchedule>();

    for (const s of schedules) {
      if (!s.participantId || !s.active) continue;
      const [h, m] = s.expectedTime.split(":").map(Number);
      const expected = new Date(todayStart);
      expected.setHours(h || 0, m || 0, 0, 0);
      if (expected > now) continue; // not due yet

      const participantLogs = logsByParticipant.get(s.participantId) ?? [];
      const medName = s.medicationName.trim().toLowerCase();
      const matched = participantLogs.some((log) => {
        const t = new Date(log.timestamp);
        if (t < expected) return false;
        const meta = log.metadata as Record<string, unknown>;
        const name = String(meta.medication_name ?? "").trim().toLowerCase();
        return name === medName;
      });

      if (matched) continue;

      // Keep the earliest-expected pending schedule for this participant.
      const existing = pending.get(s.participantId);
      if (!existing || s.expectedTime < existing.expectedTime) {
        pending.set(s.participantId, s);
      }
    }

    return pending;
  }, [schedules, logs]);
}
