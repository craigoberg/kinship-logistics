/**
 * Driver override when the group has not been released.
 * Starts from the last downloaded expected list, or a paper roll if that list
 * is not on the tablet. Uploads into the one hop trip when signal returns.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  commitForcedHopStart,
  listExpectedPeopleForHop,
  type ExpectedHopPerson,
} from "@/lib/api/event-hop-transport";
import type { EventTransportRunCard } from "@/lib/api/event-hop-transport";
import { getStaffId } from "@/lib/data-store";
import { MANIFEST_JUST_STARTED_KEY } from "@/hooks/use-supabase-data";
import {
  beginForcedHopOffline,
  isNetworkError,
  loadExpectedHop,
  markPaperHeadcountTrip,
  refreshExpectedHop,
} from "@/lib/manifest-offline";
import type { CachedExpectedHop } from "@/lib/manifest-offline/expected-hops";
import { isAppOnline } from "@/lib/simulated-offline";

interface DutyGate {
  needsGap: boolean;
  approved: boolean;
  ensureApproved: () => Promise<boolean>;
}

interface Props {
  eventId: string;
  sessionId: string;
  sessionDate: string;
  card: EventTransportRunCard;
  startOdometerKm: number;
  assetId: string;
  dutyGate?: DutyGate;
  onStarted: () => void;
}

export function ForceUnreleasedHop({
  eventId,
  sessionId,
  sessionDate,
  card,
  startOdometerKm,
  assetId,
  dutyGate,
  onStarted,
}: Props) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"list" | "paper" | null>(null);
  const [paperBecauseOffline, setPaperBecauseOffline] = useState(false);
  const [people, setPeople] = useState<ExpectedHopPerson[]>([]);
  const [cached, setCached] = useState<CachedExpectedHop | null>(null);

  const hopIndex = card.hopIndex;
  const fromStopId = card.fromStopId;
  const toStopId = card.toStopId;

  const openConfirm = async () => {
    if (hopIndex == null || !fromStopId || !toStopId) {
      toast.error("This leg is missing its stops.");
      return;
    }
    if (dutyGate && !(await dutyGate.ensureApproved())) return;
    setBusy(true);
    try {
      const known = await loadExpectedHop({ eventId, sessionId, sessionDate, hopIndex });
      let next = known?.people ?? [];
      let couldNotConfirm = !isAppOnline();
      if (isAppOnline()) {
        try {
          if (known) {
            next = await refreshExpectedHop({ eventId, sessionId, sessionDate, hop: known });
          } else {
            next = await listExpectedPeopleForHop({
              eventId,
              eventDaySessionId: sessionId,
              fromStopId,
            });
          }
        } catch (err) {
          couldNotConfirm = true;
          if (!isNetworkError(err) && next.length === 0) throw err;
        }
      }
      setCached(known);
      setPeople(next);
      setPaperBecauseOffline(couldNotConfirm);
      setMode(next.length > 0 ? "list" : "paper");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read the expected list.");
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (hopIndex == null || !fromStopId || !toStopId) return;
    const paperRoll = mode === "paper";
    const fromLabel = card.originLabel ?? "Where the group is";
    const toLabel = cached?.toLabel ?? card.label.split("→").pop()?.trim() ?? "Destination";
    setBusy(true);
    try {
      const driverStaffId = getStaffId();
      const base = {
        eventId,
        eventDaySessionId: sessionId,
        sessionDate,
        hopIndex,
        fromStopId,
        toStopId,
        driverStaffId,
        startOdometerKm,
        assetId,
        paperRoll,
        people: paperRoll
          ? []
          : people.map((person) => ({
              ...person,
              status: "expected" as const,
              notes: null,
            })),
        leg: null,
      };

      let tripId: string | null = null;
      if (isAppOnline()) {
        try {
          const bundle = await commitForcedHopStart(base);
          tripId = bundle.trip.id;
        } catch (err) {
          if (!isNetworkError(err)) throw err;
        }
      }
      if (!tripId) {
        const bundle = await beginForcedHopOffline({
          eventId,
          sessionId,
          sessionDate,
          hopIndex,
          fromStopId,
          toStopId,
          fromLabel,
          toLabel,
          originAddress: card.originAddress ?? cached?.originAddress ?? null,
          toAddress: cached?.toAddress ?? null,
          driverStaffId,
          startOdometerKm,
          assetId,
          paperRoll,
          people: paperRoll ? [] : people,
        });
        tripId = bundle.trip.id;
        toast.info("Leg saved on this tablet", {
          description: "It will upload when this tablet has signal.",
        });
      } else {
        toast.success("Hop manifest open", {
          description: "Started before the group was released. The office can see that.",
        });
      }
      if (paperRoll) markPaperHeadcountTrip(tripId);
      sessionStorage.setItem(MANIFEST_JUST_STARTED_KEY, tripId);
      setMode(null);
      await qc.invalidateQueries({ queryKey: ["transport_trips", "active"] });
      onStarted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start this leg.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={busy || !!(dutyGate?.needsGap && !dutyGate.approved)}
        onClick={() => void openConfirm()}
        className="mt-3 flex h-12 w-full items-center justify-center rounded-lg bg-amber-600 text-sm font-bold text-white disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start this leg anyway"}
      </button>

      <AlertDialog open={mode != null} onOpenChange={(open) => !open && setMode(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {mode === "paper"
                ? paperBecauseOffline
                  ? "System offline"
                  : "No expected people on this tablet"
                : "Group has not been released"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {mode === "paper"
                ? "Write who is on the bus on the paper roll for this leg and start? That sheet is filed in the office against this trip and this leg."
                : `Start from the last known list of ${people.length} ${people.length === 1 ? "person" : "people"}? Mark each person on the bus or not travelling. This uploads when the tablet has signal, and it stays the one leg for this hop.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(event) => {
              event.preventDefault();
              void start();
            }}>
              {busy ? "Starting…" : "Start leg"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
