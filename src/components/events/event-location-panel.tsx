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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  const [pin, setPin] = useState("");
  const [closeOutcome, setCloseOutcome] = useState<"closed_orderly" | "closed_incident">("closed_orderly");

  const { data: hasRed = false } = useQuery({
    queryKey: ["event-day-issues-red-check", session.id],
    queryFn: () => hasOpenRedIssueForSession(session.id),
    staleTime: 15_000,
  });

  const openMut = useMutation({
    mutationFn: () =>
      openEventLocation({ sessionId: session.id, managerPin: pin, notes }),
    onSuccess: () => {
      toast.success("Location opened — event floor is live.");
      setOpenDialog(false);
      setPin("");
      setNotes("");
      onChanged();
      qc.invalidateQueries({ queryKey: ["event-attendance-log", session.id] });
    },
    onError: (e: Error) => toast.error(e.message, { duration: 10_000 }),
  });

  const closeMut = useMutation({
    mutationFn: () =>
      closeEventLocation({
        sessionId: session.id,
        managerPin: pin,
        outcome: closeOutcome,
        notes,
      }),
    onSuccess: () => {
      toast.success("Location closed.");
      setCloseDialog(false);
      setPin("");
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
            onClick={() => setOpenDialog(true)}
          >
            <Unlock className="mr-1.5 h-3.5 w-3.5" />
            Open location
          </Button>
        )}
        {canClose && (
          <Button size="sm" variant="destructive" onClick={() => setCloseDialog(true)}>
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

      {/* Open dialog */}
      <AlertDialog open={openDialog} onOpenChange={setOpenDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Open location?</AlertDialogTitle>
            <AlertDialogDescription>
              This starts the event floor. Arrival check-in becomes active. Manager PIN required.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Open notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Manager PIN</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="••••"
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              disabled={pin.length < 4 || openMut.isPending}
              onClick={() => openMut.mutate()}
            >
              {openMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Open location
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Close dialog */}
      <AlertDialog open={closeDialog} onOpenChange={setCloseDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close location?</AlertDialogTitle>
            <AlertDialogDescription>
              Complete departure handover on the Arrival roll first. Everyone still checked in will
              block close.
            </AlertDialogDescription>
          </AlertDialogHeader>
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
              <Input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={pin.length < 4 || closeMut.isPending}
              onClick={() => closeMut.mutate()}
            >
              {closeMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Close location
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
