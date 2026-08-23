/**
 * EventLocationPanel — hard open/close location (§12.4.1 / Phase 8)
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Lock,
  ShieldCheck,
  Unlock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import { verifyManagerPin } from "@/components/auth/pin-verify";
import { MandatedChecksList } from "@/components/site-day/mandated-checks-list";
import { FieldActionButton } from "@/components/ui/field-action-button";
import { getActiveUserProfile } from "@/lib/data-store";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormattedDateTime } from "@/components/ui/formatted-time";
import {
  closeEventLocation,
  isEventLocationClosed,
  isEventLocationOpen,
  openEventLocation,
} from "@/lib/api/event-location";
import { hasOpenRedIssueForSession } from "@/lib/api/site-issues";
import { countTodayVenueStops } from "@/lib/api/event-activity-roll";
import {
  formatGuestIncompleteMessage,
  listIncompleteGuestBookings,
} from "@/lib/api/event-guest";
import type { EventDaySession } from "@/lib/api/event-outing";
import { getEventDayPhaseDisplay } from "@/lib/event-day-phase-display";
import { useVenueOpenChecks } from "@/hooks/use-system-parameters";

interface Props {
  session: EventDaySession;
  onChanged: () => void;
  /** When true, hides the "Close location" button (Event Deliver owns close via Check-Out tab). */
  hideCloseAction?: boolean;
  /** Office event status — disambiguates day phase from whole-event Open. */
  eventStatus?: string | null;
  /** First calendar day of the trip — tweaks open-location copy. */
  isFirstDay?: boolean;
  /**
   * Opens trip-day Log Venue Issue (EventDayVerbalAnomalyFlow).
   * Required for Day Centre parity before open — RED from walkthrough blocks open;
   * Big Red Button INCIDENT does not.
   */
  onLogVenueIssue?: () => void;
}

export function EventLocationPanel({
  session,
  onChanged,
  hideCloseAction = false,
  eventStatus,
  isFirstDay = true,
  onLogVenueIssue,
}: Props) {
  const qc = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [closeDialog, setCloseDialog] = useState(false);
  const [notes, setNotes] = useState("");
  const [managerPinVerified, setManagerPinVerified] = useState(false);
  const [verifiedManagerPin, setVerifiedManagerPin] = useState("");
  const [closeOutcome, setCloseOutcome] = useState<"closed_orderly" | "closed_incident">("closed_orderly");
  const [venueChecksTicked, setVenueChecksTicked] = useState<Set<number>>(new Set());
  const venueOpenChecks = useVenueOpenChecks();
  const venueWalkthroughReady =
    venueOpenChecks.length === 0 || venueChecksTicked.size >= venueOpenChecks.length;

  const resetPinState = () => {
    setManagerPinVerified(false);
    setVerifiedManagerPin("");
  };

  const resetOpenDialogState = () => {
    resetPinState();
    setVenueChecksTicked(new Set());
  };

  const managerStaffId = session.manager_staff_id ?? getActiveUserProfile()?.staffId ?? "";
  const tripLeaderName = (session.manager_name ?? "").trim() || null;
  const tripLeaderPinHint = tripLeaderName
    ? `${tripLeaderName} (trip leader) — their PIN, not another manager’s.`
    : "The assigned trip leader’s PIN — not another manager’s.";

  const { data: hasRed = false } = useQuery({
    queryKey: ["event-day-issues-red-check", session.id],
    queryFn: () => hasOpenRedIssueForSession(session.id),
    staleTime: 15_000,
  });

  const { data: incompleteGuests = [] } = useQuery({
    queryKey: ["event-incomplete-guests", session.event_id],
    queryFn: () => listIncompleteGuestBookings(session.event_id),
    staleTime: 15_000,
  });
  const guestBlock =
    incompleteGuests.length > 0
      ? formatGuestIncompleteMessage(incompleteGuests)
      : null;

  const { data: stopCount = 0 } = useQuery({
    queryKey: ["event-stop-count", session.event_id, session.session_date],
    queryFn: () => countTodayVenueStops(session.event_id, session.session_date),
    staleTime: 30_000,
  });
  const hasStops = stopCount > 0;

  // PIN success opens immediately — pass pin into mutate (do not gate on
  // managerPinVerified state; setState is async and would see a stale false).
  const openMut = useMutation({
    mutationFn: (managerPin: string) => {
      if (!managerPin) throw new Error("Manager PIN required.");
      if (!venueWalkthroughReady) {
        throw new Error("Complete the venue walkthrough checks before opening.");
      }
      const completed = venueOpenChecks.filter((_, i) => venueChecksTicked.has(i));
      return openEventLocation({
        sessionId: session.id,
        managerPin,
        notes,
        venueOpenChecksCompleted: completed,
      });
    },
    onSuccess: () => {
      toast.success("Location opened — event floor is live.");
      setOpenDialog(false);
      resetOpenDialogState();
      setNotes("");
      onChanged();
      qc.invalidateQueries({ queryKey: ["event-attendance-log", session.id] });
    },
    onError: (e: Error) => toast.error(e.message, { duration: 10_000 }),
  });

  const closeMut = useMutation({
    mutationFn: () => {
      if (!managerPinVerified || !verifiedManagerPin) {
        throw new Error("Manager PIN required.");
      }
      return closeEventLocation({
        sessionId: session.id,
        managerPin: verifiedManagerPin,
        outcome: closeOutcome,
        notes,
      });
    },
    onSuccess: () => {
      toast.success("Location closed.");
      setCloseDialog(false);
      resetPinState();
      setNotes("");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message, { duration: 10_000 }),
  });

  const isOpen = isEventLocationOpen(session.phase);
  const isClosed = isEventLocationClosed(session.phase);
  const canOpen = session.phase === "planning" || session.phase === "pre_departure";
  const canClose = isOpen && !isClosed;

  return (
    <div className={cn(
      "rounded-lg border bg-card",
      isOpen || isClosed ? "px-3 py-2" : "p-4 space-y-3",
    )}>
      {/* ── Compact status bar when location is live or closed ── */}
      {(isOpen || isClosed) ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="text-xs font-semibold">Event location</span>
            <PhaseBadge phase={session.phase} eventStatus={eventStatus} />
          </div>
          {session.open_declared_at && (
            <span className="text-[11px] text-muted-foreground">
              Opened <FormattedDateTime value={session.open_declared_at} />
              {session.open_leader_notes && ` · ${session.open_leader_notes}`}
            </span>
          )}
          {session.close_declared_at && (
            <span className="text-[11px] text-muted-foreground">
              · Closed <FormattedDateTime value={session.close_declared_at} />
              {session.close_leader_notes && ` · ${session.close_leader_notes}`}
            </span>
          )}
          {canClose && !hideCloseAction && (
            <Button size="sm" variant="destructive" className="ml-auto h-7 text-xs" onClick={() => {
              resetPinState();
              setNotes("");
              setCloseDialog(true);
            }}>
              <Lock className="mr-1 h-3 w-3" />
              Close
            </Button>
          )}
          {isClosed && (
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
              Closed
            </span>
          )}
        </div>
      ) : (
        /* ── Full panel when location is not yet open (planning / pre-departure) ── */
        <>
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Event location</span>
            <PhaseBadge phase={session.phase} eventStatus={eventStatus} />
          </div>

          <p className="text-xs text-muted-foreground">
            {isFirstDay ? (
              <>
                Opening the location <strong>starts the event floor</strong> (temporary centre).
                Complete venue walkthrough and confirm area is safe before opening.
              </>
            ) : (
              <>
                The event is <strong>Open</strong> in the office — open the location to{" "}
                <strong>start today&apos;s floor</strong>. Complete venue walkthrough and confirm
                the area is safe before opening.
              </>
            )}
          </p>

          {guestBlock && canOpen && (
            <div className="flex items-start gap-2 rounded-md border-2 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>{guestBlock}</span>
            </div>
          )}
          {hasRed && (
            <div className="flex items-start gap-2 rounded-lg border-2 border-destructive/50 bg-destructive/10 p-2.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1">
                <p className="font-semibold">Open RED issue — cannot open the location.</p>
                <p className="text-destructive/90">
                  Clear via Hub / accepted workaround, or do not open (turn buses around). Use{" "}
                  <span className="font-semibold">Log Venue Issue</span> for new walkthrough finds —
                  not the Big Red Button (that does not block open).
                </p>
              </div>
            </div>
          )}

          {!session.manager_staff_id && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Assign a trip leader in Config before opening.
            </div>
          )}

          {canOpen && !hasStops && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              No activities scheduled for this day — add at least a departure point in the Itinerary before opening.
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {canOpen && (
              <Button
                size="sm"
                disabled={
                  !session.manager_staff_id ||
                  hasRed ||
                  !hasStops ||
                  !!guestBlock
                }
                onClick={() => {
                  resetPinState();
                  setNotes("");
                  setOpenDialog(true);
                }}
              >
                <Unlock className="mr-1.5 h-3.5 w-3.5" />
                Open location
              </Button>
            )}
            {canClose && !hideCloseAction && (
              <Button size="sm" variant="destructive" onClick={() => {
                resetPinState();
                setNotes("");
                setCloseDialog(true);
              }}>
                <Lock className="mr-1.5 h-3.5 w-3.5" />
                Close location
              </Button>
            )}
          </div>

          {canOpen && onLogVenueIssue && (
            <FieldActionButton
              variant="caution"
              size="sm"
              onClick={onLogVenueIssue}
            >
              <span className="flex items-center justify-center gap-2">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                Log Venue Issue
                <span className="text-xs font-normal opacity-70">
                  (if a check is not OK — blocks open on RED)
                </span>
              </span>
            </FieldActionButton>
          )}
        </>
      )}

      {/* Open dialog — PIN = open (same as Day Centre); warnings stay on the panel before this */}
      <Dialog
        open={openDialog}
        onOpenChange={(o) => {
          setOpenDialog(o);
          if (!o) resetOpenDialogState();
        }}
      >
        <DialogContent className="max-w-md max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Open location?</DialogTitle>
            <DialogDescription>
              Complete the venue walkthrough, then enter the trip leader’s PIN
              {tripLeaderName ? ` (${tripLeaderName})` : ""}. That sign-off opens the
              event floor and starts arrival check-in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <MandatedChecksList
              items={venueOpenChecks}
              ticked={venueChecksTicked}
              onTickedChange={setVenueChecksTicked}
              heading="Confirm venue walkthrough"
              paramKey="event_deliver.venue_open_checks"
              emptyTrustVerb="open"
            />
            {venueOpenChecks.length > 0 && !venueWalkthroughReady && (
              <div className="flex items-start gap-2 rounded-md border border-yellow-500/60 bg-yellow-500/10 p-3 text-sm text-yellow-800 dark:text-yellow-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
                <p>
                  Tick each confirmation above. If any item is{" "}
                  <span className="font-semibold">not</span> OK, use{" "}
                  <span className="font-semibold">Log Venue Issue</span> (Yellow
                  workaround or Red — blocks open). Do not use the Big Red Button
                  for walkthrough fails.
                </p>
              </div>
            )}
            {onLogVenueIssue && (
              <FieldActionButton
                variant="caution"
                size="sm"
                onClick={() => {
                  // Keep tick progress; anomaly modal stacks above.
                  onLogVenueIssue();
                }}
                disabled={openMut.isPending}
              >
                <span className="flex items-center justify-center gap-2">
                  <AlertTriangle className="h-5 w-5 shrink-0" />
                  Log Venue Issue
                  <span className="text-xs font-normal opacity-70">
                    (Green · Yellow · Red)
                  </span>
                </span>
              </FieldActionButton>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Open notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                disabled={openMut.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                Trip leader PIN{tripLeaderName ? ` — ${tripLeaderName}` : ""}
              </Label>
              <PinEntryTrigger
                label={
                  venueWalkthroughReady
                    ? tripLeaderName
                      ? `Tap to enter ${tripLeaderName}'s PIN and open`
                      : "Tap to enter trip leader PIN and open"
                    : "Complete walkthrough checks first"
                }
                verified={managerPinVerified || openMut.isPending}
                verifiedLabel={openMut.isPending ? "Opening…" : "Trip leader PIN verified"}
                length={4}
                title="Open event location"
                description={tripLeaderPinHint}
                disabled={
                  !managerStaffId || openMut.isPending || !venueWalkthroughReady || hasRed
                }
                onVerify={async (pin) => {
                  await verifyManagerPin(managerStaffId, pin);
                }}
                onSuccess={(pin) => {
                  setVerifiedManagerPin(pin);
                  setManagerPinVerified(true);
                  openMut.mutate(pin);
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpenDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close dialog */}
      <Dialog
        open={closeDialog}
        onOpenChange={(o) => {
          setCloseDialog(o);
          if (!o) resetPinState();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Close location?</DialogTitle>
            <DialogDescription>
              Complete departure handover on the Arrival roll first. Everyone still checked in will
              block close.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Outcome</Label>
              <div className="space-y-1.5">
                {([
                  { value: "closed_orderly", label: "Closed — orderly" },
                  { value: "closed_incident", label: "Closed — incident" },
                ] as const).map((opt) => (
                  <MobileFieldButton
                    key={opt.value}
                    title={opt.label}
                    selected={closeOutcome === opt.value}
                    onClick={() => setCloseOutcome(opt.value)}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Close notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                Trip leader PIN{tripLeaderName ? ` — ${tripLeaderName}` : ""}
              </Label>
              <PinEntryTrigger
                label={
                  tripLeaderName
                    ? `Tap to enter ${tripLeaderName}'s PIN`
                    : "Tap to enter trip leader PIN"
                }
                verified={managerPinVerified}
                verifiedLabel="Trip leader PIN verified"
                length={4}
                title="Close event location"
                description={tripLeaderPinHint}
                disabled={!managerStaffId}
                onVerify={async (pin) => {
                  await verifyManagerPin(managerStaffId, pin);
                }}
                onSuccess={(pin) => {
                  setVerifiedManagerPin(pin);
                  setManagerPinVerified(true);
                }}
              />
            </div>
          </div>
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button type="button" variant="outline" onClick={() => setCloseDialog(false)}>
              Close
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!managerPinVerified || !verifiedManagerPin || closeMut.isPending}
              onClick={() => closeMut.mutate()}
            >
              {closeMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Close location
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PhaseBadge({ phase, eventStatus }: { phase: string; eventStatus?: string | null }) {
  const { label, classes } = getEventDayPhaseDisplay(phase, eventStatus);
  return (
    <Badge className={cn("text-[10px] font-bold uppercase tracking-wide", classes)}>
      {label}
    </Badge>
  );
}
