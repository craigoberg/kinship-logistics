/**
 * Yellow / Red deferral for morning & evening accountability rolls (BL-085).
 * Yellow: leader PIN + reason. Red: VerbalConsultationDialog (manager + operator PIN).
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { PinEntryDialog } from "@/components/auth/pin-entry-dialog";
import { resolveOperatorStaffIdFromPin } from "@/components/auth/pin-verify";
import {
  VerbalConsultationDialog,
} from "@/components/issue-engine/verbal-consultation-dialog";
import {
  ROLL_DEFER_INCREMENTS_MIN,
  DEFAULT_ROLL_MAX_DEFER_MINUTES,
  deferAccountabilityRoll,
  listAccountabilityRoll,
  type EventAccountabilityRow,
} from "@/lib/api/event-day-ops";
import { listSystemParameters } from "@/lib/api/system-parameters";
import { SYSTEM_PARAMETERS_QUERY_KEY } from "@/hooks/use-system-parameters";

type Mode = "curfew" | "morning";
type LogTable = "event_curfew_log" | "event_morning_log";

const TABLE: Record<Mode, LogTable> = {
  curfew: "event_curfew_log",
  morning: "event_morning_log",
};

export interface RollCallDeferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
  sessionId: string;
  /** Yellow = leader PIN; Red = verbal manager path. */
  band: "YELLOW" | "RED";
  /** When set, defer only this participant; otherwise all outstanding. */
  participantId?: string | null;
  participantName?: string | null;
  /** Extra context e.g. late return / not at base. */
  contextHint?: string | null;
  onDeferred: () => void;
}

export function RollCallDeferDialog({
  open,
  onOpenChange,
  mode,
  sessionId,
  band,
  participantId,
  participantName,
  contextHint,
  onDeferred,
}: RollCallDeferDialogProps) {
  const table = TABLE[mode];
  const rollLabel = mode === "curfew" ? "Evening roll call" : "Morning roll call";

  const [minutes, setMinutes] = useState(30);
  const [reason, setReason] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [verbalOpen, setVerbalOpen] = useState(false);

  const maxDeferQ = useQuery({
    queryKey: SYSTEM_PARAMETERS_QUERY_KEY,
    queryFn: listSystemParameters,
    staleTime: 60_000,
  });
  const maxDefer = useMemo(() => {
    const row = maxDeferQ.data?.find((r) => r.key === "event_roll_max_defer_minutes");
    if (!row) return DEFAULT_ROLL_MAX_DEFER_MINUTES;
    const n = typeof row.value === "number" ? row.value : Number(row.value);
    return Number.isFinite(n) && n >= 15 ? Math.min(24 * 60, n) : DEFAULT_ROLL_MAX_DEFER_MINUTES;
  }, [maxDeferQ.data]);

  const increments = useMemo(
    () => ROLL_DEFER_INCREMENTS_MIN.filter((m) => m <= maxDefer),
    [maxDefer],
  );

  const rollQ = useQuery({
    queryKey: ["event-accountability-roll", mode, sessionId, "defer-preview"],
    queryFn: () => listAccountabilityRoll(table, sessionId),
    enabled: open,
    staleTime: 5_000,
  });

  const targets = useMemo(() => {
    const rows = rollQ.data ?? [];
    return rows.filter((r) => {
      if (r.status !== "expected") return false;
      if (participantId && r.participant_id !== participantId) return false;
      return true;
    });
  }, [rollQ.data, participantId]);

  const isGroup = !participantId;

  useEffect(() => {
    if (!open) return;
    setMinutes(increments.includes(30 as (typeof increments)[number]) ? 30 : increments[0] ?? 15);
    setReason(contextHint?.trim() ? `${contextHint.trim()}. ` : "");
    setPinOpen(false);
    setVerbalOpen(false);
  }, [open, contextHint, increments]);

  const deferMut = useMutation({
    mutationFn: (args: {
      operatorStaffId: string;
      managerStaffId?: string | null;
      managerName?: string | null;
      reasonText: string;
    }) =>
      deferAccountabilityRoll(table, {
        sessionId,
        minutes,
        reason: args.reasonText,
        participantIds: participantId ? [participantId] : null,
        band,
        operatorStaffId: args.operatorStaffId,
        managerStaffId: args.managerStaffId,
        managerName: args.managerName,
      }),
    onSuccess: (res) => {
      toast.success(
        isGroup
          ? `Group deferred +${minutes}m (${res.deferredCount} people)`
          : `${participantName ?? "Person"} still pending — deferred +${minutes}m`,
        {
          description: isGroup
            ? res.yellowsAutoCleared > 0
              ? `${res.yellowsAutoCleared} Yellow warning(s) auto-cleared. Reason on group banner only.`
              : "Reason saved on the group banner only. Yellow returns after Deferred until."
            : "They stay on the roll until you Mark accounted (or Absent). Yellow after Deferred until; Red + Admin minutes.",
        },
      );
      onOpenChange(false);
      onDeferred();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reasonOk = reason.trim().length >= 10;
  const canContinue = reasonOk && targets.length > 0 && !deferMut.isPending;

  const startConfirm = () => {
    if (!canContinue) return;
    if (band === "RED") {
      setVerbalOpen(true);
    } else {
      setPinOpen(true);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !deferMut.isPending && onOpenChange(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isGroup
                ? band === "RED"
                  ? "Defer everyone — manager"
                  : "Defer everyone"
                : band === "RED"
                  ? "Defer one person — manager"
                  : `Defer ${participantName ?? "person"}`}
            </DialogTitle>
            <DialogDescription>
              {isGroup
                ? band === "RED"
                  ? `Push the ${rollLabel} deadline for everyone still outstanding after manager verbal agreement. The reason stays on the group banner only.`
                  : `Push the ${rollLabel} deadline for everyone still outstanding (e.g. traffic). Reason appears on the Yellow/Red banner as “Group Deferred +…”. Leader PIN required.`
                : band === "RED"
                  ? `Push this person's ${rollLabel} deadline after manager verbal. Note stays on their row.`
                  : `Push this person's ${rollLabel} deadline. Note stays on their row. Leader PIN required.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {contextHint && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                {contextHint}
              </p>
            )}

            <div className="text-sm">
              <span className="font-semibold">Scope: </span>
              {isGroup
                ? `Group — ${targets.length} outstanding ${targets.length === 1 ? "person" : "people"}`
                : participantName ?? "1 person"}
            </div>

            <div className="space-y-2">
              <Label>Defer by</Label>
              <div className="grid grid-cols-3 gap-2">
                {increments.map((m) => (
                  <Button
                    key={m}
                    type="button"
                    variant={minutes === m ? "default" : "outline"}
                    className="min-h-12"
                    onClick={() => setMinutes(m)}
                  >
                    +{m} min
                  </Button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">Admin max {maxDefer} minutes</p>
            </div>

            <CharacterCountedTextarea
              label="Reason / workaround"
              value={reason}
              onValueChange={setReason}
              minChars={10}
              rows={3}
              placeholder="e.g. Bus delayed in traffic — all participants on board with leader"
            />
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={deferMut.isPending}
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={startConfirm}
              disabled={!canContinue}
              className="gap-2"
            >
              {deferMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : band === "RED" ? (
                "Consult manager…"
              ) : (
                "Confirm with PIN…"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PinEntryDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        title="Leader PIN"
        description={`Authorise Yellow deferral of ${rollLabel} by ${minutes} minutes.`}
        onVerify={async (pin) => {
          const staffId = await resolveOperatorStaffIdFromPin(pin);
          await deferMut.mutateAsync({
            operatorStaffId: staffId,
            reasonText: reason.trim(),
          });
        }}
      />

      <VerbalConsultationDialog
        open={verbalOpen}
        onOpenChange={setVerbalOpen}
        ledgerCategory="TRIP"
        subjectLabel={`${rollLabel} — Red defer +${minutes}m`}
        sourceId={sessionId}
        actionType={
          mode === "curfew" ? "CURFEW_ROLL_RED_DEFER_CONSULT" : "MORNING_ROLL_RED_DEFER_CONSULT"
        }
        titleOverride="Red roll deferral — manager consultation"
        descriptionOverride="Record who authorised pushing the roll deadline, the agreed plan, and sign with your operator PIN."
        onAccepted={(payload) => {
          const combined =
            `${reason.trim()}\nPlan: ${payload.notes.trim()}`.trim();
          // Verbal dialog already verified operator PIN into ledger; resolve staff for attribution.
          void (async () => {
            try {
              const { resolveStaffIdWithFallback } = await import("@/lib/data-store");
              const staffId = await resolveStaffIdWithFallback();
              await deferMut.mutateAsync({
                operatorStaffId: staffId,
                managerStaffId: payload.managerStaffId,
                managerName: payload.managerName,
                reasonText: combined,
              });
            } catch (e) {
              toast.error((e as Error).message);
            }
          })();
        }}
      />
    </>
  );
}

/** Helper for callers that already hold roll rows. */
export type { EventAccountabilityRow };
