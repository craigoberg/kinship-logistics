/**
 * Leader bus hop — who is on this bus, on this tablet.
 * Not travelling stays on the trip. No Manifest and no kilometres.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PersonKindBadge } from "@/components/people/person-kind-badge";
import { Button } from "@/components/ui/button";
import { FieldActionButton } from "@/components/ui/field-action-button";
import { listEventAttendanceRoll } from "@/lib/api/event-attendance";
import { listEventSupportAttendance } from "@/lib/api/event-support";
import type { HopHeadcountMark } from "@/lib/api/event-activity-roll";
import {
  confirmBusLeaveOfflineAware,
  resolveEventAttendanceRoll,
  resolveEventSupportRoll,
} from "@/lib/deliver-offline/outbox";
import {
  clearHopHeadcount,
  loadHopHeadcount,
  saveHopHeadcount,
  type HopMark,
} from "@/lib/deliver-offline/hop-headcount";
import { cn } from "@/lib/utils";
import type { PersonKindChip } from "@/lib/ui/person-kind-chip";

type Person = {
  key: string;
  name: string;
  kind: PersonKindChip;
  participantId: string | null;
  staffId: string | null;
  carerId: string | null;
};

interface Props {
  eventId: string;
  sessionId: string;
  sessionDate: string;
  fromStopId: string;
  toStopId: string;
  fromLabel: string;
  toLabel: string;
  fromVenueName: string | null;
  toVenueName: string | null;
  busy?: boolean;
  onLeft: (openedStopId: string) => void;
}

function headcountQueryKey(fromStopId: string, toStopId: string) {
  return ["hop-headcount", fromStopId, toStopId] as const;
}

export function BusHopHeadcount({
  eventId,
  sessionId,
  sessionDate,
  fromStopId,
  toStopId,
  fromLabel,
  toLabel,
  fromVenueName,
  toVenueName,
  busy = false,
  onLeft,
}: Props) {
  const qc = useQueryClient();

  const { data: attendance = [], isLoading: attendanceLoading } = useQuery({
    queryKey: ["event-attendance-log", sessionId],
    queryFn: () =>
      resolveEventAttendanceRoll(sessionId, () => listEventAttendanceRoll(sessionId)),
    staleTime: 15_000,
    networkMode: "offlineFirst",
  });
  const { data: support = [], isLoading: supportLoading } = useQuery({
    queryKey: ["event-support-attendance", sessionId],
    queryFn: () =>
      resolveEventSupportRoll(sessionId, () => listEventSupportAttendance(sessionId)),
    staleTime: 15_000,
    networkMode: "offlineFirst",
  });
  const { data: marks = {}, isLoading: marksLoading } = useQuery({
    queryKey: headcountQueryKey(fromStopId, toStopId),
    queryFn: () => loadHopHeadcount(fromStopId, toStopId),
    staleTime: Infinity,
    networkMode: "always",
  });

  const people: Person[] = [
    ...attendance
      .filter((row) => row.status === "checked_in")
      .map((row) => ({
        key: `p:${row.participantId}`,
        name: "Participant",
        kind: "participant" as const,
        participantId: row.participantId,
        staffId: null,
        carerId: null,
      })),
    ...support
      .filter((row) => row.status === "checked_in")
      .map((row) => ({
        key: row.staffId ? `s:${row.staffId}` : `c:${row.carerId ?? row.id}`,
        name: row.displayName,
        kind: row.personKind,
        participantId: null,
        staffId: row.staffId,
        carerId: row.carerId,
      })),
  ];

  const { data: nameRows = [], isLoading: namesLoading } = useQuery({
    queryKey: ["participants", "bus-hop-names"],
    queryFn: async () => {
      const { listParticipants } = await import("@/lib/data-store");
      return listParticipants();
    },
    staleTime: 120_000,
  });
  const nameById = new Map(
    nameRows.map((person) => [
      person.id,
      `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() || person.fullName || "Participant",
    ]),
  );
  const named = people
    .map((person) =>
      person.participantId
        ? { ...person, name: nameById.get(person.participantId) ?? "Participant" }
        : person,
    )
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const unmarked = named.filter((person) => !marks[person.key]);

  const saveMut = useMutation({
    mutationFn: async (next: Record<string, HopMark>) => {
      await saveHopHeadcount({
        sessionId,
        fromStopId,
        toStopId,
        marks: next,
      });
      return next;
    },
    onSuccess: (next) => {
      qc.setQueryData(headcountQueryKey(fromStopId, toStopId), next);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const leaveMut = useMutation({
    mutationFn: async () => {
      const payload: HopHeadcountMark[] = named.map((person) => {
        const mark = marks[person.key];
        if (mark !== "on_bus" && mark !== "not_travelling") {
          throw new Error(`${person.name} is still to mark.`);
        }
        return {
          key: person.key,
          name: person.name,
          participantId: person.participantId,
          staffId: person.staffId,
          carerId: person.carerId,
          mark,
        };
      });
      return confirmBusLeaveOfflineAware({
        fromStop: {
          id: fromStopId,
          eventId,
          sessionDate,
          venueName: fromVenueName ?? fromLabel,
        },
        toStop: {
          id: toStopId,
          eventId,
          sessionDate,
          venueName: toVenueName ?? toLabel,
        },
        eventDaySessionId: sessionId,
        marks: payload,
      });
    },
    onSuccess: async (result) => {
      await clearHopHeadcount(fromStopId, toStopId);
      toast.success(`At ${toLabel}`);
      onLeft(result.openedStopId);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const setMark = (key: string, mark: HopMark | null) => {
    const next = { ...marks };
    if (mark) next[key] = mark;
    else delete next[key];
    saveMut.mutate(next);
  };

  const loading = attendanceLoading || supportLoading || marksLoading || namesLoading;
  const working = busy || saveMut.isPending || leaveMut.isPending;

  if (loading) {
    return (
      <div className="flex justify-center py-3">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Who is on the bus
      </p>
      {named.length === 0 ? (
        <p className="text-sm text-muted-foreground">No one is checked in yet.</p>
      ) : (
        named.map((person) => {
          const mark = marks[person.key];
          const onBus = mark === "on_bus";
          const staying = mark === "not_travelling";
          return (
            <div
              key={person.key}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-2 py-1.5",
                onBus &&
                  "border-2 border-success bg-success text-success-foreground shadow-md ring-2 ring-success/40",
                staying && "border-muted bg-muted/30",
              )}
            >
              <button
                type="button"
                disabled={working || !!mark}
                onClick={() => setMark(person.key, "on_bus")}
                className={cn(
                  "min-w-0 flex-1 rounded-md py-1 text-left min-h-11 touch-manipulation",
                  "disabled:opacity-100",
                )}
                aria-label={
                  onBus
                    ? `${person.name} is on the bus`
                    : staying
                      ? `${person.name} is not travelling`
                      : `Mark ${person.name} on the bus`
                }
              >
                <span className="flex flex-wrap items-center gap-1">
                  <span className="text-sm font-medium">{person.name}</span>
                  <PersonKindBadge kind={person.kind} surface={onBus ? "light" : "theme"} />
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug opacity-80">
                  {onBus
                    ? "On the bus"
                    : staying
                      ? "Not travelling — still on the trip"
                      : "Tap for on the bus"}
                </span>
              </button>
              {!mark ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-11 shrink-0"
                  disabled={working}
                  onClick={() => setMark(person.key, "not_travelling")}
                >
                  Not travelling
                </Button>
              ) : (
                <button
                  type="button"
                  disabled={working}
                  onClick={() => setMark(person.key, null)}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-slate-300 bg-white px-2 text-[10px] font-medium uppercase text-slate-700"
                  aria-label={`Undo bus mark for ${person.name}`}
                >
                  Undo
                </button>
              )}
            </div>
          );
        })
      )}
      {unmarked.length > 0 && (
        <p className="text-sm font-medium text-amber-200">
          {unmarked.length} still to mark
        </p>
      )}
      <FieldActionButton
        variant="success"
        disabled={working || named.length === 0 || unmarked.length > 0}
        onClick={() => leaveMut.mutate()}
      >
        {leaveMut.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Bus className="h-4 w-4" />
        )}
        Leave for {toLabel}
      </FieldActionButton>
    </div>
  );
}
