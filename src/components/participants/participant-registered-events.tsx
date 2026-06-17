import { useState } from "react";
import { CalendarRange, CircleDollarSign, Pencil, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useEventBookingsForParticipant } from "@/hooks/use-supabase-data";
import { formatDate } from "@/lib/utils";
import type { EventBookingWithEvent, EventManifest, EventRosterBooking } from "@/lib/data-store";
import { RecordPaymentMilestoneModal } from "@/components/events/record-payment-milestone-modal";
import { EditRosterBookingModal } from "@/components/events/edit-roster-booking-modal";

interface Props {
  participantId: string;
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Build a minimal EventManifest from a joined booking row so the shared
 * RecordPaymentMilestoneModal can be reused without a second event fetch. */
function synthEvent(r: EventBookingWithEvent): EventManifest {
  return {
    id: r.eventId,
    title: r.eventTitle,
    eventTypeCode: "",
    venue: "",
    startDate: r.eventStartDate,
    endDate: r.eventEndDate || null,
    ticketPrice: r.eventTicketPrice,
    description: null,
    active: true,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toBooking(r: EventBookingWithEvent): EventRosterBooking {
  return {
    id: r.id,
    eventId: r.eventId,
    participantId: r.participantId,
    participantName: r.participantName,
    bookingStatus: r.bookingStatus,
    amountPaid: r.amountPaid,
    isFullyPaid: r.isFullyPaid,
    notes: r.notes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function ParticipantRegisteredEvents({ participantId }: Props) {
  const { data: rows = [], isLoading, error } = useEventBookingsForParticipant(participantId);
  const [milestoneRow, setMilestoneRow] = useState<EventBookingWithEvent | null>(null);
  const [editRow, setEditRow] = useState<EventBookingWithEvent | null>(null);

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card/40 p-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <CalendarRange className="h-4 w-4 text-info" />
            Registered Events &amp; Excursions
          </h3>
          <p className="text-xs text-muted-foreground">
            Live join of <code>event_roster_bookings</code> ↔ <code>event_manifest</code> for this participant.
          </p>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {isLoading ? "…" : `${rows.length} booking${rows.length === 1 ? "" : "s"}`}
        </span>
      </header>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <div className="py-6 text-center text-sm text-muted-foreground">Loading bookings…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
          <Ticket className="mx-auto mb-2 h-5 w-5" />
          Not booked into any events yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <TooltipProvider delayDuration={200}>
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Start date</th>
                  <th className="px-3 py-2 font-medium">Booking status</th>
                  <th className="px-3 py-2 font-medium">Notes</th>
                  <th className="px-3 py-2 text-right font-medium">Fee</th>
                  <th className="px-3 py-2 text-right font-medium">Paid</th>
                  <th className="px-3 py-2 text-right font-medium">Balance</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const balance = r.bookingStatus === "Cancelled" ? 0 : Math.max(0, r.eventTicketPrice - r.amountPaid);
                  const owes = r.bookingStatus !== "Cancelled" && balance > 0 && !r.isFullyPaid;
                  return (
                    <tr key={r.id} className="border-t border-border align-top">
                      <td className="px-3 py-2 font-medium">{r.eventTitle}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                        {r.eventStartDate ? formatDate(r.eventStartDate) : "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.bookingStatus}</td>
                      <td className="px-3 py-2 text-xs italic text-muted-foreground">
                        {r.notes ? `“${r.notes}”` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        ${fmtMoney(r.eventTicketPrice)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        ${fmtMoney(r.amountPaid)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <BalanceBadge fullyPaid={r.isFullyPaid} balance={balance} bookingStatus={r.bookingStatus} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {owes && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => setMilestoneRow(r)}
                                  className="h-7 w-7 text-success hover:text-success"
                                  aria-label="Record payment"
                                >
                                  <CircleDollarSign className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Record Payment</TooltipContent>
                            </Tooltip>
                          )}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => setEditRow(r)}
                                className="h-7 w-7 text-info hover:text-info"
                                aria-label="Edit booking"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Edit Booking</TooltipContent>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TooltipProvider>
        </div>
      )}

      <RecordPaymentMilestoneModal
        open={milestoneRow !== null}
        onOpenChange={(o) => !o && setMilestoneRow(null)}
        event={milestoneRow ? synthEvent(milestoneRow) : ({} as EventManifest)}
        booking={milestoneRow ? toBooking(milestoneRow) : null}
      />

      <EditRosterBookingModal
        open={editRow !== null}
        onOpenChange={(o) => !o && setEditRow(null)}
        booking={editRow ? toBooking(editRow) : null}
        eventTitle={editRow?.eventTitle}
        eventTicketPrice={editRow?.eventTicketPrice ?? 0}
      />
    </section>
  );
}

function BalanceBadge({ fullyPaid, balance, bookingStatus }: { fullyPaid: boolean; balance: number; bookingStatus: string }) {
  if (bookingStatus === "Cancelled") {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:bg-slate-800 dark:text-slate-300">
        Cancelled / Balanced
      </span>
    );
  }
  if (fullyPaid || balance <= 0) {
    return (
      <span className="rounded-full bg-success px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
        Paid
      </span>
    );
  }
  return (
    <span className="rounded-full bg-warning px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white tabular-nums">
      ${balance.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} due
    </span>
  );
}
