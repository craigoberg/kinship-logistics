/**
 * BL-084 Phase C — Activate Drill|Live emergency (non-prescriptive free-text).
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Siren } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import { verifyManagerPin } from "@/components/auth/pin-verify";
import { getActiveUserProfile, isActiveUserManager } from "@/lib/data-store";
import {
  activateEmergency,
  type EmergencyMode,
  type EmergencySeverity,
  type EmergencySurface,
} from "@/lib/api/operational-emergency";
import { invalidateIssueCaches } from "@/lib/query/invalidation";
import { RYGE_SEVERITY_CHIPS } from "@/lib/ui/ryge-severity-chips";
import { cn, formatUnknownError } from "@/lib/utils";

export type EmergencyActivateSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surface: EmergencySurface;
  siteDaySessionId?: string | null;
  eventId?: string | null;
  eventDaySessionId?: string | null;
};

export function EmergencyActivateSheet(props: EmergencyActivateSheetProps) {
  const {
    open,
    onOpenChange,
    surface,
    siteDaySessionId,
    eventId,
    eventDaySessionId,
  } = props;
  const qc = useQueryClient();
  const profile = getActiveUserProfile();
  const managerStaffId = profile?.staffId ?? "";
  const canActivate = isActiveUserManager() && !!managerStaffId;

  const [mode, setMode] = useState<EmergencyMode>("drill");
  const [severity, setSeverity] = useState<EmergencySeverity>("red");
  const [situation, setSituation] = useState("");
  const [pinVerified, setPinVerified] = useState(false);

  useEffect(() => {
    if (!open) {
      setMode("drill");
      setSeverity("red");
      setSituation("");
      setPinVerified(false);
    }
  }, [open]);

  const mut = useMutation({
    mutationFn: () =>
      activateEmergency({
        mode,
        severity,
        situationText: situation,
        surface,
        siteDaySessionId,
        eventId,
        eventDaySessionId,
        managerStaffId,
      }),
    onSuccess: () => {
      invalidateIssueCaches(qc);
      void qc.invalidateQueries({ queryKey: ["operational-emergencies"] });
      toast.success(
        mode === "drill" ? "Drill activated" : "LIVE emergency activated",
        {
          description:
            severity === "red"
              ? "Evacuate to muster point — use Muster for the care roll."
              : "Banner and standby muster are live.",
        },
      );
      onOpenChange(false);
    },
    onError: (e: unknown) => {
      toast.error("Could not activate", { description: formatUnknownError(e) });
    },
  });

  const ready =
    canActivate &&
    pinVerified &&
    situation.trim().length >= 10 &&
    !mut.isPending;

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Activate emergency"
      description="Free-text situation — not a hazard catalogue. Choose Drill or Live."
    >
      <div className="space-y-4 pb-4">
        {!canActivate ? (
          <p className="text-sm text-muted-foreground">
            Manager profile required to activate.
          </p>
        ) : null}

        <div className="space-y-2">
          <Label>Mode</Label>
          <div className="grid grid-cols-2 gap-2">
            <MobileFieldButton
              title="Drill"
              subtitle="Practice — recorded"
              tone="warning"
              active={mode === "drill"}
              onClick={() => setMode("drill")}
            />
            <MobileFieldButton
              title="LIVE"
              subtitle="Real incident"
              tone="danger"
              active={mode === "live"}
              onClick={() => setMode("live")}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Severity</Label>
          <div className="flex flex-wrap gap-2">
            {RYGE_SEVERITY_CHIPS.filter(
              (c) => c.value === "yellow" || c.value === "red",
            ).map((chip) => (
              <button
                key={chip.value}
                type="button"
                onClick={() => setSeverity(chip.value as EmergencySeverity)}
                className={cn(
                  "rounded-md border px-3 py-2 text-xs font-bold",
                  severity === chip.value ? chip.activeClass : chip.idleClass,
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        <CharacterCountedTextarea
          label="Situation (what is happening)"
          value={situation}
          onValueChange={setSituation}
          minChars={10}
          maxChars={500}
          rows={4}
          placeholder="Free text — e.g. fire drill, medical event, weather close…"
        />

        <PinEntryTrigger
          title="Manager PIN — activate"
          description="Confirms manager authorisation for Drill or Live activate."
          onVerify={async (pin) => {
            await verifyManagerPin(managerStaffId, pin);
          }}
          onSuccess={() => setPinVerified(true)}
          disabled={!canActivate || situation.trim().length < 10}
        >
          <Button
            type="button"
            variant={pinVerified ? "secondary" : "outline"}
            className="h-12 w-full"
            disabled={!canActivate || situation.trim().length < 10}
          >
            {pinVerified ? "Manager PIN verified" : "Verify Manager PIN"}
          </Button>
        </PinEntryTrigger>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            className={cn(
              "h-12 w-full gap-2 font-bold text-white disabled:opacity-40 sm:w-auto",
              mode === "live"
                ? "bg-red-600 hover:bg-red-700 disabled:bg-red-600"
                : "bg-amber-600 hover:bg-amber-700 disabled:bg-amber-600",
            )}
            disabled={!ready}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Siren className="h-4 w-4" />
            )}
            {mode === "drill" ? "Activate drill" : "Activate LIVE emergency"}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
