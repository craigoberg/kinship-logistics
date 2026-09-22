import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { PinEntryDialog } from "@/components/auth/pin-entry-dialog";
import { MobileOptionButton } from "@/components/manifest/mobile-field-button";
import {
  assertClearOfLiveService,
  offboardClient,
  offboardStaff,
  reactivateClient,
  reactivateStaff,
} from "@/lib/api/service-exit";
import { RUN_PLANNING_PEOPLE_KEY } from "@/lib/api/run-planning";
import { SUPPORT_SCHEDULES_KEY } from "@/lib/api/support-attendance";
import {
  CLIENT_EXIT_REASONS,
  STAFF_EXIT_REASONS,
  exitNotesRequired,
} from "@/lib/service-exit";

type Mode = "offboard" | "reactivate";
type Subject = "client" | "staff";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
  subject: Subject;
  personId: string;
  displayName: string;
  onCompleted: (result: {
    mode: Mode;
    reason: string | null;
    notes: string;
    exitedAt: string | null;
  }) => void;
}

export function ServiceExitDialog({
  open,
  onOpenChange,
  mode,
  subject,
  personId,
  displayName,
  onCompleted,
}: Props) {
  const qc = useQueryClient();
  const reasons = subject === "client" ? CLIENT_EXIT_REASONS : STAFF_EXIT_REASONS;
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [floorBlock, setFloorBlock] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setNotes("");
    setPinOpen(false);
    setFloorBlock(null);
    if (mode !== "offboard") return;
    let cancelled = false;
    setChecking(true);
    void assertClearOfLiveService({
      displayName,
      participantId: subject === "client" ? personId : null,
      staffId: subject === "staff" ? personId : null,
    })
      .then(() => {
        if (!cancelled) setFloorBlock(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setFloorBlock((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, mode, subject, personId, displayName]);

  const notesNeeded = exitNotesRequired(reason, mode);
  const missing: string[] = [];
  if (mode === "offboard" && !reason) missing.push("Reason");
  if (notesNeeded && notes.trim().length < 20) missing.push("Notes (20 characters)");
  if (floorBlock) missing.push("Finish today first");
  const canSubmit = !checking && missing.length === 0;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["participants"] });
    void qc.invalidateQueries({ queryKey: ["staff_registry"] });
    void qc.invalidateQueries({ queryKey: ["medication_schedules"] });
    void qc.invalidateQueries({ queryKey: ["attendance_schedules"] });
    void qc.invalidateQueries({ queryKey: RUN_PLANNING_PEOPLE_KEY });
    void qc.invalidateQueries({ queryKey: SUPPORT_SCHEDULES_KEY });
    void qc.invalidateQueries({ queryKey: ["participant-directory-indicators"] });
    void qc.invalidateQueries({ queryKey: ["event_roster_bookings"] });
    void qc.invalidateQueries({ queryKey: ["bus-run-default-routes"] });
  };

  const title =
    mode === "offboard"
      ? `Off-board ${displayName}`
      : `Reactivate ${displayName}`;
  const description =
    mode === "offboard"
      ? "History stays on this record. Future runs, medication, and trips stop. This does not delete the person."
      : "They return as active. Previous schedules, medication, and bookings are not restored.";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {checking && (
              <p className="text-sm text-muted-foreground">Checking today’s floor…</p>
            )}
            {floorBlock && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {floorBlock}
              </div>
            )}

            {mode === "offboard" && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Reason
                </p>
                {reasons.map((item) => (
                  <MobileOptionButton
                    key={item.code}
                    selected={reason === item.code}
                    label={item.label}
                    onClick={() => setReason(item.code)}
                  />
                ))}
              </div>
            )}

            <CharacterCountedTextarea
              label={mode === "reactivate" ? "Why they are returning" : "Notes"}
              value={notes}
              onValueChange={setNotes}
              minChars={20}
              required={notesNeeded}
              rows={3}
              placeholder={
                mode === "reactivate"
                  ? "Funding restarted and they asked to return…"
                  : "Short note for the file…"
              }
            />

            {missing.length > 0 && !checking && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                Still needed: {missing.join(" · ")}
              </div>
            )}
          </div>

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={mode === "offboard" ? "destructive" : "default"}
              disabled={!canSubmit}
              onClick={() => setPinOpen(true)}
            >
              {mode === "offboard" ? "Off-board" : "Reactivate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PinEntryDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        title="Manager PIN"
        description="A manager authorises this. The PIN is not stored."
        onVerify={async (pin) => {
          if (mode === "offboard" && subject === "client") {
            const result = await offboardClient({
              participantId: personId,
              displayName,
              reason,
              notes,
              managerPin: pin,
            });
            invalidate();
            onCompleted({ mode, reason, notes: notes.trim(), exitedAt: result.exitedAt });
            toast.success(`${displayName} left service`, {
              description: "History stays. Future runs, medication, and trips have stopped.",
            });
          } else if (mode === "offboard") {
            const result = await offboardStaff({
              staffId: personId,
              displayName,
              reason,
              notes,
              managerPin: pin,
            });
            invalidate();
            onCompleted({ mode, reason, notes: notes.trim(), exitedAt: result.exitedAt });
            toast.success(`${displayName} left service`, {
              description: "History stays. Day login and PIN are blocked. Future plans have stopped.",
            });
          } else if (subject === "client") {
            await reactivateClient({
              participantId: personId,
              displayName,
              notes,
              managerPin: pin,
            });
            invalidate();
            onCompleted({ mode, reason: null, notes: notes.trim(), exitedAt: null });
            toast.success(`${displayName} is active again`, {
              description: "Schedules, medication, and bookings were not restored.",
            });
          } else {
            await reactivateStaff({
              staffId: personId,
              displayName,
              notes,
              managerPin: pin,
            });
            invalidate();
            onCompleted({ mode, reason: null, notes: notes.trim(), exitedAt: null });
            toast.success(`${displayName} is active again`, {
              description: "Schedules and bookings were not restored. Set a new day password if they need to sign in.",
            });
          }
          setPinOpen(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}
