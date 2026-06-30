import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";
import {
  listTransportRequests,
  upsertTransportRequest,
  cancelTransportRequest,
  type UpsertTransportRequestInput,
  type ListTransportRequestsArgs,
} from "@/lib/api/transport-requests";
import {
  insertFleetAsset,
  updateFleetAsset,
  type FleetAssetInput,
  type FleetAssetPatch,
} from "@/lib/api/fleet";
import { listTransportAssets } from "@/lib/data-store";

import {
  listParticipants,
  listSyncLogs,
  listStaffRegistry,
  insertStaffMember,
  updateStaffMember,
  listCarersRegistry,
  listCarersForParticipant,
  getPrimaryCarer,
  insertCarer,
  updateCarer,
  upsertPrimaryCarer,
  setPrimaryCarer,
  demoteCarer,
  linkCarerToParticipant,
  unlinkCarer,

  type StaffPayload,
  type CarerPayload,
  listSchedulesForParticipant,
  listAllActiveSchedules,
  listComplianceLogsForParticipant,
  listTodaysComplianceLogs,
  listAttendanceSchedules,
  listAttendanceLogs,
  insertAttendanceSchedule,
  updateAttendanceSchedule,
  archiveAttendanceSchedule,
  removeAttendanceSchedule,
  type RemoveScheduleInput,
  updateAttendanceLog,
  insertAttendanceLog,
  insertAttendanceLogsBulk,
  cancelChargesForDate,
  NON_CHARGEABLE_STATUSES,
  listLookupParameters,
  LOOKUP_CATEGORIES,
  listLedgerForParticipant,
  insertLedgerEntry,
  insertSchedule,
  updateMedicationSchedule,
  archiveMedicationSchedule,
  discontinueMedicationSchedule,
  insertDualWitnessAdministrationLog,
  type MedicationDiscontinuationInput,
  type DualWitnessAdministration,
  updateParticipant,
  insertParticipant,
  insertSyncLog,
  type Participant,
  type ParticipantPatch,
  type NewParticipant,
  type NewSyncLog,
  type NewSchedule,
  type NewAttendanceSchedule,
  type AttendanceSchedulePatch,
  type NewAttendanceLog,
  type AttendanceLogPatch,
  type MedicationSchedulePatch,
  type NewLedgerEntry,
} from "@/lib/data-store";

/**
 * Schema-driven dropdown source. Every operational selection list
 * (service types, transport options, financial codes, …) MUST come through
 * here — see `.lovable/plan.md` §6.
 *
 * Offline-safe: results are mirrored to localStorage so the dropdown can
 * still render its last-known options when the device drops connection.
 */
const LOOKUP_CACHE_PREFIX = "yc:lookup:";

function readLookupCache(category: string) {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(LOOKUP_CACHE_PREFIX + category);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeLookupCache(category: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LOOKUP_CACHE_PREFIX + category,
      JSON.stringify(value),
    );
  } catch {
    /* quota or private-mode — non-fatal */
  }
}

/** Purge every localStorage entry keyed with the lookup cache prefix. */
export function clearLookupCache() {
  if (typeof window === "undefined") return;
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(LOOKUP_CACHE_PREFIX)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    /* non-fatal */
  }
}

/** Purge a single category's localStorage entry. */
export function clearLookupCacheCategory(category: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LOOKUP_CACHE_PREFIX + category);
  } catch {
    /* non-fatal */
  }
}

export function useLookupParameters(category: string | null | undefined) {
  return useQuery({
    queryKey: ["system_lookup_parameters", category],
    queryFn: async () => {
      const rows = await listLookupParameters(category as string);
      writeLookupCache(category as string, rows);
      return rows;
    },
    enabled: !!category,
    staleTime: 5 * 60_000,
    placeholderData: category ? readLookupCache(category) : undefined,
    retry: 1,
  });
}

/** Palette applied to bus runs without a configured badge_color — same order as the admin workspace. */
const BUS_RUN_PALETTE = [
  "#7c3aed", // violet  — run 1
  "#d97706", // amber   — run 2
  "#0891b2", // cyan    — run 3
  "#e11d48", // rose    — run 4
  "#059669", // emerald — run 5
  "#7c2d12", // deep-orange — run 6
];

export interface BusRunBadge {
  label: string;
  color: string;
}

/**
 * Returns a stable Map<code, {label, color}> for all configured Day Centre
 * bus runs. Runs without a badge_color get a palette color based on
 * alphabetical position (same logic as the indicator hook and admin workspace).
 * Use this wherever run badges need to match the Participants Directory colours.
 */
export function useBusRunMap(): Map<string, BusRunBadge> {
  const { data: runs = [] } = useLookupParameters(LOOKUP_CATEGORIES.busRun);
  return useMemo(() => {
    const sorted = [...runs].sort((a, b) => a.code.localeCompare(b.code));
    const map = new Map<string, BusRunBadge>();
    sorted.forEach((r, idx) => {
      map.set(r.code, {
        label: r.displayName,
        color: r.badgeColor ?? BUS_RUN_PALETTE[idx % BUS_RUN_PALETTE.length],
      });
    });
    return map;
  }, [runs]);
}


export function useInsertAttendanceLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewAttendanceLog) => {
      const log = await insertAttendanceLog(input);
      if (NON_CHARGEABLE_STATUSES.includes(input.actualStatus)) {
        await cancelChargesForDate(input.participantId, input.rosterDate);
      }
      return log;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["attendance_logs", vars.participantId] });
      qc.invalidateQueries({ queryKey: ["attendance_logs"] });
      qc.invalidateQueries({ queryKey: ["participants"] });
      qc.invalidateQueries({ queryKey: ["participant_financial_ledger", vars.participantId] });
      qc.invalidateQueries({ queryKey: ["participant_financial_ledger"] });
    },
  });
}

export function useInsertAttendanceLogsBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inputs: NewAttendanceLog[]) => {
      const logs = await insertAttendanceLogsBulk(inputs);
      const sweepable = inputs.filter((i) =>
        NON_CHARGEABLE_STATUSES.includes(i.actualStatus),
      );
      await Promise.all(
        sweepable.map((i) => cancelChargesForDate(i.participantId, i.rosterDate)),
      );
      return logs;
    },
    onSuccess: (_, vars) => {
      const ids = new Set(vars.map((v) => v.participantId));
      ids.forEach((id) => {
        qc.invalidateQueries({ queryKey: ["attendance_logs", id] });
        qc.invalidateQueries({ queryKey: ["participant_financial_ledger", id] });
      });
      qc.invalidateQueries({ queryKey: ["attendance_logs"] });
      qc.invalidateQueries({ queryKey: ["participant_financial_ledger"] });
      qc.invalidateQueries({ queryKey: ["participants"] });
    },
    onError: (err: Error) => {
      console.error("[useInsertAttendanceLogsBulk] insert failed", err);
      toast.error("Could not log suspension range", {
        description: err.message ?? "Unknown error",
      });
    },
  });
}

export function useAttendanceSchedules(participantId: string | null | undefined) {
  return useQuery({
    queryKey: ["attendance_schedules", participantId],
    queryFn: () => listAttendanceSchedules(participantId as string),
    enabled: !!participantId,
    staleTime: 30_000,
  });
}

export function useAttendanceLogs(participantId: string | null | undefined) {
  return useQuery({
    queryKey: ["attendance_logs", participantId],
    queryFn: () => listAttendanceLogs(participantId as string),
    enabled: !!participantId,
    staleTime: 15_000,
  });
}

const DIRECTORY_INDICATORS_KEY = ["participant-directory-indicators", "v3-split-transport"] as const;

export function useInsertAttendanceSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewAttendanceSchedule) => insertAttendanceSchedule(input),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["attendance_schedules", vars.participantId] });
      qc.invalidateQueries({ queryKey: ["attendance_schedules"] });
      qc.invalidateQueries({ queryKey: ["attendance_logs"] });
      qc.invalidateQueries({ queryKey: DIRECTORY_INDICATORS_KEY });
    },
    onError: (err: Error) => {
      console.error("[useInsertAttendanceSchedule] insert failed", err);
      toast.error("Database rejected the schedule insert", {
        description: err.message ?? "Unknown error",
        duration: 10000,
        className:
          "border-2 border-destructive bg-destructive text-destructive-foreground",
      });
    },
  });
}

export function useUpdateAttendanceSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: AttendanceSchedulePatch }) =>
      updateAttendanceSchedule(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance_schedules"] });
      qc.invalidateQueries({ queryKey: ["attendance_logs"] });
      qc.invalidateQueries({ queryKey: DIRECTORY_INDICATORS_KEY });
    },
    onError: (err: Error) => {
      toast.error("Could not update schedule", { description: err.message });
    },
  });
}

export function useArchiveAttendanceSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => archiveAttendanceSchedule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance_schedules"] });
      qc.invalidateQueries({ queryKey: DIRECTORY_INDICATORS_KEY });
    },
    onError: (err: Error) => {
      toast.error("Could not archive schedule", { description: err.message });
    },
  });
}

export function useRemoveAttendanceSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RemoveScheduleInput) => removeAttendanceSchedule(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance_schedules"] });
      qc.invalidateQueries({ queryKey: DIRECTORY_INDICATORS_KEY });
    },
    onError: (err: Error) => {
      toast.error("Could not remove schedule", { description: err.message });
    },
  });
}

export function useUpdateAttendanceLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
      participantId,
      rosterDate,
    }: {
      id: string;
      patch: AttendanceLogPatch;
      participantId?: string;
      rosterDate?: string;
    }) => {
      const updated = await updateAttendanceLog(id, patch);
      if (
        patch.actualStatus &&
        NON_CHARGEABLE_STATUSES.includes(patch.actualStatus) &&
        participantId &&
        rosterDate
      ) {
        await cancelChargesForDate(participantId, rosterDate);
      }
      return updated;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance_logs"] });
      qc.invalidateQueries({ queryKey: ["participants"] });
      qc.invalidateQueries({ queryKey: ["participant_financial_ledger"] });
    },
  });
}


export function useParticipantSchedules(participantId: string | null | undefined) {
  return useQuery({
    queryKey: ["medication_schedules", participantId],
    queryFn: () => listSchedulesForParticipant(participantId as string),
    enabled: !!participantId,
    staleTime: 30_000,
  });
}

export function useAllActiveSchedules() {
  return useQuery({
    queryKey: ["medication_schedules", "all-active"],
    queryFn: listAllActiveSchedules,
    staleTime: 60_000,
  });
}

export function useParticipantComplianceLogs(participantId: string | null | undefined) {
  return useQuery({
    queryKey: ["compliance_audit_logs", participantId],
    queryFn: () => listComplianceLogsForParticipant(participantId as string),
    enabled: !!participantId,
    staleTime: 15_000,
  });
}

export function useTodaysComplianceLogs() {
  return useQuery({
    queryKey: ["compliance_audit_logs", "today"],
    queryFn: listTodaysComplianceLogs,
    staleTime: 30_000,
  });
}

export function useInsertSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewSchedule) => insertSchedule(input),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["medication_schedules", vars.participantId] });
      qc.invalidateQueries({ queryKey: ["medication_schedules", "all-active"] });
    },
  });
}

export function useUpdateMedicationSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: MedicationSchedulePatch }) =>
      updateMedicationSchedule(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["medication_schedules"] });
    },
    onError: (err: Error) => {
      toast.error("Could not update medication schedule", { description: err.message });
    },
  });
}

export function useArchiveMedicationSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => archiveMedicationSchedule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["medication_schedules"] });
    },
    onError: (err: Error) => {
      toast.error("Could not archive medication", { description: err.message });
    },
  });
}

export function useDiscontinueMedicationSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MedicationDiscontinuationInput) =>
      discontinueMedicationSchedule(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["medication_schedules"] });
      qc.invalidateQueries({ queryKey: ["participants"] });
    },
  });
}

export function useGiveDose() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DualWitnessAdministration) =>
      insertDualWitnessAdministrationLog(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compliance_audit_logs"] });
      qc.invalidateQueries({ queryKey: ["compliance_audit_logs", "today"] });
      qc.invalidateQueries({ queryKey: ["medication_schedules"] });
      qc.invalidateQueries({ queryKey: ["participants"] });
    },
  });
}



export function useStaffRegistry() {
  return useQuery({
    queryKey: ["staff_registry"],
    queryFn: listStaffRegistry,
    staleTime: 60_000,
  });
}

export function useInsertStaffMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: StaffPayload) => insertStaffMember(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff_registry"] });
    },
  });
}

export function useUpdateStaffMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: StaffPayload }) =>
      updateStaffMember(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff_registry"] });
    },
  });
}

export function useCarersRegistry() {
  return useQuery({
    queryKey: ["carers_registry"],
    queryFn: listCarersRegistry,
    staleTime: 30_000,
  });
}

export function useInsertCarer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CarerPayload) => insertCarer(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["carers_registry"] });
    },
  });
}

export function useUpdateCarer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CarerPayload }) =>
      updateCarer(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["carers_registry"] });
      qc.invalidateQueries({ queryKey: ["carers_for_participant"] });
      qc.invalidateQueries({ queryKey: ["primary_carer"] });
    },
  });
}

export function useCarersForParticipant(participantId: string | null | undefined) {
  return useQuery({
    queryKey: ["carers_for_participant", participantId],
    queryFn: () => listCarersForParticipant(participantId as string),
    enabled: !!participantId,
    staleTime: 30_000,
  });
}

export function usePrimaryCarer(participantId: string | null | undefined) {
  return useQuery({
    queryKey: ["primary_carer", participantId],
    queryFn: () => getPrimaryCarer(participantId as string),
    enabled: !!participantId,
    staleTime: 30_000,
  });
}

export function useUpsertPrimaryCarer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      participantId,
      payload,
    }: {
      participantId: string;
      payload: Omit<CarerPayload, "participantId" | "isPrimaryContact">;
    }) => upsertPrimaryCarer(participantId, payload),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["carers_registry"] });
      qc.invalidateQueries({ queryKey: ["carers_for_participant", vars.participantId] });
      qc.invalidateQueries({ queryKey: ["primary_carer", vars.participantId] });
      qc.invalidateQueries({ queryKey: ["participants"] });
    },
  });
}

function invalidateCarerCaches(qc: ReturnType<typeof useQueryClient>, participantId?: string) {
  qc.invalidateQueries({ queryKey: ["carers_registry"] });
  qc.invalidateQueries({ queryKey: ["carers_for_participant"] });
  qc.invalidateQueries({ queryKey: ["primary_carer"] });
  qc.invalidateQueries({ queryKey: ["participants"] });
  if (participantId) {
    qc.invalidateQueries({ queryKey: ["carers_for_participant", participantId] });
    qc.invalidateQueries({ queryKey: ["primary_carer", participantId] });
  }
}

export function useSetPrimaryCarer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ carerId, participantId }: { carerId: string; participantId: string }) =>
      setPrimaryCarer(carerId, participantId),
    onSuccess: (_d, vars) => invalidateCarerCaches(qc, vars.participantId),
  });
}

export function useDemoteCarer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ carerId }: { carerId: string; participantId?: string }) => demoteCarer(carerId),
    onSuccess: (_d, vars) => invalidateCarerCaches(qc, vars.participantId),
  });
}

export function useLinkCarerToParticipant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ carerId, participantId }: { carerId: string; participantId: string }) =>
      linkCarerToParticipant(carerId, participantId),
    onSuccess: (_d, vars) => invalidateCarerCaches(qc, vars.participantId),
  });
}

export function useUnlinkCarer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ carerId }: { carerId: string; participantId?: string }) => unlinkCarer(carerId),
    onSuccess: (_d, vars) => invalidateCarerCaches(qc, vars.participantId),
  });
}



export function useParticipants() {
  return useQuery({
    queryKey: ["participants"],
    queryFn: listParticipants,
    staleTime: 30_000,
  });
}

export function useSyncLogs() {
  return useQuery({
    queryKey: ["offline_sync_logs"],
    queryFn: listSyncLogs,
    staleTime: 10_000,
  });
}

export function useUpdateParticipant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ParticipantPatch }) =>
      updateParticipant(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["participants"] });
      invalidateTransportCaches(qc);
    },
  });
}

export function useInsertParticipant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewParticipant) => insertParticipant(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["participants"] });
      invalidateTransportCaches(qc);
    },
  });
}

export function useInsertSyncLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (log: NewSyncLog) => insertSyncLog(log),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["offline_sync_logs"] });
    },
  });
}

export type { Participant };

export function useParticipantLedger(participantId: string | null | undefined) {
  return useQuery({
    queryKey: ["participant_financial_ledger", participantId],
    queryFn: () => listLedgerForParticipant(participantId as string),
    enabled: !!participantId,
    staleTime: 15_000,
  });
}

export function useInsertLedgerEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewLedgerEntry) => insertLedgerEntry(input),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({
        queryKey: ["participant_financial_ledger", vars.participantId],
      });
      qc.invalidateQueries({ queryKey: ["participant_financial_ledger"] });
      qc.invalidateQueries({ queryKey: ["participants"] });
    },
  });
}


// ============================================================================
// EVENT MANAGEMENT HOOKS
// ============================================================================
import {
  listEvents,
  listConfirmedEvents,
  findMostRecentEventByType,
  listPriorEventsForClone,
  refreshBookingMedicalSnapshot,

  insertEvent,
  updateEvent,
  listEventBookings,
  listEventBookingsForParticipant,
  insertEventBooking,
  updateEventBooking,
  recordEventPaymentMilestone,
  listEventLedger,
  listEventPaymentLedger,
  listEventPaymentLedgerForEvent,
  insertEventLedger,
  type NewEvent,
  type UpdateEventInput,
  type NewEventBooking,
  type NewEventLedger,
  type PaymentMilestoneInput,
  type UpdateBookingInput,
} from "@/lib/data-store";
import { enqueue } from "@/lib/sync-queue";
import { useOnlineStatus } from "@/hooks/use-online-status";

export function usePriorEventOfType(
  eventTypeCode: string | null | undefined,
  excludeEventId?: string | null,
) {
  return useQuery({
    queryKey: ["events", "prior-by-type", eventTypeCode, excludeEventId ?? null],
    queryFn: () =>
      findMostRecentEventByType(eventTypeCode as string, excludeEventId ?? null),
    enabled: !!eventTypeCode,
    staleTime: 30_000,
  });
}

export function usePriorEventsForClone(excludeEventId?: string | null) {
  return useQuery({
    queryKey: ["events", "prior-clone-list", excludeEventId ?? null],
    queryFn: () => listPriorEventsForClone(excludeEventId ?? null),
    staleTime: 60_000,
  });
}

export function useRefreshBookingSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      bookingId,
      participantId,
    }: {
      bookingId: string;
      participantId: string;
      eventId?: string;
    }) => refreshBookingMedicalSnapshot(bookingId, participantId),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["event_roster_bookings"] });
      if (vars.eventId) {
        qc.invalidateQueries({ queryKey: ["event_roster_bookings", vars.eventId] });
      }
    },
    onError: (err: Error) => {
      toast.error("Could not refresh medical snapshot", { description: err.message });
    },
  });
}


export function useEvents() {
  return useQuery({
    queryKey: ["event_manifest"],
    queryFn: listEvents,
    staleTime: 30_000,
  });
}

export function useConfirmedEvents() {
  return useQuery({
    queryKey: ["events", "confirmed"],
    queryFn: listConfirmedEvents,
    staleTime: 30_000,
  });
}


export function useEventBookings(eventId: string | null | undefined) {
  return useQuery({
    queryKey: ["event_roster_bookings", eventId],
    queryFn: () => listEventBookings(eventId as string),
    enabled: !!eventId,
    staleTime: 15_000,
  });
}

export function useEventLedger(eventId: string | null | undefined) {
  return useQuery({
    queryKey: ["event_financial_ledger", eventId],
    queryFn: () => listEventLedger(eventId as string),
    enabled: !!eventId,
    staleTime: 15_000,
  });
}

/** Offline-safe envelope shoved into `offline_sync_logs` with action_type EVENT_SYNC. */
function packEventSync(kind: "event" | "booking" | "ledger", payload: unknown) {
  enqueue("transport_log", {
    action_type: "EVENT_SYNC",
    kind,
    payload,
    timestamp: new Date().toISOString(),
  } as Record<string, unknown>);
}

export function useInsertEvent() {
  const qc = useQueryClient();
  const online = useOnlineStatus();
  return useMutation({
    mutationFn: async (input: NewEvent) => {
      if (!online) {
        packEventSync("event", input);
        throw new Error("Offline — event queued to offline_sync_logs (EVENT_SYNC).");
      }
      return insertEvent(input);
    },
    onSuccess: async () => {
      // Hard cache bust — drop everything and force a fresh DB pull.
      qc.removeQueries({ queryKey: ["event_manifest"] });
      qc.removeQueries({ queryKey: ["events"] });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["event_manifest"] }),
        qc.invalidateQueries({ queryKey: ["events"] }),
        qc.refetchQueries({ queryKey: ["events"] }),
      ]);
    },
    onError: (err: Error) => {
      toast.error("Database rejected event", {
        description: err.message,
        duration: 12000,
        className: "border-red-500 bg-red-600 text-white font-medium",
      });
    },
  });
}

export function useUpdateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateEventInput) => updateEvent(input),
    onSuccess: async () => {
      qc.removeQueries({ queryKey: ["event_manifest"] });
      qc.removeQueries({ queryKey: ["events"] });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["event_manifest"] }),
        qc.invalidateQueries({ queryKey: ["events"] }),
        qc.refetchQueries({ queryKey: ["events"] }),
        qc.refetchQueries({ queryKey: ["event_manifest"] }),
      ]);
    },
    onError: (err: Error) => {
      toast.error("Could not update event", {
        description: err.message,
        duration: 12000,
        className: "border-red-500 bg-red-600 text-white font-medium",
      });
    },
  });
}

export function useInsertEventBooking() {
  const qc = useQueryClient();
  const online = useOnlineStatus();
  return useMutation({
    mutationFn: async (input: NewEventBooking) => {
      if (!online) {
        packEventSync("booking", input);
        throw new Error("Offline — booking queued to offline_sync_logs (EVENT_SYNC).");
      }
      return insertEventBooking(input);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["event_roster_bookings", vars.eventId] });
      qc.invalidateQueries({ queryKey: ["event_roster_bookings", "by-participant", vars.participantId] });
      qc.invalidateQueries({ queryKey: ["event_payment_ledger", "by-event", vars.eventId] });
      qc.invalidateQueries({ queryKey: ["event_payment_ledger", vars.participantId, vars.eventId] });
      qc.invalidateQueries({ queryKey: ["event_financial_ledger", vars.eventId] });
      qc.invalidateQueries({ queryKey: ["participant_financial_ledger", vars.participantId] });
      qc.invalidateQueries({ queryKey: ["participant_financial_ledger"] });
      qc.invalidateQueries({ queryKey: ["event_manifest"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["participants"] });
      invalidateTransportCaches(qc);
    },
    onError: (err: Error) => {
      toast.error("Could not add participant to roster", { description: err.message });
    },
  });
}

export function useInsertEventLedger() {
  const qc = useQueryClient();
  const online = useOnlineStatus();
  return useMutation({
    mutationFn: async (input: NewEventLedger) => {
      if (!online) {
        packEventSync("ledger", input);
        throw new Error("Offline — expense queued to offline_sync_logs (EVENT_SYNC).");
      }
      return insertEventLedger(input);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["event_financial_ledger", vars.eventId] });
    },
    onError: (err: Error) => {
      toast.error("Could not log event expense", { description: err.message });
    },
  });
}

export function useEventBookingsForParticipant(participantId: string | null | undefined) {
  return useQuery({
    queryKey: ["event_roster_bookings", "by-participant", participantId],
    queryFn: () => listEventBookingsForParticipant(participantId as string),
    enabled: !!participantId,
    staleTime: 15_000,
  });
}

export function useRecordEventPaymentMilestone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PaymentMilestoneInput) => recordEventPaymentMilestone(input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["event_roster_bookings", vars.eventId] });
      qc.invalidateQueries({ queryKey: ["event_roster_bookings", "by-participant", vars.participantId] });
      qc.invalidateQueries({ queryKey: ["event_financial_ledger", vars.eventId] });
      qc.invalidateQueries({ queryKey: ["event_payment_ledger", "by-event", vars.eventId] });
      qc.invalidateQueries({ queryKey: ["event_payment_ledger", vars.participantId, vars.eventId] });
      qc.invalidateQueries({ queryKey: ["participant_financial_ledger", vars.participantId] });
      qc.invalidateQueries({ queryKey: ["participant_financial_ledger"] });
      qc.invalidateQueries({ queryKey: ["event_manifest"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["participants"] });
    },
    onError: (err: Error) => {
      toast.error("Could not record payment milestone", {
        description: err.message,
        className: "border-red-500 bg-red-600 text-white font-medium",
      });
    },
  });
}

export function useEventPaymentLedger(
  participantId: string | null | undefined,
  eventId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["event_payment_ledger", participantId, eventId],
    queryFn: () => listEventPaymentLedger(participantId as string, eventId as string),
    enabled: !!participantId && !!eventId,
    staleTime: 15_000,
  });
}

export function useEventPaymentLedgerForEvent(eventId: string | null | undefined) {
  return useQuery({
    queryKey: ["event_payment_ledger", "by-event", eventId],
    queryFn: () => listEventPaymentLedgerForEvent(eventId as string),
    enabled: !!eventId,
    staleTime: 15_000,
  });
}

export function useUpdateEventBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateBookingInput) => updateEventBooking(input),
    onSuccess: ({ booking }, vars) => {
      qc.invalidateQueries({ queryKey: ["event_roster_bookings", booking.eventId] });
      qc.invalidateQueries({ queryKey: ["event_roster_bookings", "by-participant", booking.participantId] });
      qc.invalidateQueries({ queryKey: ["event_payment_ledger", "by-event", booking.eventId] });
      qc.invalidateQueries({ queryKey: ["event_payment_ledger", booking.participantId, booking.eventId] });
      qc.invalidateQueries({ queryKey: ["participant_financial_ledger", booking.participantId] });
      qc.invalidateQueries({ queryKey: ["participant_financial_ledger"] });
      qc.invalidateQueries({ queryKey: ["event_financial_ledger", booking.eventId] });
      qc.invalidateQueries({ queryKey: ["event_manifest"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["participants"] });
      invalidateTransportCaches(qc);
      void vars;
    },
    onError: (err: Error) => {
      toast.error("Database rejected booking update", {
        description: err.message,
        duration: 12000,
        className: "border-red-500 bg-red-600 text-white font-medium",
      });
    },
  });
}

// ---------- Driver Manifest hooks ----------
import {
  getActiveTripForDriver,
  startTrip as startTripFn,
  startDayCentreRun as startDayCentreRunFn,
  listTodaysBusRunSummaries,
  patchTripLeg as patchTripLegFn,
  completeTrip as completeTripFn,
  cancelTrip as cancelTripFn,
  getStaffId,
  getLastEndOdometer,
  listBusRunRosterForDay,
  reorderTripPickupLegs,
  type StartTripInput,
  type StartDayCentreRunInput,
  type BusRunSummary,
  type BusRunRosterEntry,
  type LegPatch,
} from "@/lib/data-store";
import { cancelTripPickupLeg } from "@/lib/api/transport-pickup";
import { invalidateIssueCaches, invalidateTransportCaches, invalidateFleetCaches, invalidateTransportRequestCaches } from "@/lib/query/invalidation";

const ACTIVE_TRIP_KEY = ["transport_trips", "active"] as const;

export function useActiveTrip() {
  const driverId = getStaffId();
  return useQuery({
    queryKey: [...ACTIVE_TRIP_KEY, driverId],
    queryFn: () => getActiveTripForDriver(driverId),
    staleTime: 5_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function useLastEndOdometer() {
  return useQuery({
    queryKey: ["transport_trips", "last_end_odometer"],
    queryFn: getLastEndOdometer,
    staleTime: 30_000,
  });
}

function showRedToast(title: string, err: Error) {
  toast.error(title, {
    description: err.message,
    duration: 12_000,
    className: "border-red-700 bg-red-600 text-white font-medium",
  });
}

export function useStartTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<StartTripInput, "driverStaffId">) =>
      startTripFn({ ...input, driverStaffId: getStaffId() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACTIVE_TRIP_KEY });
    },
    onError: (err: Error) => showRedToast("Could not start trip", err),
  });
}

export function useStartDayCentreRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<StartDayCentreRunInput, "driverStaffId">) =>
      startDayCentreRunFn({ ...input, driverStaffId: getStaffId() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACTIVE_TRIP_KEY });
    },
    onError: (err: Error) => showRedToast("Could not start Day Centre run", err),
  });
}

export function useTodaysBusRunSummaries(dayCode: string, runLabels: Record<string, string>) {
  return useQuery<BusRunSummary[]>({
    queryKey: ["today-bus-run-summaries", dayCode],
    queryFn: () => listTodaysBusRunSummaries(dayCode, runLabels),
    staleTime: 60_000,
    enabled: dayCode.length > 0,
  });
}

export function usePatchTripLeg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ legId, patch }: { legId: string; patch: LegPatch }) =>
      patchTripLegFn(legId, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACTIVE_TRIP_KEY });
    },
    onError: (err: Error) => showRedToast("Database rejected leg update", err),
  });
}

export function useCompleteTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tripId, endOdometerKm }: { tripId: string; endOdometerKm: number }) =>
      completeTripFn(tripId, endOdometerKm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACTIVE_TRIP_KEY });
    },
    onError: (err: Error) => showRedToast("Could not close shift", err),
  });
}

export function useCancelTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tripId }: { tripId: string }) => cancelTripFn(tripId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["active-trip"] });
      qc.invalidateQueries({ queryKey: ["trips"] });
      qc.invalidateQueries({ queryKey: ACTIVE_TRIP_KEY });
    },
    onError: (err: Error) => showRedToast("Could not cancel trip", err),
  });
}

export function useBusRunRoster(
  busRunCode: string,
  dayCode: string,
  direction: "morning" | "afternoon",
) {
  return useQuery<BusRunRosterEntry[]>({
    queryKey: ["bus-run-roster", busRunCode, dayCode, direction],
    queryFn: () => listBusRunRosterForDay(busRunCode, dayCode, direction),
    staleTime: 30_000,
    enabled: busRunCode.length > 0 && dayCode.length > 0,
  });
}

export function useReorderTripPickupLegs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      tripId,
      orderedLegIds,
    }: {
      tripId: string;
      orderedLegIds: string[];
    }) => reorderTripPickupLegs(tripId, orderedLegIds),
    onSuccess: () => {
      invalidateTransportCaches(qc);
    },
    onError: (err: Error) => showRedToast("Could not reorder pickups", err),
  });
}

export function useCancelTripPickup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: cancelTripPickupLeg,
    onSuccess: () => {
      invalidateTransportCaches(qc);
      invalidateIssueCaches(qc);
    },
    onError: (err: Error) => showRedToast("Could not cancel pickup", err),
  });
}

// ---------------------------------------------------------------------------
// Fleet register (transport_assets)
// ---------------------------------------------------------------------------

export function useTransportAssets() {
  return useQuery({
    queryKey: ["transport_assets"],
    queryFn: listTransportAssets,
    staleTime: 30_000,
  });
}

export function useInsertFleetAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FleetAssetInput) => insertFleetAsset(input),
    onSuccess: () => invalidateFleetCaches(qc),
  });
}

export function useUpdateFleetAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: FleetAssetPatch }) =>
      updateFleetAsset(id, patch),
    onSuccess: () => invalidateFleetCaches(qc),
  });
}

export function useTransportRequests(args: ListTransportRequestsArgs) {
  return useQuery({
    queryKey: ["transport-requests", args.requestDate ?? "all", args.includeCompleted ?? false],
    queryFn: () => listTransportRequests(args),
    staleTime: 15_000,
  });
}

export function useUpsertTransportRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertTransportRequestInput) => upsertTransportRequest(input),
    onSuccess: (row) => {
      invalidateTransportRequestCaches(qc, row.requestDate);
    },
  });
}

export function useCancelTransportRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, requestDate }: { id: string; requestDate: string }) =>
      cancelTransportRequest(id).then(() => requestDate),
    onSuccess: (requestDate) => invalidateTransportRequestCaches(qc, requestDate),
  });
}
