import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listParticipants, listTransportLogs, updateParticipant, insertTransportLog, type Participant, type NewTransportLog } from "@/lib/data-store";

export function useParticipants() {
  return useQuery({
    queryKey: ["participants"],
    queryFn: listParticipants,
    staleTime: 30_000,
  });
}

export function useTransportLogs() {
  return useQuery({
    queryKey: ["transport_logs"],
    queryFn: listTransportLogs,
    staleTime: 10_000,
  });
}

export function useUpdateParticipant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Participant> }) =>
      updateParticipant(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["participants"] });
    },
  });
}

export function useInsertTransportLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (log: NewTransportLog) => insertTransportLog(log),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transport_logs"] });
    },
  });
}
