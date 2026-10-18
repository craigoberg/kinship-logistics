/**
 * HopBoardingPanel — §11 boarding roll for event_venue_hop trips (§12.4.3).
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  hopBoardingComplete,
  hopBoardingCounts,
  seedBusManifestForHop,
} from "@/lib/api/event-hop-transport";
import {
  listBusManifest,
  type EventBusManifestRow,
} from "@/lib/api/event-day-ops";
import { CharacterCountedInput } from "@/components/ui/character-counted-input";
import { meetsMinLength } from "@/lib/ui/required-field";
import {
  appendLocalBoarder,
  isLocalHopTripId,
  isPaperHeadcountTrip,
  markNotTravellingOfflineAware,
  markOnBusOfflineAware,
  resolveBusManifestForUi,
} from "@/lib/manifest-offline";
import { isAppOnline } from "@/lib/simulated-offline";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { supabase } from "@/integrations/supabase/client";
import { useStaffRegistry } from "@/hooks/use-supabase-data";
import { PersonKindBadge } from "@/components/people/person-kind-badge";
import { manifestPersonKind } from "@/lib/ui/person-kind-chip";

const manifestKey = (tripId: string) => ["event-bus-manifest", tripId] as const;

interface Props {
  tripId: string;
  originLabel?: string;
  compact?: boolean;
}

export function HopBoardingPanel({ tripId, originLabel, compact }: Props) {
  const qc = useQueryClient();
  const [extraName, setExtraName] = useState("");
  const localHop = isLocalHopTripId(tripId);
  const paperRoll = isPaperHeadcountTrip(tripId);

  useRealtimeInvalidate({
    table: "event_bus_manifest",
    queryKeys: [manifestKey(tripId)],
  });

  const { data: manifest = [], isLoading } = useQuery({
    queryKey: manifestKey(tripId),
    queryFn: () =>
      resolveBusManifestForUi(tripId, () => listBusManifest(tripId)),
    staleTime: 5_000,
    networkMode: "offlineFirst",
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: manifestKey(tripId) });

  useEffect(() => {
    if (!tripId || isLocalHopTripId(tripId)) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("transport_trips")
        .select("event_id, event_day_session_id")
        .eq("id", tripId)
        .maybeSingle();
      if (cancelled || !data?.event_id || !data?.event_day_session_id) return;
      try {
        await seedBusManifestForHop({
          eventId: data.event_id as string,
          eventDaySessionId: data.event_day_session_id as string,
          tripId,
        });
        if (!cancelled) invalidate();
      } catch {
        /* seed is best-effort; boarding still shows existing rows */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  const toggleMut = useMutation({
    mutationFn: (row: EventBusManifestRow) => markOnBusOfflineAware(tripId, row),
    onSuccess: () => {
      invalidate();
      if (!isAppOnline()) {
        toast.info("Saved offline", {
          description: "Boarding will sync when you are back online.",
        });
      }
    },
    onError: (e: Error) => toast.error(e.message),
    networkMode: "always",
  });

  const notTravellingMut = useMutation({
    mutationFn: (row: EventBusManifestRow) =>
      markNotTravellingOfflineAware(tripId, row, "Not travelling this hop"),
    onSuccess: () => {
      invalidate();
      if (!isAppOnline()) {
        toast.info("Saved offline", {
          description: "Boarding will sync when you are back online.",
        });
      }
    },
    onError: (e: Error) => toast.error(e.message),
    networkMode: "always",
  });

  const { onBoard, total } = hopBoardingCounts(manifest);
  const complete = hopBoardingComplete(manifest);

  if (isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!manifest.length) {
    if (paperRoll) {
      return (
        <Card className="rounded-xl border-2 border-amber-500 bg-amber-500/10 p-4 text-sm">
          <p className="font-semibold">Paper roll is the headcount</p>
          <p className="mt-1 text-muted-foreground">
            Write who is on the bus on the paper sheet for this leg. File that sheet in the office trip file. You can depart.
          </p>
        </Card>
      );
    }
    return (
      <Card className="border-dashed p-4 text-center text-sm text-muted-foreground">
        No one on this hop yet — check in attendees on Event Deliver first.
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "rounded-xl border-2 p-4",
        complete ? "border-green-600 bg-green-600/10" : "border-amber-500 bg-amber-500/10",
      )}
    >
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-200">
        <Users className="h-3.5 w-3.5" />
        Board everyone{originLabel ? ` at ${originLabel}` : ""}
      </div>
      {!compact && (
        <p className="mt-1.5 text-sm text-muted-foreground">
          Tap each person when they are on the bus — participants, staff,
          volunteers and carers. Mark &quot;Not travelling&quot; if they stay
          behind (same as a participant).
        </p>
      )}
      <div className="mt-3 space-y-2">
        {manifest.map((row) => (
          <HopBoardingRow
            key={row.id}
            row={row}
            busy={toggleMut.isPending || notTravellingMut.isPending}
            onToggle={() => toggleMut.mutate(row)}
            onNotTravelling={() => notTravellingMut.mutate(row)}
          />
        ))}
      </div>
      <div className="mt-3 text-center text-sm font-semibold">
        {onBoard} / {total} on bus
        {complete ? " · ready to depart" : ""}
      </div>
      {localHop && (
        <div className="mt-4 space-y-2 border-t border-border pt-3">
          <CharacterCountedInput
            label="Someone not on this list"
            value={extraName}
            onValueChange={setExtraName}
            minChars={2}
            maxChars={80}
            required
            hint="The office confirms this name when the leg uploads."
          />
          <button
            type="button"
            disabled={!meetsMinLength(extraName, 2)}
            onClick={() => {
              void appendLocalBoarder(tripId, extraName)
                .then(() => {
                  setExtraName("");
                  invalidate();
                })
                .catch((err: Error) => toast.error(err.message));
            }}
            className="flex h-11 w-full items-center justify-center rounded-lg border border-border text-sm font-semibold disabled:opacity-50"
          >
            Add to this leg
          </button>
        </div>
      )}
    </Card>
  );
}

function HopBoardingRow({
  row,
  busy,
  onToggle,
  onNotTravelling,
}: {
  row: EventBusManifestRow;
  busy: boolean;
  onToggle: () => void;
  onNotTravelling: () => void;
}) {
  const { data: staff = [] } = useStaffRegistry();
  const staffRow = row.staff_id ? staff.find((s) => s.id === row.staff_id) : undefined;
  const kind = manifestPersonKind({
    participantId: row.participant_id,
    carerId: row.carer_id,
    staffId: row.staff_id,
    personnelType: staffRow?.personnelType,
    role: staffRow?.role,
  });
  const name =
    row.participant_name ??
    (row.carer_id ? "Carer" : row.staff_id ? "Staff" : "Passenger");
  const on = row.status === "on_bus";
  const absent = row.status === "not_travelling";

  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={busy || absent}
        onClick={onToggle}
        className={cn(
          "flex min-h-[48px] flex-1 touch-manipulation items-center justify-between rounded-xl border-2 px-4 py-2 text-left transition",
          absent && "opacity-50",
          on
            ? "border-green-500 bg-green-600/25 text-foreground"
            : "border-border bg-card",
        )}
      >
        <span className="font-semibold">
          {name}
          {kind ? <PersonKindBadge kind={kind} className="ml-2 align-middle" /> : null}
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
            on ? "bg-green-600 text-white" : absent ? "bg-muted text-muted-foreground" : "bg-muted",
          )}
        >
          {on ? "On bus" : absent ? "Not travelling" : "Expected"}
        </span>
      </button>
      {!on && !absent && (
        <button
          type="button"
          disabled={busy}
          onClick={onNotTravelling}
          className="shrink-0 rounded-lg border border-border px-2 text-[10px] font-semibold uppercase text-muted-foreground"
        >
          Skip
        </button>
      )}
    </div>
  );
}

export function useHopBoardingGate(tripId: string) {
  const { data: manifest = [] } = useQuery({
    queryKey: manifestKey(tripId),
    queryFn: () =>
      resolveBusManifestForUi(tripId, () => listBusManifest(tripId)),
    staleTime: 5_000,
    enabled: !!tripId,
    networkMode: "offlineFirst",
  });
  return hopBoardingComplete(manifest) || isPaperHeadcountTrip(tripId);
}
