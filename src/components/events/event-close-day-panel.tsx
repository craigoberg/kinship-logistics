/**
 * EventCloseDayPanel — field close for Event Deliver (BL-089).
 *
 * Overnight (non-final): after evening roll complete → Close day.
 * Uses closeEventLocation (trip leader PIN) — same gate as assertDaySessionCloseable.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Lock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import { verifyManagerPin } from "@/components/auth/pin-verify";
import { FieldActionButton } from "@/components/ui/field-action-button";
import { closeEventLocation, isEventLocationClosed } from "@/lib/api/event-location";
import { getAccountabilityProgress } from "@/lib/api/event-deliver-status";
import { listEventAttendanceRoll } from "@/lib/api/event-attendance";
import type { EventDaySession } from "@/lib/api/event-outing";
import {
  busHomeHandoverGapsKey,
  listBusHomeHandoverGaps,
} from "@/lib/api/event-transport";
import { getActiveUserProfile } from "@/lib/data-store";

interface Props {
  session: EventDaySession;
  /** When true, gate on evening roll complete (overnight nights). */
  requireEveningRoll: boolean;
  onClosed: () => void;
  closeLabel?: string;
}

export function EventCloseDayPanel({
  session,
  requireEveningRoll,
  onClosed,
  closeLabel = "Close day",
}: Props) {
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState<"closed_orderly" | "closed_incident">(
    "closed_orderly",
  );
  const [pinVerified, setPinVerified] = useState(false);
  const [verifiedPin, setVerifiedPin] = useState("");

  const isClosed = isEventLocationClosed(session.phase);
  const managerStaffId = session.manager_staff_id ?? getActiveUserProfile()?.staffId ?? "";

  const { data: eveningProgress, isLoading: eveningLoading } = useQuery({
    queryKey: ["event-accountability-progress", "curfew", session.id],
    queryFn: () => getAccountabilityProgress("event_curfew_log", session.id),
    enabled: requireEveningRoll && !isClosed,
    staleTime: 15_000,
    refetchInterval: requireEveningRoll && !isClosed ? 20_000 : false,
  });

  const { data: attendance = [], isLoading: attLoading } = useQuery({
    queryKey: ["event-attendance-log", session.id],
    queryFn: () => listEventAttendanceRoll(session.id),
    enabled: !isClosed,
    staleTime: 15_000,
  });

  const { data: busHomeGaps, isLoading: gapsLoading } = useQuery({
    queryKey: busHomeHandoverGapsKey(session.id),
    queryFn: () =>
      listBusHomeHandoverGaps({
        eventId: session.event_id,
        sessionId: session.id,
        sessionDate: session.session_date,
      }),
    enabled: !requireEveningRoll && !isClosed,
    staleTime: 10_000,
    refetchInterval: !requireEveningRoll && !isClosed ? 15_000 : false,
  });

  const vacuousEveningOk =
    !!eveningProgress &&
    eveningProgress.total === 0 &&
    attendance.every((r) => r.status !== "checked_in") &&
    attendance.every((r) => r.status !== "expected");

  const eveningReady =
    !!eveningProgress && (eveningProgress.complete || vacuousEveningOk);

  const floorHandoverReady =
    attendance.length > 0 &&
    !attendance.some((r) => r.status === "checked_in" || r.status === "expected");
  const busHomeReady = busHomeGaps != null && busHomeGaps.names.length === 0;
  const checkoutReady = floorHandoverReady && busHomeReady;

  const canClose = requireEveningRoll ? eveningReady : checkoutReady;
  const pendingEvening = eveningProgress?.pending ?? 0;

  const closeMut = useMutation({
    mutationFn: () => {
      if (!pinVerified || !verifiedPin) throw new Error("Trip leader PIN required.");
      return closeEventLocation({
        sessionId: session.id,
        managerPin: verifiedPin,
        outcome,
        notes: notes || undefined,
      });
    },
    onSuccess: () => {
      toast.success(
        outcome === "closed_incident"
          ? "Day closed with incident — recorded."
          : `${closeLabel} complete.`,
      );
      setSheetOpen(false);
      void qc.invalidateQueries({ predicate: (q) => q.queryKey?.[0] === "event-day-sessions" });
      void qc.invalidateQueries({ predicate: (q) => q.queryKey?.[0] === "event-day-session" });
      onClosed();
    },
    onError: (e: Error) => toast.error(e.message, { duration: 10_000 }),
  });

  if (isClosed) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
        Day closed
        {session.phase === "closed_incident" ? " (incident)." : " (orderly)."}
      </div>
    );
  }

  const loading =
    (requireEveningRoll && eveningLoading) ||
    attLoading ||
    (!requireEveningRoll && gapsLoading);

  return (
    <div className="space-y-3">
      {requireEveningRoll && !canClose && !loading && (
        <p className="rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Complete Evening Roll
          {pendingEvening > 0 ? ` — ${pendingEvening} still to account` : ""} before closing
          this day.
        </p>
      )}

      {!requireEveningRoll && floorHandoverReady && !busHomeReady && !loading && (
        <p className="rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {busHomeGaps && !busHomeGaps.homeStarted
            ? `Start the return run in Manifest first — handed to the bus but not on a HOME list: ${busHomeGaps.names.join(", ")}.`
            : `Cannot close until the driver has them on HOME Manifest: ${busHomeGaps?.names.join(", ") ?? "bus passengers"}.`}
        </p>
      )}

      {canClose && (
        <div className="rounded-lg border-2 border-emerald-500/40 bg-emerald-500/5 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-800 dark:text-emerald-200">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {requireEveningRoll
              ? "Evening roll complete — ready to close this day"
              : "Ready to close"}
          </div>
          <FieldActionButton
            variant="destructive"
            onClick={() => {
              setNotes("");
              setOutcome("closed_orderly");
              setPinVerified(false);
              setVerifiedPin("");
              setSheetOpen(true);
            }}
            className="gap-2"
          >
            <Lock className="h-4 w-4" />
            {closeLabel}
          </FieldActionButton>
        </div>
      )}

      <BottomSheet
        open={sheetOpen}
        onOpenChange={(o) => {
          setSheetOpen(o);
          if (!o) {
            setPinVerified(false);
            setVerifiedPin("");
          }
        }}
        title={closeLabel}
        description="Trip leader PIN required. Open Yellow issues may remain; resolve RED before the next day opens if blocked."
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Close outcome</Label>
            <div className="space-y-1.5">
              <MobileFieldButton
                title="Orderly close"
                subtitle="Normal end of day"
                tone="success"
                active={outcome === "closed_orderly"}
                onClick={() => setOutcome("closed_orderly")}
              />
              <MobileFieldButton
                title="Close with incident"
                subtitle="Significant issue — recorded on the day"
                tone="danger"
                active={outcome === "closed_incident"}
                onClick={() => setOutcome("closed_incident")}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Close notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="End-of-day summary…"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Trip leader PIN</Label>
            <PinEntryTrigger
              label="Tap to enter trip leader PIN"
              verified={pinVerified}
              verifiedLabel="PIN verified"
              length={4}
              title={closeLabel}
              description="Trip leader Manager PIN required."
              disabled={!managerStaffId}
              onVerify={async (pin) => {
                await verifyManagerPin(managerStaffId, pin);
              }}
              onSuccess={(pin) => {
                setVerifiedPin(pin);
                setPinVerified(true);
              }}
            />
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setSheetOpen(false)}>
              Close
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={!pinVerified || !verifiedPin || closeMut.isPending}
              onClick={() => closeMut.mutate()}
            >
              {closeMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {closeLabel}
            </Button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
