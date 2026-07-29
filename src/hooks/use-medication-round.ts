/**
 * BL-077 — medication round board with injectable presence (centre or trip).
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  useAllActiveSchedules,
  useParticipants,
  useTodaysComplianceLogs,
} from "@/hooks/use-supabase-data";
import { useTodaysCheckedInIds } from "@/hooks/use-exception-feed";
import {
  getOperationalClockSnapshot,
  subscribeOperationalClock,
} from "@/lib/operational-clock";
import {
  buildMedicationRoundRows,
  operationalNowMinutes,
  summarizeMedicationRound,
  type MedicationRoundSummary,
} from "@/lib/medication/todays-medication-round";

/**
 * @param presenceIds — when provided, use this set instead of Day Centre checked-in.
 *                      Pass `undefined` to use Day Centre attendance.
 *                      Pass a Set (even empty) when trip presence is loaded.
 */
export function useMedicationRound(presenceIds?: Set<string> | null): MedicationRoundSummary & {
  isLoading: boolean;
  canCompleteRound: boolean;
  presenceCount: number;
} {
  const clockSnapshot = useSyncExternalStore(
    subscribeOperationalClock,
    getOperationalClockSnapshot,
    () => "ssr:live",
  );
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const schedulesQ = useAllActiveSchedules();
  const participantsQ = useParticipants();
  const logsQ = useTodaysComplianceLogs();
  const centreCheckedInQ = useTodaysCheckedInIds();

  const useCentre = presenceIds === undefined;
  const checkedInIds = useCentre ? centreCheckedInQ.data : presenceIds;

  const participantById = useMemo(
    () => new Map((participantsQ.data ?? []).map((p) => [p.id, p])),
    [participantsQ.data],
  );

  const isLoading =
    schedulesQ.isLoading ||
    logsQ.isLoading ||
    (useCentre
      ? centreCheckedInQ.isLoading || !centreCheckedInQ.data
      : presenceIds === null);

  const summary = useMemo((): MedicationRoundSummary => {
    void tick;
    void clockSnapshot;
    if (!checkedInIds) {
      return {
        rows: [],
        outstandingCount: 0,
        redCount: 0,
        amberCount: 0,
        urgency: "none",
        allManaged: false,
      };
    }
    const rows = buildMedicationRoundRows({
      schedules: schedulesQ.data ?? [],
      logs: logsQ.data ?? [],
      checkedInIds,
      participantById,
      nowMinutes: operationalNowMinutes(),
    });
    return { rows, ...summarizeMedicationRound(rows) };
  }, [
    schedulesQ.data,
    logsQ.data,
    checkedInIds,
    participantById,
    tick,
    clockSnapshot,
  ]);

  return {
    ...summary,
    isLoading,
    canCompleteRound: !isLoading && summary.allManaged,
    presenceCount: checkedInIds?.size ?? 0,
  };
}
