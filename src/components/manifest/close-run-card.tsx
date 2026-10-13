/**
 * CloseRunCard — end-of-manifest reconciliation + operator PIN (§11).
 * Ending odometer is the dash reading. Kilometres travelled = end − start.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { NumericEntryTrigger } from "@/components/ui/numeric-entry-dialog";
import { PinEntryDialog } from "@/components/auth/pin-entry-dialog";
import { verifyNamedStaffPin } from "@/components/auth/pin-verify";
import { cn } from "@/lib/utils";
import {
  DEFAULT_STAFF_UUID,
  getActiveUserProfile,
  getStaffId,
  type TransportTrip,
  type TripLeg,
} from "@/lib/data-store";
import {
  buildRunCloseSummary,
  closeTransportRun,
  countIssuesLoggedDuringRun,
  listOpenTransportRedBlocks,
} from "@/lib/api/transport-run-close";
import { invalidateTransportCaches, invalidateFleetCaches } from "@/lib/query/invalidation";
import { tripDistanceKm } from "@/lib/manifest-odometer";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import { FieldActionButton } from "@/components/ui/field-action-button";
import { useManifestOffline } from "@/hooks/use-manifest-offline";
import { clearSnapshotForTrip } from "@/lib/manifest-offline";

interface Props {
  trip: TransportTrip;
  legs: TripLeg[];
  eventTitle?: string | null;
}

export function CloseRunCard({ trip, legs, eventTitle }: Props) {
  const qc = useQueryClient();
  const {
    online,
    hasPending,
    pendingCount,
    flushing,
    flush,
  } = useManifestOffline(trip.id);
  const summary = useMemo(() => buildRunCloseSummary(trip, legs), [trip, legs]);

  const [odo, setOdo] = useState("");
  const [cancellationsAck, setCancellationsAck] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);

  const redQ = useQuery({
    queryKey: ["transport-run-red-blocks", trip.id],
    queryFn: () => listOpenTransportRedBlocks(trip),
    staleTime: 10_000,
  });

  const issuesQ = useQuery({
    queryKey: ["transport-run-issue-count", trip.id],
    queryFn: () => countIssuesLoggedDuringRun(trip),
    staleTime: 10_000,
  });

  const redBlocks = redQ.data ?? [];
  const issuesLogged = issuesQ.data ?? 0;
  const hasCancellations = summary.cancelledPickups.length > 0;
  const odoNum = odo === "" ? NaN : Number(odo);
  const validOdo = Number.isFinite(odoNum) && odoNum >= trip.startOdometerKm;
  const travelledKm = validOdo ? tripDistanceKm(trip.startOdometerKm, odoNum) : null;
  const outboxBlocksClose = !online || hasPending || flushing;
  const canClose =
    validOdo &&
    redBlocks.length === 0 &&
    (!hasCancellations || cancellationsAck) &&
    !redQ.isLoading &&
    !outboxBlocksClose;

  const closeMut = useMutation({
    mutationFn: (operatorPin: string) =>
      closeTransportRun({
        tripId: trip.id,
        endOdometerKm: Number(odo),
        operatorPin,
        cancellationsAcknowledged: hasCancellations ? cancellationsAck : true,
      }),
    onSuccess: async () => {
      await clearSnapshotForTrip(trip.id);
      invalidateTransportCaches(qc);
      invalidateFleetCaches(qc);
      toast.success("Run closed", {
        description: "Manifest reconciled and locked to the ledger.",
      });
      setCancellationsAck(false);
    },
    onError: (e: Error) => {
      toast.error("Could not close run", { description: e.message });
    },
  });

  const runLabel = eventTitle?.trim() || trip.busRunCode || "Transport run";

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <div>
          <p className="text-sm font-bold">Close run & reconcile manifest</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{runLabel}</p>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">{summary.attestationLine}</p>

      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <li>
          <span className="text-muted-foreground">Legs complete</span>{" "}
          <span className="font-semibold">
            {summary.completedLegs}/{summary.totalLegs}
          </span>
        </li>
        <li>
          <span className="text-muted-foreground">Start odometer</span>{" "}
          <span className="font-semibold tabular-nums">{trip.startOdometerKm}</span>
        </li>
        <li className="col-span-2">
          <span className="text-muted-foreground">Issues logged this run</span>{" "}
          <span className="font-semibold">
            {issuesQ.isLoading ? "…" : issuesLogged > 0 ? issuesLogged : "None"}
          </span>
        </li>
      </ul>

      {hasCancellations && (
        <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-200">
            <AlertTriangle className="h-3.5 w-3.5" />
            {summary.cancelledPickups.length} cancelled pickup
            {summary.cancelledPickups.length === 1 ? "" : "s"}
          </div>
          <ul className="list-inside list-disc text-amber-900/90 dark:text-amber-100/90">
            {summary.cancelledPickups.map((c) => (
              <li key={c.legId}>{c.label}</li>
            ))}
          </ul>
          <label className="flex cursor-pointer items-start gap-2 pt-1">
            <Checkbox
              checked={cancellationsAck}
              onCheckedChange={(v) => setCancellationsAck(v === true)}
              className="mt-0.5"
            />
            <span>I confirm these cancellations were intentional.</span>
          </label>
        </div>
      )}

      {redQ.isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Checking open RED issues…
        </div>
      ) : redBlocks.length > 0 ? (
        <div className="rounded-md border-2 border-destructive bg-destructive/10 p-2 text-xs text-destructive">
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" />
            Open RED — resolve or complete verbal authorisation first
          </div>
          <p className="mt-1 line-clamp-2 opacity-90">{redBlocks[0]!.description}</p>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" />
          No blocking RED issues on this run.
        </div>
      )}

      <NumericEntryTrigger
        id="endodo"
        label="Ending odometer"
        value={odo}
        onChange={setOdo}
        placeholder="Tap to enter the reading"
        title="Ending odometer"
        description={`Read the number on the odometer. This is the reading, not the kilometres travelled. Must be at least ${trip.startOdometerKm}.`}
        step={1}
        allowDecimal={false}
        min={trip.startOdometerKm}
        unit="km"
        className={requiredFieldOutline(!validOdo)}
      />
      {!validOdo ? (
        <p className="text-sm font-medium text-destructive">
          {odo.trim() === ""
            ? "Enter the odometer reading on the dash."
            : `Ending reading must be at least the start reading (${trip.startOdometerKm}).`}
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Start {trip.startOdometerKm} → end {odoNum}
          {travelledKm != null ? ` · ${travelledKm} km this trip` : ""}
        </p>
      )}

      {outboxBlocksClose && (
        <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-200">
            <AlertTriangle className="h-3.5 w-3.5" />
            {!online
              ? "Close Run needs a connection"
              : flushing
                ? "Syncing mid-run actions…"
                : `${pendingCount} offline action${pendingCount === 1 ? "" : "s"} must sync first`}
          </div>
          <p className="text-amber-900/90 dark:text-amber-100/90">
            Mid-run Depart / Arrive / boarding changes are held on this device until they reach the
            server. Close Run stays locked until the queue is empty.
          </p>
          {online && hasPending && (
            <FieldActionButton
              variant="secondary"
              size="sm"
              disabled={flushing}
              onClick={() => void flush()}
            >
              {flushing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Syncing…
                </>
              ) : (
                "Retry sync now"
              )}
            </FieldActionButton>
          )}
        </div>
      )}

      <button
        type="button"
        disabled={!canClose || closeMut.isPending}
        onClick={() => setPinOpen(true)}
        className={cn(
          "h-14 w-full rounded-xl font-bold text-white shadow transition",
          !canClose || closeMut.isPending
            ? "bg-red-700 opacity-60 cursor-not-allowed"
            : "bg-red-700 hover:bg-red-800",
        )}
      >
        {closeMut.isPending
          ? "Closing…"
          : outboxBlocksClose
            ? "Close run — sync first"
            : "Close run — enter PIN"}
      </button>

      <PinEntryDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        title="Close transport run"
        description="Enter the PIN you sign in with. Four digits, or all six, then OK. This locks the manifest."
        length={4}
        onVerify={async (pin) => {
          const staffId = getActiveUserProfile()?.staffId || getStaffId();
          if (!staffId || staffId === DEFAULT_STAFF_UUID) {
            throw new Error("Sign in first.");
          }
          await verifyNamedStaffPin(staffId, pin);
        }}
        onSuccess={(pin) => {
          setPinOpen(false);
          closeMut.mutate(pin);
        }}
      />
    </div>
  );
}
