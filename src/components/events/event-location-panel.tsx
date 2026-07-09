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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import { verifyManagerPin } from "@/components/auth/pin-verify";
import { getActiveUserProfile } from "@/lib/data-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import type { EventDaySession } from "@/lib/api/event-outing";

interface Props {
  session: EventDaySession;
  onChanged: () => void;
}

export function EventLocationPanel({ session, onChanged }: Props) {
  const qc = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [closeDialog, setCloseDialog] = useState(false);
  const [notes, setNotes] = useState("");
  const [managerPinVerified, setManagerPinVerified] = useState(false);
  const [verifiedManagerPin, setVerifiedManagerPin] = useState("");
  const [closeOutcome, setCloseOutcome] = useState<"closed_orderly" | "closed_incident">("closed_orderly");

  const resetPinState = () => {
    setManagerPinVerified(false);
    setVerifiedManagerPin("");
  };

  const managerStaffId = session.manager_staff_id ?? getActiveUserProfile()?.staffId ?? "";

  const { data: hasRed = false } = useQuery({
    queryKey: ["event-day-issues-red-check", session.id],
    queryFn: () => hasOpenRedIssueForSession(session.id),
    staleTime: 15_000,
  });

  const openMut = useMutation({
    mutationFn: () => {
      if (!managerPinVerified || !verifiedManagerPin) {
        throw new Error("Manager PIN required.");
      }
      return openEventLocation({
        sessionId: session.id,
        managerPin: verifiedManagerPin,
        notes,
      });
    },
    onSuccess: () => {
      toast.success("Location opened — event floor is live.");
      setOpenDialog(false);
      resetPinState();
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
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Event location</span>
        <PhaseBadge phase={session.phase} />
      </div>

      <p className="text-xs text-muted-foreground">
        Opening the location <strong>starts the event</strong> (temporary centre). Transport may run
        before open. Close after everyone has been handed to their return transport.
      </p>

      {session.open_declared_at && (
        <p className="text-[11px] text-muted-foreground">
          Opened <FormattedDateTime value={session.open_declared_at} />
          {session.open_leader_notes && ` — ${session.open_leader_notes}`}
        </p>
      )}
      {session.close_declared_at && (
        <p className="text-[11px] text-muted-foreground">
          Closed <FormattedDateTime value={session.close_declared_at} />
          {session.close_leader_notes && ` — ${session.close_leader_notes}`}
        </p>
      )}

      {hasRed && canOpen && (
        <div className="flex items-start gap-2 rounded-lg border-2 border-destructive/50 bg-destructive/10 p-2.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Open RED issue — resolve before opening the location.
        </div>
      )}

      {!session.manager_staff_id && canOpen && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Assign a trip leader in Config before opening.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {canOpen && (
          <Button
            size="sm"
            disabled={!session.manager_staff_id || hasRed}
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
        {canClose && (
          <Button size="sm" variant="destructive" onClick={() => {
            resetPinState();
            setNotes("");
            setCloseDialog(true);
          }}>
            <Lock className="mr-1.5 h-3.5 w-3.5" />
            Close location
          </Button>
        )}
        {isClosed && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            Location closed for this trip day
          </span>
        )}
      </div>

      {/* Open dialog — Dialog (not AlertDialog) so nested PinEntry sheet does not block submit */}
      <Dialog
        open={openDialog}
        onOpenChange={(o) => {
          setOpenDialog(o);
          if (!o) resetPinState();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Open location?</DialogTitle>
            <DialogDescription>
              This starts the event floor. Arrival check-in becomes active. Manager PIN required.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Open notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Manager PIN</Label>
              <PinEntryTrigger
                label="Tap to enter manager PIN"
                verified={managerPinVerified}
                verifiedLabel="Manager PIN verified"
                length={4}
                title="Open event location"
                description="Trip leader PIN required to start the event floor."
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpenDialog(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!managerPinVerified || !verifiedManagerPin || openMut.isPending}
              onClick={() => openMut.mutate()}
            >
              {openMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Open location
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
              <Select
                value={closeOutcome}
                onValueChange={(v) => setCloseOutcome(v as typeof closeOutcome)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="closed_orderly">Closed — orderly</SelectItem>
                  <SelectItem value="closed_incident">Closed — incident</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Close notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Manager PIN</Label>
              <PinEntryTrigger
                label="Tap to enter manager PIN"
                verified={managerPinVerified}
                verifiedLabel="Manager PIN verified"
                length={4}
                title="Close event location"
                description="Trip leader PIN required to close the event floor."
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCloseDialog(false)}>
              Cancel
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

function PhaseBadge({ phase }: { phase: string }) {
  if (phase === "active")
    return <Badge className="bg-emerald-600 text-white text-[10px]">Open — live</Badge>;
  if (phase === "closed_orderly")
    return <Badge className="bg-zinc-600 text-white text-[10px]">Closed</Badge>;
  if (phase === "closed_incident")
    return <Badge className="bg-destructive text-[10px]">Closed — incident</Badge>;
  if (phase === "planning")
    return <Badge variant="secondary" className="text-[10px]">Not yet open</Badge>;
  return <Badge variant="outline" className="text-[10px]">{phase}</Badge>;
}
