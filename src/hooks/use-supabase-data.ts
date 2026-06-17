import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listParticipants,
  listSyncLogs,
  listStaffRegistry,
  listSchedulesForParticipant,
  listAllActiveSchedules,
  listComplianceLogsForParticipant,
  listTodaysComplianceLogs,
  insertSchedule,
  updateParticipant,
  insertParticipant,
  insertSyncLog,
  type Participant,
  type ParticipantPatch,
  type NewParticipant,
  type NewSyncLog,
  type NewSchedule,
} from "@/lib/data-store";

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
