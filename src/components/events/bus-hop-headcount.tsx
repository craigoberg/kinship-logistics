/**
 * Who is moving with the group from this place to the next.
 * Bus, walk, other, and on-site use the same list. Not with the group stays on the trip.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bus, Footprints, Loader2, MapPin, TrainFront } from "lucide-react";
import { toast } from "sonner";
import { PersonKindBadge } from "@/components/people/person-kind-badge";
import { Button } from "@/components/ui/button";
import { FieldActionButton } from "@/components/ui/field-action-button";
import {
  listMovingParty,
  type HopHeadcountMark,
  type MovementMethod,
} from "@/lib/api/event-activity-roll";
import {
  confirmBusLeaveOfflineAware,
  confirmNonBusLeaveOfflineAware,
} from "@/lib/deliver-offline/outbox";
import {
  clearHopHeadcount,
  loadHopHeadcount,
  loadMovingPartyCache,
  saveHopHeadcount,
  saveMovingPartyCache,
  type HopMark,
} from "@/lib/deliver-offline/hop-headcount";
import { isAppOnline } from "@/lib/simulated-offline";
import { cn } from "@/lib/utils";

const MOVE_COPY: Record<
  MovementMethod,
  { title: string; withGroup: string; tap: string; not: string }
> = {
  bus: {
    title: "Who is moving",
    withGroup: "On the bus",
    tap: "Tap for on the bus",
    not: "Not travelling",
  },
  walk: {
    title: "Who is walking",
    withGroup: "Walking",
    tap: "Tap if walking with the group",
    not: "Not with the group",
  },
  other: {
    title: "Who is travelling",
    withGroup: "With the group",
    tap: "Tap if travelling with the group",
    not: "Not with the group",
  },
  on_site: {
    title: "Who is here",
    withGroup: "With the group",
    tap: "Tap if with the group",
    not: "Not with the group",
  },
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
  method?: MovementMethod;
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
  method = "bus",
  busy = false,
  onLeft,
}: Props) {
  const qc = useQueryClient();
  const copy = MOVE_COPY[method];

  const { data: named = [], isLoading: partyLoading } = useQuery({
    queryKey: ["moving-party", eventId, sessionId],
    queryFn: async () => {
      if (!isAppOnline()) return (await loadMovingPartyCache(sessionId)) ?? [];
      const people = await listMovingParty(eventId, sessionId);
      if (people.length > 0) await saveMovingPartyCache(sessionId, people);
      return people;
    },
    staleTime: 15_000,
    networkMode: "always",
  });
  const { data: marks = {}, isLoading: marksLoading } = useQuery({
    queryKey: headcountQueryKey(fromStopId, toStopId),
    queryFn: () => loadHopHeadcount(fromStopId, toStopId),
    staleTime: Infinity,
    networkMode: "always",
  });

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
      const leave = {
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
      };
      if (method === "bus") return confirmBusLeaveOfflineAware(leave);
      return confirmNonBusLeaveOfflineAware(leave);
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

  const loading = partyLoading || marksLoading;
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
        {copy.title}
      </p>
      {named.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No one is with the group on this tablet yet.
        </p>
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
                    ? `${person.name} is ${copy.withGroup.toLowerCase()}`
                    : staying
                      ? `${person.name} is ${copy.not.toLowerCase()}`
                      : `${copy.tap} — ${person.name}`
                }
              >
                <span className="flex flex-wrap items-center gap-1">
                  <span className="text-sm font-medium">{person.name}</span>
                  <PersonKindBadge kind={person.kind} surface={onBus ? "light" : "theme"} />
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug opacity-80">
                  {onBus
                    ? copy.withGroup
                    : staying
                      ? `${copy.not} — still on the trip`
                      : copy.tap}
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
                  {copy.not}
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
        ) : method === "walk" ? (
          <Footprints className="h-4 w-4" />
        ) : method === "other" ? (
          <TrainFront className="h-4 w-4" />
        ) : method === "on_site" ? (
          <MapPin className="h-4 w-4" />
        ) : (
          <Bus className="h-4 w-4" />
        )}
        Leave for {toLabel}
      </FieldActionButton>
    </div>
  );
}
