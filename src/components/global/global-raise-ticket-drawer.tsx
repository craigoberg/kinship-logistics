/**
 * GlobalRaiseTicketDrawer — BL-116
 *
 * Green companion to Incident / Fault. Available on every signed-in screen.
 */
import { useEffect } from "react";
import { Ticket } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";

import { RaiseTicketDialog } from "./raise-ticket-dialog";
import { useTicketSurface } from "@/lib/app-tickets/ticket-surface";
import { cn } from "@/lib/utils";

export function GlobalRaiseTicketDrawer() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const ticket = useTicketSurface();
  const onManifest = pathname.startsWith("/manifest");

  useEffect(() => {
    ticket.setUiEnabled(true);
    return () => ticket.setUiEnabled(false);
    // setUiEnabled is a stable useState setter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerPos = onManifest
    ? "fixed right-28 top-14 z-40 md:right-32 md:top-[4.25rem]"
    : "fixed bottom-40 right-4 z-40 md:bottom-24 md:right-6";

  const label = ticket.activeFormTitle
    ? `Ticket: ${ticket.activeFormTitle}`
    : "Raise ticket";

  return (
    <>
      <button
        type="button"
        data-ticket-chrome
        aria-label="Raise an app ticket"
        onClick={() => ticket.requestRaise()}
        className={cn(
          triggerPos,
          "flex max-w-[14rem] items-center gap-2 rounded-full border-2 border-emerald-500/80 bg-emerald-600/90 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-lg shadow-emerald-900/30 backdrop-blur transition hover:bg-emerald-600 md:text-sm",
        )}
      >
        <Ticket className="h-4 w-4 shrink-0" />
        <span className="truncate">{label}</span>
      </button>

      <RaiseTicketDialog
        open={ticket.raiseOpen}
        onOpenChange={ticket.setRaiseOpen}
      />
    </>
  );
}
