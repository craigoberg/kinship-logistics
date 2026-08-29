/**
 * GlobalIncidentIntakeDrawer — GUARDRAILS §13.1
 *
 * The global INCIDENT / FAULT button. Mounted on every screen. Context is
 * harvested from the current URL, localStorage, and today's site session.
 * Third lane (Health & Safety) opens GlobalHealthSafetyFlow — not an incident write.
 */
import { useMemo, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";
import { useSiteSession } from "@/hooks/use-site-session";
import { IncidentIntakeDialog } from "./incident-intake-dialog";
import { GlobalHealthSafetyFlow } from "./global-health-safety-flow";
import { DraggableFab } from "./draggable-fab";
import { useGlobalFabsHidden, useHideGlobalFabs } from "@/lib/ui/global-fab-visibility";

/**
 * Harvest app context from the current URL and localStorage.
 * The event modal writes yada.activeEventId + yada.activeEventTitle when open.
 */
function useHarvestedContext(): {
  vehicleId?: string;
  eventId?: string;
  eventTitle?: string;
  eventDaySessionId?: string;
  siteDaySessionId?: string;
  siteDayPhase?: string;
  pathLabel: string;
} {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const siteSessionQ = useSiteSession();

  return useMemo(() => {
    const ls = typeof window !== "undefined" ? window.localStorage : null;
    const siteDaySessionId = siteSessionQ.data?.id;
    const siteDayPhase = siteSessionQ.data?.phase;

    if (pathname.startsWith("/day")) {
      return {
        siteDaySessionId,
        siteDayPhase,
        pathLabel: "Day Centre",
      };
    }

    if (pathname.startsWith("/manifest")) {
      const vehicleId = ls?.getItem("yada.activeVehicleId") ?? undefined;
      const eventId = ls?.getItem("yada.activeEventId") ?? undefined;
      const eventDaySessionId =
        ls?.getItem("yada.activeEventDaySessionId") ?? undefined;
      return {
        vehicleId,
        eventId,
        eventDaySessionId,
        siteDaySessionId,
        siteDayPhase,
        pathLabel: "Driver manifest",
      };
    }

    if (pathname.startsWith("/events") || pathname.startsWith("/event-deliver")) {
      const eventId = ls?.getItem("yada.activeEventId") ?? undefined;
      const eventTitle = ls?.getItem("yada.activeEventTitle") ?? undefined;
      const eventDaySessionId =
        ls?.getItem("yada.activeEventDaySessionId") ?? undefined;
      return {
        eventId,
        eventTitle,
        eventDaySessionId,
        siteDaySessionId,
        siteDayPhase,
        pathLabel: eventTitle ? `Event: ${eventTitle}` : "Event Deliver",
      };
    }

    if (pathname.startsWith("/transport")) {
      return {
        siteDaySessionId,
        siteDayPhase,
        pathLabel: "Transport",
      };
    }

    return {
      siteDaySessionId,
      siteDayPhase,
      pathLabel: "Dashboard",
    };
  }, [pathname, siteSessionQ.data?.id, siteSessionQ.data?.phase]);
}

export function GlobalIncidentIntakeDrawer() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const ctx = useHarvestedContext();
  const [open, setOpen] = useState(false);
  const [healthSafetyOpen, setHealthSafetyOpen] = useState(false);
  const onManifest = pathname.startsWith("/manifest");
  const fabsHidden = useGlobalFabsHidden();
  useHideGlobalFabs(open || healthSafetyOpen);

  const defaultClassName = onManifest
    ? "fixed right-28 top-3 z-[60] md:right-32 md:top-4"
    : "fixed bottom-24 right-4 z-[60] md:bottom-8 md:right-6";

  return (
    <>
      <DraggableFab
        id="incident"
        hidden={fabsHidden}
        defaultClassName={defaultClassName}
        ariaLabel="Raise an incident, fault, or Health and Safety action"
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center gap-2 rounded-full border-2 border-red-500/80 bg-red-600/90 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-lg shadow-red-900/30 backdrop-blur transition hover:bg-red-600 md:text-sm",
        )}
      >
        <AlertTriangle className="h-4 w-4" />
        Incident / Fault
      </DraggableFab>

      <IncidentIntakeDialog
        open={open}
        onOpenChange={setOpen}
        context={ctx}
        onHealthSafety={() => {
          setOpen(false);
          window.setTimeout(() => setHealthSafetyOpen(true), 120);
        }}
      />

      <GlobalHealthSafetyFlow
        open={healthSafetyOpen}
        onOpenChange={setHealthSafetyOpen}
        context={ctx}
      />
    </>
  );
}
