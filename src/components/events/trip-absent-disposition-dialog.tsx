/**
 * TripAbsentDispositionDialog — shared left-trip / Not Attending welfare flow (BL-090).
 *
 * Disposition tap list → safety plan (min 20) → Yellow/Red → Leader PIN submits.
 * TripReinstateDialog — PIN + short reason to bring an Absent placeholder back.
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { CharacterCountedInput } from "@/components/ui/character-counted-input";
import { PinEntryDialog } from "@/components/auth/pin-entry-dialog";
import { verifyOperatorPin } from "@/components/auth/pin-verify";
import { MobileOptionButton } from "@/components/manifest/mobile-field-button";
import { RYGE_SEVERITY_CHIPS } from "@/lib/ui/ryge-severity-chips";
import { cn } from "@/lib/utils";
import {
  ACTIVITY_SKIP_REASONS,
  LEFT_TRIP_DISPOSITIONS,
  type ActivitySkipReason,
  type LeftTripDisposition,
} from "@/lib/trip-absent";

export interface TripAbsentDispositionResult {
  disposition: LeftTripDisposition;
  safetyPlan: string;
  severity: "yellow" | "red";
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participantName: string;
  /** Override title (e.g. "Joining from Day 2"). */
  title?: string;
  description?: string;
  pending?: boolean;
  onConfirm: (result: TripAbsentDispositionResult) => void | Promise<void>;
}

export function TripAbsentDispositionDialog({
  open,
  onOpenChange,
  participantName,
  title = "Mark absent",
  description,
  pending = false,
  onConfirm,
}: Props) {
  const [disposition, setDisposition] = useState<LeftTripDisposition | null>(null);
  const [safetyPlan, setSafetyPlan] = useState("");
  const [severity, setSeverity] = useState<"yellow" | "red">("yellow");
  const [pinOpen, setPinOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDisposition(null);
    setSafetyPlan("");
    setSeverity("yellow");
    setPinOpen(false);
  }, [open]);

  const planOk = safetyPlan.trim().length >= 20;
  const canPin = disposition != null && planOk && !pending;

  async function handlePinVerify(pin: string): Promise<void> {
    await verifyOperatorPin(pin);
    if (!disposition) throw new Error("Select how they left the trip.");
    await onConfirm({
      disposition,
      safetyPlan: safetyPlan.trim(),
      severity,
    });
  }

  function handlePinSuccess() {
    setPinOpen(false);
    onOpenChange(false);
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!pinOpen && !pending) onOpenChange(o);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {title} — {participantName}
            </DialogTitle>
            <DialogDescription>
              {description ??
                `Record how ${participantName} left the trip. They stay on the list as Absent until reinstated.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                How they left
              </p>
              <div className="space-y-2">
                {LEFT_TRIP_DISPOSITIONS.map((d) => (
                  <MobileOptionButton
                    key={d.value}
                    selected={disposition === d.value}
                    label={d.label}
                    onClick={() => setDisposition(d.value)}
                    disabled={pending}
                  />
                ))}
              </div>
            </div>

            <CharacterCountedTextarea
              label="Reason / safety plan"
              value={safetyPlan}
              onValueChange={setSafetyPlan}
              minChars={20}
              maxChars={500}
              required
              rows={3}
              placeholder="Who was notified, how they got home, who confirms arrival…"
            />

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Severity
              </p>
              <div className="flex gap-2">
                {RYGE_SEVERITY_CHIPS.filter(
                  (c) => c.value === "yellow" || c.value === "red",
                ).map((chip) => (
                  <button
                    key={chip.value}
                    type="button"
                    disabled={pending}
                    onClick={() => setSeverity(chip.value as "yellow" | "red")}
                    className={cn(
                      "flex-1 rounded-lg border-2 px-3 py-2.5 text-sm font-semibold transition",
                      severity === chip.value ? chip.activeClass : chip.idleClass,
                    )}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Close
            </Button>
            <Button
              type="button"
              disabled={!canPin}
              onClick={() => setPinOpen(true)}
            >
              Enter Leader PIN
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PinEntryDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        title="Leader PIN"
        description="Any active staff PIN authorises the absence record."
        onVerify={handlePinVerify}
        onSuccess={handlePinSuccess}
      />
    </>
  );
}

// ─── Reinstate ────────────────────────────────────────────────────────────────

interface ReinstateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participantName: string;
  pending?: boolean;
  onConfirm: (reason: string) => void | Promise<void>;
}

export function TripReinstateDialog({
  open,
  onOpenChange,
  participantName,
  pending = false,
  onConfirm,
}: ReinstateProps) {
  const [reason, setReason] = useState("");
  const [pinOpen, setPinOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setPinOpen(false);
  }, [open]);

  const reasonOk = reason.trim().length >= 10;

  async function handlePinVerify(pin: string): Promise<void> {
    await verifyOperatorPin(pin);
    await onConfirm(reason.trim());
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!pinOpen && !pending) onOpenChange(o);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reinstate — {participantName}</DialogTitle>
            <DialogDescription>
              Return them to the active group. They can be assigned transport and activities again.
            </DialogDescription>
          </DialogHeader>
          <CharacterCountedInput
            label="Reason"
            value={reason}
            onValueChange={setReason}
            minChars={10}
            maxChars={200}
            required
            placeholder="e.g. Returned to hotel at 21:40 — family drop-off…"
          />
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Close
            </Button>
            <Button
              type="button"
              disabled={!reasonOk || pending}
              onClick={() => setPinOpen(true)}
            >
              Enter Leader PIN
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PinEntryDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        title="Leader PIN"
        description={`Authorise reinstating ${participantName}.`}
        onVerify={handlePinVerify}
        onSuccess={() => {
          setPinOpen(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}

// ─── Activity skip (still on trip) ────────────────────────────────────────────

export interface ActivitySkipResult {
  reason: ActivitySkipReason;
  note: string;
}

interface SkipProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participantName: string;
  pending?: boolean;
  onConfirm: (result: ActivitySkipResult) => void | Promise<void>;
}

/**
 * Not at this activity — still on the trip. No PIN / Hub.
 * Prefer ProgrammeAbsentDialog (mode toggle) on Programme; this remains for reuse.
 */
export function ActivitySkipDialog({
  open,
  onOpenChange,
  participantName,
  pending = false,
  onConfirm,
}: SkipProps) {
  const [reason, setReason] = useState<ActivitySkipReason | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setReason(null);
    setNote("");
  }, [open]);

  const noteRequired =
    reason === "other" || reason === "resting_in_room";
  const noteOk = !noteRequired || note.trim().length >= 10;
  const canSave = reason != null && noteOk && !pending;

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Not at this activity — {participantName}</DialogTitle>
          <DialogDescription>
            They stay on the trip (hotel rolls and Check-Out still apply). Use Left
            the trip only if they have gone home.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Reason
            </p>
            <div className="space-y-2">
              {ACTIVITY_SKIP_REASONS.map((d) => (
                <MobileOptionButton
                  key={d.value}
                  selected={reason === d.value}
                  label={d.label}
                  onClick={() => setReason(d.value)}
                  disabled={pending}
                />
              ))}
            </div>
          </div>

          <CharacterCountedTextarea
            label={
              reason === "resting_in_room"
                ? "Who is with them / room note"
                : reason === "other"
                  ? "Details"
                  : "Note (optional)"
            }
            value={note}
            onValueChange={setNote}
            minChars={noteRequired ? 10 : 0}
            maxChars={300}
            required={noteRequired}
            rows={2}
            placeholder={
              reason === "resting_in_room"
                ? "e.g. In room 214 with carer Sam — staff check hourly…"
                : "Optional detail…"
            }
          />
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Close
          </Button>
          <Button
            type="button"
            disabled={!canSave}
            onClick={async () => {
              if (!reason) return;
              await onConfirm({ reason, note: note.trim() });
              onOpenChange(false);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Programme: unified mode toggle (field / touch-first) ─────────────────────

export type ProgrammeAbsentResult =
  | { mode: "skip"; reason: ActivitySkipReason; note: string }
  | {
      mode: "left_trip";
      disposition: LeftTripDisposition;
      safetyPlan: string;
      severity: "yellow" | "red";
    };

interface ProgrammeAbsentProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participantName: string;
  pending?: boolean;
  onConfirm: (result: ProgrammeAbsentResult) => void | Promise<void>;
}

/**
 * Single field dialog: big mode taps (default = still on trip), then hydrated reasons.
 * Skip → Save. Left trip → severity + safety plan + Leader PIN.
 */
export function ProgrammeAbsentDialog({
  open,
  onOpenChange,
  participantName,
  pending = false,
  onConfirm,
}: ProgrammeAbsentProps) {
  const [mode, setMode] = useState<"skip" | "left_trip">("skip");
  const [skipReason, setSkipReason] = useState<ActivitySkipReason | null>(null);
  const [skipNote, setSkipNote] = useState("");
  const [disposition, setDisposition] = useState<LeftTripDisposition | null>(null);
  const [safetyPlan, setSafetyPlan] = useState("");
  const [severity, setSeverity] = useState<"yellow" | "red">("yellow");
  const [pinOpen, setPinOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode("skip");
    setSkipReason(null);
    setSkipNote("");
    setDisposition(null);
    setSafetyPlan("");
    setSeverity("yellow");
    setPinOpen(false);
  }, [open]);

  const skipNoteRequired =
    skipReason === "other" || skipReason === "resting_in_room";
  const skipNoteOk = !skipNoteRequired || skipNote.trim().length >= 10;
  const skipReady = mode === "skip" && skipReason != null && skipNoteOk && !pending;

  const leftPlanOk = safetyPlan.trim().length >= 20;
  const leftReady =
    mode === "left_trip" && disposition != null && leftPlanOk && !pending;

  async function handlePinVerify(pin: string): Promise<void> {
    await verifyOperatorPin(pin);
    if (!disposition) throw new Error("Select how they left the trip.");
    await onConfirm({
      mode: "left_trip",
      disposition,
      safetyPlan: safetyPlan.trim(),
      severity,
    });
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!pinOpen && !pending) onOpenChange(o);
        }}
      >
        <DialogContent className="max-h-[92dvh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Absent — {participantName}</DialogTitle>
            <DialogDescription>
              Choose whether they are still with the group, or have left the trip.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Mode — large tap targets (not a tiny checkbox) */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Status
              </p>
              <div className="space-y-2">
                <MobileOptionButton
                  selected={mode === "skip"}
                  label={
                    <span>
                      <span className="block text-base">Still on the trip</span>
                      <span className="mt-0.5 block text-xs font-normal opacity-90">
                        Not at this activity — mark Safe at hotel later
                      </span>
                    </span>
                  }
                  onClick={() => setMode("skip")}
                  disabled={pending}
                />
                <MobileOptionButton
                  selected={mode === "left_trip"}
                  label={
                    <span>
                      <span className="block text-base">Left the trip</span>
                      <span className="mt-0.5 block text-xs font-normal opacity-90">
                        Gone home — needs welfare plan + PIN
                      </span>
                    </span>
                  }
                  onClick={() => setMode("left_trip")}
                  disabled={pending}
                />
              </div>
            </div>

            {mode === "skip" ? (
              <>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Why not at this activity
                  </p>
                  <div className="space-y-2">
                    {ACTIVITY_SKIP_REASONS.map((d) => (
                      <MobileOptionButton
                        key={d.value}
                        selected={skipReason === d.value}
                        label={d.label}
                        onClick={() => setSkipReason(d.value)}
                        disabled={pending}
                      />
                    ))}
                  </div>
                </div>
                <CharacterCountedTextarea
                  label={
                    skipReason === "resting_in_room"
                      ? "Who is with them / room note"
                      : skipReason === "other"
                        ? "Details"
                        : "Note (optional)"
                  }
                  value={skipNote}
                  onValueChange={setSkipNote}
                  minChars={skipNoteRequired ? 10 : 0}
                  maxChars={300}
                  required={skipNoteRequired}
                  rows={2}
                  placeholder={
                    skipReason === "resting_in_room"
                      ? "e.g. Room 214 with carer Sam — staff check hourly…"
                      : "Optional detail…"
                  }
                />
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    How they left
                  </p>
                  <div className="space-y-2">
                    {LEFT_TRIP_DISPOSITIONS.map((d) => (
                      <MobileOptionButton
                        key={d.value}
                        selected={disposition === d.value}
                        label={d.label}
                        onClick={() => setDisposition(d.value)}
                        disabled={pending}
                      />
                    ))}
                  </div>
                </div>
                <CharacterCountedTextarea
                  label="Reason / safety plan"
                  value={safetyPlan}
                  onValueChange={setSafetyPlan}
                  minChars={20}
                  maxChars={500}
                  required
                  rows={3}
                  placeholder="Who was notified, how they got home, who confirms arrival…"
                />
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Severity
                  </p>
                  <div className="flex gap-2">
                    {RYGE_SEVERITY_CHIPS.filter(
                      (c) => c.value === "yellow" || c.value === "red",
                    ).map((chip) => (
                      <button
                        key={chip.value}
                        type="button"
                        disabled={pending}
                        onClick={() => setSeverity(chip.value as "yellow" | "red")}
                        className={cn(
                          "min-h-12 flex-1 touch-manipulation rounded-lg border-2 px-3 py-2.5 text-sm font-semibold transition",
                          severity === chip.value ? chip.activeClass : chip.idleClass,
                        )}
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              className="min-h-12 touch-manipulation"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Close
            </Button>
            {mode === "skip" ? (
              <Button
                type="button"
                className="min-h-12 touch-manipulation"
                disabled={!skipReady}
                onClick={async () => {
                  if (!skipReason) return;
                  await onConfirm({
                    mode: "skip",
                    reason: skipReason,
                    note: skipNote.trim(),
                  });
                  onOpenChange(false);
                }}
              >
                Save
              </Button>
            ) : (
              <Button
                type="button"
                className="min-h-12 touch-manipulation"
                disabled={!leftReady}
                onClick={() => setPinOpen(true)}
              >
                Enter Leader PIN
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PinEntryDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        title="Leader PIN"
        description="Authorises recording that they have left the trip."
        onVerify={handlePinVerify}
        onSuccess={() => {
          setPinOpen(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}
