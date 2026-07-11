/**
 * GlobalIncidentIntakeDrawer — GUARDRAILS §13.1
 *
 * The global INCIDENT / FAULT button. Mounted on every screen. Context is
 * harvested from the current URL and localStorage so the reporter never has
 * to re-enter event / vehicle identifiers.
 */
import { useMemo, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";
import { IncidentIntakeDialog } from "./incident-intake-dialog";

/**
 * Harvest app context from the current URL and localStorage.
 * The event modal writes yada.activeEventId + yada.activeEventTitle when open.
 */
function useHarvestedContext(): {
  vehicleId?: string;
  eventId?: string;
  eventTitle?: string;
  eventDaySessionId?: string;
  pathLabel: string;
} {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return useMemo(() => {
    const ls = typeof window !== "undefined" ? window.localStorage : null;

    if (pathname.startsWith("/manifest")) {
      const vehicleId = ls?.getItem("yada.activeVehicleId") ?? undefined;
      return { vehicleId, pathLabel: "Driver manifest" };
    }

    if (pathname.startsWith("/events")) {
      const eventId = ls?.getItem("yada.activeEventId") ?? undefined;
      const eventTitle = ls?.getItem("yada.activeEventTitle") ?? undefined;
      const eventDaySessionId = ls?.getItem("yada.activeEventDaySessionId") ?? undefined;
      return {
        eventId,
        eventTitle,
        eventDaySessionId,
        pathLabel: eventTitle ? `Event: ${eventTitle}` : "Events",
      };
    }

    if (pathname.startsWith("/transport")) {
      return { pathLabel: "Transport" };
    }

    return { pathLabel: "Dashboard" };
  }, [pathname]);
}

export function GlobalIncidentIntakeDrawer() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const ctx = useHarvestedContext();
  const [open, setOpen] = useState(false);
  const onManifest = pathname.startsWith("/manifest");

  const triggerPos = onManifest
    ? "fixed right-28 top-3 z-40 md:right-32 md:top-4"
    : "fixed bottom-24 right-4 z-40 md:bottom-8 md:right-6";

  return (
    <>
      <button
        type="button"
        aria-label="Raise an incident or fault"
        onClick={() => setOpen(true)}
        className={cn(
          triggerPos,
          "flex items-center gap-2 rounded-full border-2 border-red-500/80 bg-red-600/90 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-lg shadow-red-900/30 backdrop-blur transition hover:bg-red-600 md:text-sm",
        )}
      >
        <AlertTriangle className="h-4 w-4" />
        Incident / Fault
      </button>

      <IncidentIntakeDialog
        open={open}
        onOpenChange={setOpen}
        context={ctx}
      />
    </>
  );
}
