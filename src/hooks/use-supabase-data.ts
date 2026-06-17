import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listParticipants,
  listSyncLogs,
  updateParticipant,
  insertParticipant,
  insertSyncLog,
  type Participant,
  type ParticipantPatch,
  type NewParticipant,
  type NewSyncLog,
} from "@/lib/data-store";

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
