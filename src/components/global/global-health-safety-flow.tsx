/**
 * Global Health & Safety flow — Big Red third lane (GUARDRAILS §13.2).
 * Opens manager ops sheet; does NOT write an INCIDENT row.
 */
import { useState } from "react";
import { Lock, ShieldAlert, Siren } from "lucide-react";
import { toast } from "sonner";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { ManagerOpsChip } from "@/components/ui/manager-ops-chip";
import { EmergencyActivateSheet } from "@/components/ops/emergency-activate-sheet";
import { SiteOpsDeclareSheet } from "@/components/ops/site-ops-declare-sheet";
import { InfectiousExclusionSheet } from "@/components/site-day/infectious-exclusion-sheet";
import { isActiveUserManager } from "@/lib/data-store";
import type { EmergencySurface } from "@/lib/api/operational-emergency";
import type { SiteOpsKind } from "@/components/ops/site-ops-declare-sheet";

export type HealthSafetyContext = {
  pathLabel: string;
  siteDaySessionId?: string | null;
  siteDayPhase?: string | null;
  eventId?: string | null;
  eventDaySessionId?: string | null;
};

export function GlobalHealthSafetyFlow(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: HealthSafetyContext;
}) {
  const { open, onOpenChange, context } = props;
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [siteHoldOpen, setSiteHoldOpen] = useState(false);
  const [exclusionOpen, setExclusionOpen] = useState(false);

  const hasCentre = !!context.siteDaySessionId;
  const hasTrip = !!context.eventId && !!context.eventDaySessionId;
  const surface: EmergencySurface = hasCentre
    ? "centre"
    : hasTrip
      ? "trip"
      : "manifest";

  const siteHoldKind: SiteOpsKind | null = hasCentre
    ? context.siteDayPhase === "open_pending" ||
      context.siteDayPhase === "checks_in_progress"
      ? "do_not_open"
      : "lockdown"
    : hasTrip
      ? "programme_suspend"
      : null;

  const siteHoldLabel =
    siteHoldKind === "do_not_open"
      ? "Do not open centre today"
      : siteHoldKind === "lockdown"
        ? "Lockdown / early close"
        : siteHoldKind === "programme_suspend"
          ? "Suspend programme"
          : null;

  const pick = (fn: () => void) => {
    onOpenChange(false);
    window.setTimeout(fn, 150);
  };

  const requireManager = (fn: () => void) => {
    if (!isActiveUserManager()) {
      toast.message("Manager profile required", {
        description: "Health & Safety declare / activate needs a manager session.",
      });
      return;
    }
    pick(fn);
  };

  return (
    <>
      <BottomSheet
        open={open}
        onOpenChange={onOpenChange}
        title="Health & Safety"
        description={`Context: ${context.pathLabel}. Emergency / site hold / infectious — not an INCIDENT log.`}
      >
        <div className="flex flex-col gap-2 pb-4">
          <ManagerOpsChip
            tone="emergency"
            layout="stack"
            onClick={() => requireManager(() => setEmergencyOpen(true))}
          >
            <Siren className="h-4 w-4" />
            Emergency / drill
          </ManagerOpsChip>

          {siteHoldKind && siteHoldLabel ? (
            <ManagerOpsChip
              tone="caution"
              layout="stack"
              onClick={() => requireManager(() => setSiteHoldOpen(true))}
            >
              <Lock className="h-4 w-4" />
              {siteHoldLabel}
            </ManagerOpsChip>
          ) : (
            <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
              Site hold (lockdown / do-not-open / suspend) needs an open Day
              Centre session or trip day. Emergency / drill still works here.
            </p>
          )}

          {(hasCentre || hasTrip) ? (
            <ManagerOpsChip
              tone="caution"
              layout="stack"
              onClick={() => requireManager(() => setExclusionOpen(true))}
            >
              <ShieldAlert className="h-4 w-4" />
              Infectious exclusion
            </ManagerOpsChip>
          ) : (
            <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
              Infectious exclusion needs Day Centre or Event Deliver context.
            </p>
          )}
        </div>
      </BottomSheet>

      <EmergencyActivateSheet
        open={emergencyOpen}
        onOpenChange={setEmergencyOpen}
        surface={surface}
        siteDaySessionId={context.siteDaySessionId}
        eventId={context.eventId}
        eventDaySessionId={context.eventDaySessionId}
      />

      {siteHoldKind === "do_not_open" && context.siteDaySessionId ? (
        <SiteOpsDeclareSheet
          open={siteHoldOpen}
          onOpenChange={setSiteHoldOpen}
          kind="do_not_open"
          siteDaySessionId={context.siteDaySessionId}
        />
      ) : null}
      {siteHoldKind === "lockdown" && context.siteDaySessionId ? (
        <SiteOpsDeclareSheet
          open={siteHoldOpen}
          onOpenChange={setSiteHoldOpen}
          kind="lockdown"
          siteDaySessionId={context.siteDaySessionId}
        />
      ) : null}
      {siteHoldKind === "programme_suspend" &&
      context.eventId &&
      context.eventDaySessionId ? (
        <SiteOpsDeclareSheet
          open={siteHoldOpen}
          onOpenChange={setSiteHoldOpen}
          kind="programme_suspend"
          eventId={context.eventId}
          eventDaySessionId={context.eventDaySessionId}
        />
      ) : null}

      {hasCentre ? (
        <InfectiousExclusionSheet
          open={exclusionOpen}
          onOpenChange={setExclusionOpen}
          surface="centre"
          siteDaySessionId={context.siteDaySessionId!}
        />
      ) : null}
      {hasTrip && !hasCentre ? (
        <InfectiousExclusionSheet
          open={exclusionOpen}
          onOpenChange={setExclusionOpen}
          surface="trip"
          eventId={context.eventId!}
          eventDaySessionId={context.eventDaySessionId!}
        />
      ) : null}
    </>
  );
}
