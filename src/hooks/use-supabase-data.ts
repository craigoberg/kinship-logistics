import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listParticipants,
  listSyncLogs,
  listStaffRegistry,
  listSchedulesForParticipant,
  listAllActiveSchedules,
  listComplianceLogsForParticipant,
  listTodaysComplianceLogs,
  listAttendanceSchedules,
  listAttendanceLogs,
  insertAttendanceSchedule,
  updateAttendanceLog,
  insertAttendanceLog,
  listLookupParameters,
  listLedgerForParticipant,
  insertLedgerEntry,
  insertSchedule,
  updateParticipant,
  insertParticipant,
  insertSyncLog,
  type Participant,
  type ParticipantPatch,
  type NewParticipant,
  type NewSyncLog,
  type NewSchedule,
  type NewAttendanceSchedule,
  type NewAttendanceLog,
  type AttendanceLogPatch,
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


export function useInsertAttendanceLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewAttendanceLog) => insertAttendanceLog(input),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["attendance_logs", vars.participantId] });
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

export function useInsertAttendanceSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewAttendanceSchedule) => insertAttendanceSchedule(input),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["attendance_schedules", vars.participantId] });
    },
  });
}

export function useUpdateAttendanceLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: AttendanceLogPatch }) =>
      updateAttendanceLog(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance_logs"] });
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


export function useStaffRegistry() {
  return useQuery({
    queryKey: ["staff_registry"],
    queryFn: listStaffRegistry,
    staleTime: 60_000,
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
    },
  });
}

export function useInsertParticipant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewParticipant) => insertParticipant(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["participants"] });
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
    },
  });
}
