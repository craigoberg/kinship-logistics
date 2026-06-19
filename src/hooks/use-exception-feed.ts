import { useQuery } from "@tanstack/react-query";
import { listActiveMedicationExceptions, type MedicationExceptionRow } from "@/lib/data-store";

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
