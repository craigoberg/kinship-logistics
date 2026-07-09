/**
 * EventArrivalRollPanel — event-floor arrival/departure roll (§12.4.2 / Phase 8)
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bus, Car, Check, Loader2, LogOut, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClientTime } from "@/components/ui/client-time";
import { cn } from "@/lib/utils";
import {
  checkoutEventParticipant,
  listEventAttendanceRoll,
  toggleEventCheckIn,
  type EventAttendanceRow,
  type ReturnTransport,
} from "@/lib/api/event-attendance";
import { EventTransportBadge } from "@/components/events/event-transport-badge";
import { listParticipants } from "@/lib/data-store";

const rollKey = (sessionId: string) => ["event-attendance-log", sessionId] as const;

interface Props {
  sessionId: string;
  /** When false, roll is read-only (location closed). */
  editable?: boolean;
}

export function EventArrivalRollPanel({ sessionId, editable = true }: Props) {
  const qc = useQueryClient();

  const { data: rows = [], isLoading, isFetching } = useQuery({
    queryKey: rollKey(sessionId),
    queryFn: () => listEventAttendanceRoll(sessionId),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

  const { data: participants = [] } = useQuery({
    queryKey: ["participants"],
    queryFn: listParticipants,
    staleTime: 60_000,
  });

  const nameMap = useMemo(() => {
    return Object.fromEntries(
      participants.map((p) => [
        p.id,
        `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "Participant",
      ]),
    );
  }, [participants]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: rollKey(sessionId) });
    qc.invalidateQueries({ predicate: (q) => q.queryKey?.[0] === "event-actual-transport" });
    qc.invalidateQueries({ predicate: (q) => q.queryKey?.[0] === "trip-report" });
  };

  const toggleMut = useMutation({
    mutationFn: (row: EventAttendanceRow) => toggleEventCheckIn(row),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const checkoutMut = useMutation({
    mutationFn: ({ row, transport }: { row: EventAttendanceRow; transport: ReturnTransport }) =>
      checkoutEventParticipant(row, transport),
    onSuccess: () => {
      toast.success("Departure handover recorded.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const checkedIn = rows.filter((r) => r.status === "checked_in").length;
  const checkedOut = rows.filter((r) => r.status === "checked_out").length;

  if (isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Check in each person <strong>as they arrive</strong> at the venue (bus or self). At end of
          program, use departure handover before closing the location.
        </p>
        {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="flex flex-wrap gap-3 text-xs font-medium">
        <span>{checkedIn}/{rows.length} checked in</span>
        <span className="text-muted-foreground">{checkedOut} handed to transport</span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
          <Users className="mx-auto mb-2 h-5 w-5" />
          No roster entries — open the location to seed the arrival roll.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <RollCard
              key={row.id}
              row={row}
              name={nameMap[row.participantId] ?? "Loading…"}
              editable={editable}
              busy={toggleMut.isPending || checkoutMut.isPending}
              onToggle={() => toggleMut.mutate(row)}
              onCheckout={(transport) => checkoutMut.mutate({ row, transport })}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function RollCard({
  row,
  name,
  editable,
  busy,
  onToggle,
  onCheckout,
}: {
  row: EventAttendanceRow;
  name: string;
  editable: boolean;
  busy: boolean;
  onToggle: () => void;
  onCheckout: (t: ReturnTransport) => void;
}) {
  const isIn = row.status === "checked_in";
  const isOut = row.status === "checked_out";

  return (
    <li
      className={cn(
        "rounded-lg border p-3",
        isIn && "border-emerald-500/40 bg-emerald-500/5",
        isOut && "border-muted bg-muted/20 opacity-80",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 font-medium text-sm">
          {name}
        </span>
        <MethodBadge method={row.arrivalMethod} />
        {isOut && row.returnTransport && (
          <EventTransportBadge mode={row.returnTransport} prefix="Ret" />
        )}
      </div>

      {row.checkedInAt && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          In <ClientTime value={row.checkedInAt} />
          {row.checkedOutAt && (
            <>
              {" · "}Out <ClientTime value={row.checkedOutAt} />
            </>
          )}
        </p>
      )}

      {editable && !isOut && (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {!isIn ? (
            <Button
              className="h-12 min-h-12 flex-1 touch-manipulation gap-1.5 text-base"
              disabled={busy}
              onClick={onToggle}
            >
              <Check className="h-4 w-4" />
              Check in
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                className="h-12 min-h-12 touch-manipulation gap-1.5"
                disabled={busy}
                onClick={onToggle}
              >
                Undo check-in
              </Button>
              <Button
                variant="secondary"
                className="h-12 min-h-12 flex-1 touch-manipulation gap-1.5"
                disabled={busy}
                onClick={() => onCheckout("bus")}
              >
                <Bus className="h-4 w-4" />
                Hand to bus
              </Button>
              <Button
                variant="secondary"
                className="h-12 min-h-12 flex-1 touch-manipulation gap-1.5"
                disabled={busy}
                onClick={() => onCheckout("self")}
              >
                <Car className="h-4 w-4" />
                Self transport
              </Button>
            </>
          )}
        </div>
      )}

      {isOut && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-emerald-700">
          <LogOut className="h-3 w-3" />
          Departure handover complete
        </p>
      )}
    </li>
  );
}

function MethodBadge({ method }: { method: string }) {
  if (method === "bus") {
    return (
      <EventTransportBadge mode="bus" prefix="In" className="gap-0.5" />
    );
  }
  if (method === "private") {
    return (
      <EventTransportBadge mode="self" prefix="In" className="gap-0.5" />
    );
  }
  return <Badge variant="outline" className="text-[10px]">{method}</Badge>;
}
