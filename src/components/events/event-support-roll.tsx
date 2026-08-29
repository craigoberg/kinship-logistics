/**
 * Event Deliver Support roll — staff / volunteer / carer.
 */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClientTime } from "@/components/ui/client-time";
import {
  EVENT_SUPPORT_ROLL_KEY,
  checkOutEventSupport,
  listEventSupportAttendance,
  markEventSupportAbsent,
  recordEventSupportArrival,
  seedEventSupportRoll,
} from "@/lib/api/event-support";
import { supportPersonKindLabel } from "@/lib/support-person";

interface Props {
  sessionId: string;
  eventId: string;
  mode?: "check_in" | "check_out";
}

export function EventSupportRoll({ sessionId, eventId, mode = "check_in" }: Props) {
  const qc = useQueryClient();
  const rollQ = useQuery({
    queryKey: EVENT_SUPPORT_ROLL_KEY(sessionId),
    queryFn: () => listEventSupportAttendance(sessionId),
    staleTime: 10_000,
  });

  useEffect(() => {
    void seedEventSupportRoll(sessionId, eventId)
      .then((n) => {
        if (n > 0) void qc.invalidateQueries({ queryKey: EVENT_SUPPORT_ROLL_KEY(sessionId) });
      })
      .catch(() => undefined);
  }, [sessionId, eventId, qc]);

  const rows = (rollQ.data ?? []).filter((r) => {
    if (mode === "check_in") return r.status !== "checked_out";
    return r.status === "checked_in" || r.status === "checked_out";
  });

  const arrive = useMutation({
    mutationFn: (row: { id: string; arrivalMethod: "bus" | "private" | "walk_in" | "other" | null }) =>
      recordEventSupportArrival({
        rowId: row.id,
        arrivalMethod: row.arrivalMethod === "bus" ? "bus" : "private",
        arrivalBusRunCode: null,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: EVENT_SUPPORT_ROLL_KEY(sessionId) }),
    onError: (err: Error) => toast.error(err.message),
  });
  const leave = useMutation({
    mutationFn: (rowId: string) => checkOutEventSupport({ rowId, returnTransport: "bus" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: EVENT_SUPPORT_ROLL_KEY(sessionId) }),
    onError: (err: Error) => toast.error(err.message),
  });
  const absent = useMutation({
    mutationFn: markEventSupportAbsent,
    onSuccess: () => void qc.invalidateQueries({ queryKey: EVENT_SUPPORT_ROLL_KEY(sessionId) }),
    onError: (err: Error) => toast.error(err.message),
  });

  if (rows.length === 0) return null;

  return (
    <section className="mt-6 space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Users className="h-4 w-4" />
        Support
      </h3>
      <div className="overflow-hidden rounded-lg border border-border">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex min-h-14 items-center gap-2 border-t border-border px-3 py-2 first:border-t-0"
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium">{row.displayName}</div>
              <div className="text-xs text-muted-foreground">
                {supportPersonKindLabel(row.personKind)}
                {row.checkedInAt && (
                  <>
                    {" · "}
                    <ClientTime iso={row.checkedInAt} />
                  </>
                )}
              </div>
            </div>
            <Badge variant="outline">{row.status.replace("_", " ")}</Badge>
            {mode === "check_in" && row.status === "expected" && (
              <>
                <Button size="sm" onClick={() => arrive.mutate(row)}>
                  Arrived
                </Button>
                <Button size="sm" variant="outline" onClick={() => absent.mutate(row.id)}>
                  Absent
                </Button>
              </>
            )}
            {row.status === "checked_in" && mode === "check_out" && (
              <Button size="sm" variant="secondary" onClick={() => leave.mutate(row.id)}>
                Left
              </Button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
