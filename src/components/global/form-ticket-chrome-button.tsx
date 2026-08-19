import { Ticket } from "lucide-react";

import { useOptionalTicketSurface } from "@/lib/app-tickets/ticket-surface";
import { cn } from "@/lib/utils";

/** Compact GREEN ticket control inside Dialog / Sheet chrome (BL-116). */
export function FormTicketChromeButton({ className }: { className?: string }) {
  const ticket = useOptionalTicketSurface();
  if (!ticket?.uiEnabled) return null;

  return (
    <button
      type="button"
      data-ticket-chrome
      aria-label="Raise a ticket about this form"
      onClick={() => ticket.requestRaise()}
      className={cn(
        "absolute right-12 top-3 z-[1] inline-flex items-center gap-1 rounded-full border-2 border-emerald-500/80 bg-emerald-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm transition hover:bg-emerald-500",
        className,
      )}
    >
      <Ticket className="h-3.5 w-3.5" />
      Ticket
    </button>
  );
}
