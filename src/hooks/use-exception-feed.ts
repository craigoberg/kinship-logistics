import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  listActiveMedicationExceptions,
  listAllActiveSchedules,
  listTodaysComplianceLogs,
  listParticipants,
  type MedicationExceptionRow,
  type MedicationSchedule,
  type ComplianceLog,
  type Participant,
} from "@/lib/data-store";

export type Severity = "critical" | "warning" | "info";

export type MedicationExceptionFeedRow = MedicationExceptionRow & { severity: Severity };

function severityForMedStatus(status: MedicationExceptionRow["status"]): Severity {
  if (status === "collected_damaged") return "critical";
  if (status === "expected_not_provided") return "warning";
  return "info";
}

export function useMedicationExceptions() {
  return useQuery<MedicationExceptionRow[], Error, MedicationExceptionFeedRow[]>({
    queryKey: ["exceptions", "medication-handover"],
    queryFn: () => listActiveMedicationExceptions(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    select: (rows) => rows.map((r) => ({ ...r, severity: severityForMedStatus(r.status) })),
  });
}

export interface PlaceholderRow {
  title: string;
  detail: string;
  severity: Severity;
}

export interface MedicationScheduleExceptionRow {
  key: string;
  title: string;
  detail: string;
  severity: Severity;
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}

function isAdministered(schedule: MedicationSchedule, logs: ComplianceLog[]): boolean {
  const target = schedule.medicationName.trim().toLowerCase();
  return logs.some((l) => {
    if (!l.participantId || l.participantId !== schedule.participantId) return false;
    const meta = (l.metadata ?? {}) as Record<string, unknown>;
    const name = String(meta.medication_name ?? "").trim().toLowerCase();
    return name === target;
  });
}

export function useMedicationScheduleExceptions() {
  const schedulesQ = useQuery({
    queryKey: ["all-active-schedules"],
    queryFn: () => listAllActiveSchedules(),
    staleTime: 30_000,
  });
  const logsQ = useQuery({
    queryKey: ["todays-compliance-logs"],
    queryFn: () => listTodaysComplianceLogs(),
    staleTime: 30_000,
  });
  const participantsQ = useQuery({
    queryKey: ["participants"],
    queryFn: () => listParticipants(),
    staleTime: 60_000,
  });

  const schedules: MedicationSchedule[] = schedulesQ.data ?? [];
  const logs: ComplianceLog[] = logsQ.data ?? [];
  const participants: Participant[] = participantsQ.data ?? [];

  const rows = useMemo<MedicationScheduleExceptionRow[]>(() => {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const byId = new Map(participants.map((p) => [p.id, p]));

    return schedules
      .filter((s) => !!s.participantId)
      .map((s) => {
        if (isAdministered(s, logs)) return null;
        const scheduledMinutes = timeToMinutes(s.expectedTime.slice(0, 5));
        const delta = scheduledMinutes - nowMinutes;
        let severity: Severity | null = null;
        let stateLabel = "";
        if (delta < 0) {
          severity = "critical";
          stateLabel = "OVERDUE";
        } else if (delta <= 60) {
          severity = "warning";
          stateLabel = "Due within 1 hour";
        }
        if (!severity) return null;
        const name = byId.get(s.participantId!)?.fullName ?? "Unassigned participant";
        const time = s.expectedTime.slice(0, 5);
        return {
          key: s.id,
          title: `${name} · ${s.medicationName}`,
          detail: `${stateLabel} · scheduled ${time}${s.dosage ? ` · ${s.dosage}` : ""}`,
          severity,
        } as MedicationScheduleExceptionRow;
      })
      .filter((r): r is MedicationScheduleExceptionRow => r !== null)
      .sort((a, b) => {
        const order = { critical: 0, warning: 1, info: 2 } as const;
        return order[a.severity] - order[b.severity];
      });
  }, [schedules, logs, participants]);

  return {
    data: rows,
    isLoading: schedulesQ.isLoading || logsQ.isLoading || participantsQ.isLoading,
  };
}

export const DAY_ANOMALY_PLACEHOLDERS: readonly PlaceholderRow[] = [
  {
    title: "Odometer mismatch",
    detail: "Logged by Driver Bill on HiAce Bus 2 — variance of 18 km",
    severity: "warning",
  },
  {
    title: "Minor vehicle scrape reported",
    detail: "Reported on the Saturday Night Disco run",
    severity: "warning",
  },
  {
    title: "Late return — bus parked after 22:30",
    detail: "End-of-day reconciliation pending coordinator review",
    severity: "info",
  },
] as const;

export const VEHICLE_COMPLIANCE_PLACEHOLDERS: readonly PlaceholderRow[] = [
  {
    title: "Rego renewal due",
    detail: "HiAce Bus 1 — expires in 8 days",
    severity: "warning",
  },
  {
    title: "Scheduled maintenance overdue",
    detail: "HiAce Bus 3 — service window passed 6 days ago",
    severity: "critical",
  },
  {
    title: "Tyre inspection due",
    detail: "Toyota Coaster — booked check not yet completed",
    severity: "info",
  },
] as const;

export const STAFF_CERT_PLACEHOLDERS: readonly PlaceholderRow[] = [
  {
    title: "WWCC expiring",
    detail: "Driver John Doe — renewal required within 14 days",
    severity: "warning",
  },
  {
    title: "First Aid certificate expired",
    detail: "Carer Jane Smith — recertification overdue",
    severity: "critical",
  },
  {
    title: "Driver licence medical due",
    detail: "Driver Bill — annual fitness review approaching",
    severity: "info",
  },
] as const;

export const ASSET_LIABILITY_PLACEHOLDERS: readonly PlaceholderRow[] = [
  {
    title: "Public Liability policy renewal",
    detail: "Annual cover expires in 21 days",
    severity: "warning",
  },
  {
    title: "Volunteer accident insurance",
    detail: "Roster sync pending for 4 new volunteers",
    severity: "info",
  },
  {
    title: "Building lease review",
    detail: "Depot lease anniversary in 45 days",
    severity: "info",
  },
] as const;
