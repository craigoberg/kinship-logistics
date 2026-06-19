import { useQuery } from "@tanstack/react-query";
import { listActiveMedicationExceptions, type MedicationExceptionRow } from "@/lib/data-store";

export function useMedicationExceptions() {
  return useQuery<MedicationExceptionRow[]>({
    queryKey: ["exceptions", "medication-handover"],
    queryFn: () => listActiveMedicationExceptions(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export interface PlaceholderRow {
  title: string;
  detail: string;
}

export const DAY_ANOMALY_PLACEHOLDERS: readonly PlaceholderRow[] = [
  {
    title: "Odometer mismatch",
    detail: "Logged by Driver Bill on HiAce Bus 2 — variance of 18 km",
  },
  {
    title: "Minor vehicle scrape reported",
    detail: "Reported on the Saturday Night Disco run",
  },
  {
    title: "Late return — bus parked after 22:30",
    detail: "End-of-day reconciliation pending coordinator review",
  },
] as const;

export const VEHICLE_COMPLIANCE_PLACEHOLDERS: readonly PlaceholderRow[] = [
  {
    title: "Rego renewal due",
    detail: "HiAce Bus 1 — expires in 8 days",
  },
  {
    title: "Scheduled maintenance overdue",
    detail: "HiAce Bus 3 — service window passed 6 days ago",
  },
  {
    title: "Tyre inspection due",
    detail: "Toyota Coaster — booked check not yet completed",
  },
] as const;

export const STAFF_CERT_PLACEHOLDERS: readonly PlaceholderRow[] = [
  {
    title: "WWCC expiring",
    detail: "Driver John Doe — renewal required within 14 days",
  },
  {
    title: "First Aid certificate expired",
    detail: "Carer Jane Smith — recertification overdue",
  },
  {
    title: "Driver licence medical due",
    detail: "Driver Bill — annual fitness review approaching",
  },
] as const;

export const ASSET_LIABILITY_PLACEHOLDERS: readonly PlaceholderRow[] = [
  {
    title: "Public Liability policy renewal",
    detail: "Annual cover expires in 21 days",
  },
  {
    title: "Volunteer accident insurance",
    detail: "Roster sync pending for 4 new volunteers",
  },
  {
    title: "Building lease review",
    detail: "Depot lease anniversary in 45 days",
  },
] as const;

