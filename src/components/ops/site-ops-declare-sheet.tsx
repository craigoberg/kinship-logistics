/**
 * BL-084 Phase B — Do-not-open / centre lockdown / trip programme suspend.
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import { verifyManagerPin } from "@/components/auth/pin-verify";
import { getActiveUserProfile, isActiveUserManager } from "@/lib/data-store";
import {
  declareCentreLockdown,
  declareDoNotOpenCentre,
  declareProgrammeSuspend,
  type EmergencySeverity,
} from "@/lib/api/operational-emergency";
import { SITE_SESSION_QUERY_KEY } from "@/hooks/use-site-session";
import { invalidateIssueCaches } from "@/lib/query/invalidation";
import { RYGE_SEVERITY_CHIPS } from "@/lib/ui/ryge-severity-chips";
import { cn, formatUnknownError } from "@/lib/utils";

export type SiteOpsKind = "do_not_open" | "lockdown" | "programme_suspend";

export function SiteOpsDeclareSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: SiteOpsKind;
  siteDaySessionId?: string;
  eventId?: string;
  eventDaySessionId?: string;
}) {
  const { open, onOpenChange, kind, siteDaySessionId, eventId, eventDaySessionId } =
    props;
  const qc = useQueryClient();
  const profile = getActiveUserProfile();
  const managerStaffId = profile?.staffId ?? "";
  const can = isActiveUserManager() && !!managerStaffId;

  const [severity, setSeverity] = useState<EmergencySeverity>("yellow");
  const [reason, setReason] = useState("");
  const [pinVerified, setPinVerified] = useState(false);

  useEffect(() => {
    if (!open) {
      setSeverity("yellow");
      setReason("");
      setPinVerified(false);
    }
  }, [open]);

  const titles: Record<SiteOpsKind, string> = {
    do_not_open: "Do not open centre",
    lockdown: "Lockdown / early close",
    programme_suspend: "Suspend programme",
  };

  const descriptions: Record<SiteOpsKind, string> = {
    do_not_open:
      "Centre stays closed for today. Free-text reason — weather, outbreak, etc.",
    lockdown:
      "Blocks new arrivals. Complete normal Day Centre close when everyone is accounted for.",
    programme_suspend:
      "Pauses hop / programme for this trip day until a manager clears it.",
  };

  const mut = useMutation({
    mutationFn: async () => {
      if (kind === "do_not_open") {
        if (!siteDaySessionId) throw new Error("Missing session.");
        await declareDoNotOpenCentre({
          siteDaySessionId,
          reason,
          severity,
          managerStaffId,
        });
      } else if (kind === "lockdown") {
        if (!siteDaySessionId) throw new Error("Missing session.");
        await declareCentreLockdown({
          siteDaySessionId,
          reason,
          severity,
          managerStaffId,
        });
      } else {
        if (!eventId || !eventDaySessionId) throw new Error("Missing event day.");
        await declareProgrammeSuspend({
          eventId,
          eventDaySessionId,
          reason,
          severity,
          managerStaffId,
        });
      }
    },
    onSuccess: () => {
      invalidateIssueCaches(qc);
      void qc.invalidateQueries({ queryKey: SITE_SESSION_QUERY_KEY });
      void qc.invalidateQueries({ queryKey: ["event-day-session"] });
      void qc.invalidateQueries({ queryKey: ["site-lockdown"] });
      void qc.invalidateQueries({ queryKey: ["programme-suspend"] });
      toast.success(titles[kind], { description: "Hub Health & Safety issue logged." });
      onOpenChange(false);
    },
    onError: (e: unknown) => {
      toast.error("Could not declare", { description: formatUnknownError(e) });
    },
  });

  const ready = can && pinVerified && reason.trim().length >= 10 && !mut.isPending;

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={titles[kind]}
      description={descriptions[kind]}
    >
      <div className="space-y-4 pb-4">
        {!can ? (
          <p className="text-sm text-muted-foreground">Manager profile required.</p>
        ) : null}

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
          label="Reason"
          value={reason}
          onValueChange={setReason}
          minChars={10}
          maxChars={500}
          rows={4}
          placeholder="Free text — why the site/programme cannot continue…"
        />

        <PinEntryTrigger
          title="Manager PIN"
          onVerify={async (pin) => {
            await verifyManagerPin(managerStaffId, pin);
          }}
          onSuccess={() => setPinVerified(true)}
          disabled={!can || reason.trim().length < 10}
        >
          <Button
            type="button"
            variant={pinVerified ? "secondary" : "outline"}
            className="h-12 w-full"
            disabled={!can || reason.trim().length < 10}
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
            className="h-12 w-full sm:w-auto"
            disabled={!ready}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Confirm
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
