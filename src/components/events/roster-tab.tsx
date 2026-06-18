import { Fragment, useMemo, useState } from "react";
import { AlertTriangle, Bus, ChevronDown, ChevronRight, CircleDollarSign, HeartHandshake, Pencil, Search, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useEventBookings,
  useEventPaymentLedgerForEvent,
  useCarersRegistry,
} from "@/hooks/use-supabase-data";
import type { EventManifest, EventRosterBooking } from "@/lib/data-store";
import { AddRosterBookingModal } from "./add-roster-booking-modal";
import { RecordPaymentMilestoneModal } from "./record-payment-milestone-modal";
import { EditRosterBookingModal } from "./edit-roster-booking-modal";
import { BookingPaymentHistory } from "./booking-payment-history";
import { NoShowCountdownModal } from "@/components/attendance/no-show-countdown-modal";

interface Props {
  event: EventManifest;
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function RosterTab({ event }: Props) {
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [milestoneBooking, setMilestoneBooking] = useState<EventRosterBooking | null>(null);
  const [editBooking, setEditBooking] = useState<EventRosterBooking | null>(null);
  const [noShowFor, setNoShowFor] = useState<EventRosterBooking | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { data: bookings = [], isLoading, error } = useEventBookings(event.id);
  const { data: paymentLedger = [] } = useEventPaymentLedgerForEvent(event.id);
  const { data: carersAll = [] } = useCarersRegistry();

  const carersById = useMemo(() => {
    const m = new Map<string, (typeof carersAll)[number]>();
    carersAll.forEach((c) => m.set(c.id, c));
    return m;
  }, [carersAll]);

  const activeBookings = useMemo(
    () => bookings.filter((b) => b.bookingStatus !== "Cancelled"),
    [bookings],
  );
  const totalSeatsOccupied =
    activeBookings.length +
    activeBookings.filter((b) => b.carerTransportRequired).length;
  const carerSeats = activeBookings.filter((b) => b.carerTransportRequired).length;

  const ledgerTotalsByParticipant = useMemo(() => {
    return paymentLedger.reduce((totals, entry) => {
      const next = (totals.get(entry.participantId) ?? 0) + entry.amount;
      totals.set(entry.participantId, Number(next.toFixed(2)));
      return totals;
    }, new Map<string, number>());
  }, [paymentLedger]);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const n = query.trim().toLowerCase();
    if (!n) return bookings;
    return bookings.filter((b) =>
      [
        b.participantName,
        b.bookingStatus,
        (ledgerTotalsByParticipant.get(b.participantId) ?? 0).toFixed(2),
      ]
        .join(" ")
        .toLowerCase()
        .includes(n),
    );
  }, [bookings, ledgerTotalsByParticipant, query]);

  const milestoneBookingWithLedger = useMemo(() => {
    if (!milestoneBooking) return null;
    const netLedgerSum = ledgerTotalsByParticipant.get(milestoneBooking.participantId) ?? 0;
    const baselineCost = milestoneBooking.customPrice ?? event.ticketPrice;
    const trueBalance = milestoneBooking.bookingStatus === "Cancelled" ? 0 : baselineCost - netLedgerSum;
    return { ...milestoneBooking, amountPaid: netLedgerSum, isFullyPaid: trueBalance <= 0 };
  }, [event.ticketPrice, ledgerTotalsByParticipant, milestoneBooking]);

  const editBookingWithLedger = useMemo(() => {
    if (!editBooking) return null;
    const netLedgerSum = ledgerTotalsByParticipant.get(editBooking.participantId) ?? 0;
    const baselineCost = editBooking.customPrice ?? event.ticketPrice;
    const trueBalance = editBooking.bookingStatus === "Cancelled" ? 0 : baselineCost - netLedgerSum;
    return { ...editBooking, amountPaid: netLedgerSum, isFullyPaid: trueBalance <= 0 };
  }, [editBooking, event.ticketPrice, ledgerTotalsByParticipant]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Participant booking roster</h3>
          <p className="text-xs text-muted-foreground">
            {isLoading ? "Loading…" : `${bookings.length} participants on roster.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-card/60 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-foreground">
            <Bus className="h-3.5 w-3.5 text-info" />
            Bus seats: <span className="tabular-nums text-info">{totalSeatsOccupied}</span>
            <span className="text-muted-foreground">
              ({activeBookings.length} pax + {carerSeats} carer{carerSeats === 1 ? "" : "s"})
            </span>
          </div>
          <Button onClick={() => setAddOpen(true)} className="gap-1.5">
            <UserPlus className="h-4 w-4" />
            Add Participant to Roster
          </Button>
        </div>
      </div>

      <div className="relative w-full sm:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, status, balance…"
          className="h-9 pl-9"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading roster…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          <Users className="mx-auto mb-2 h-5 w-5" />
          {query ? `No bookings match "${query}".` : "No participants on this roster yet."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <TooltipProvider delayDuration={200}>
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-8 px-2 py-2"></th>
                  <th className="px-4 py-2 font-medium">Participant</th>
                  <th className="px-4 py-2 font-medium">Booking status</th>
                  <th className="px-4 py-2 text-right font-medium">Booking cost</th>
                  <th className="px-4 py-2 text-right font-medium">Total paid</th>
                  <th className="px-4 py-2 text-right font-medium">Net balance</th>
                  <th className="px-4 py-2 text-right font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => {
                  const baselineCost = b.customPrice ?? event.ticketPrice;
                  const netLedgerSum = ledgerTotalsByParticipant.get(b.participantId) ?? 0;
                  const trueBalance = b.bookingStatus === "Cancelled" ? 0 : baselineCost - netLedgerSum;
                  const owes = b.bookingStatus !== "Cancelled" && trueBalance > 0;
                  const isOpen = expanded.has(b.id);
                  return (
                    <Fragment key={b.id}>
                      <tr className="border-t border-border align-top">
                        <td className="px-2 py-2 align-middle">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => toggleExpanded(b.id)}
                            className="h-6 w-6 text-muted-foreground"
                            aria-label={isOpen ? "Collapse payment history" : "Expand payment history"}
                            aria-expanded={isOpen}
                          >
                            {isOpen ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        </td>
                        <td className="px-4 py-2">
                          <div className="font-medium">
                            {b.participantName}
                            {b.notes && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="ml-1.5 cursor-help text-[10px] uppercase tracking-wide text-info">
                                    ⓘ
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">{b.notes}</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                          {b.bringsCarer && (
                            <div className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-info">
                              <HeartHandshake className="h-3 w-3" />
                              +1 Carer: {(b.carerId && carersById.get(b.carerId)?.fullName) || "Unassigned"}
                              {b.carerTransportRequired && (
                                <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-info/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                                  <Bus className="h-3 w-3" /> seat
                                </span>
                              )}
                            </div>
                          )}
                          {b.notes && (
                            <div className="mt-0.5 line-clamp-2 text-xs italic text-muted-foreground">
                              “{b.notes}”
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{b.bookingStatus}</td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums">
                          ${fmtMoney(baselineCost)}
                          {b.customPrice != null && b.customPrice !== event.ticketPrice && (
                            <span className="ml-1 text-[10px] uppercase tracking-wide text-info">
                              custom
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums">
                          ${fmtMoney(netLedgerSum)}
                        </td>
                        <td
                          className={
                            "px-4 py-2 text-right font-semibold tabular-nums " +
                            (b.bookingStatus === "Cancelled"
                              ? "text-muted-foreground"
                              : trueBalance <= 0
                                ? "text-success"
                                : "text-warning")
                          }
                        >
                          ${fmtMoney(b.bookingStatus === "Cancelled" ? 0 : Math.max(0, trueBalance))}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <PaidBadge
                            baselineCost={baselineCost}
                            netLedgerSum={netLedgerSum}
                            trueBalance={trueBalance}
                            bookingStatus={b.bookingStatus}
                          />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {owes && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => setMilestoneBooking(b)}
                                    className="h-7 w-7 text-success hover:text-success"
                                    aria-label="Record payment milestone"
                                  >
                                    <CircleDollarSign className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Record Payment Milestone</TooltipContent>
                              </Tooltip>
                            )}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => setEditBooking(b)}
                                  className="h-7 w-7 text-info hover:text-info"
                                  aria-label="Edit booking"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Edit Booking</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => setNoShowFor(b)}
                                  className="h-7 w-7 text-destructive hover:text-destructive"
                                  aria-label="Trigger no-show countdown"
                                >
                                  <AlertTriangle className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Trigger No-Show Countdown</TooltipContent>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-t border-border/40 bg-muted/10">
                          <td></td>
                          <td colSpan={7} className="p-0">
                            <BookingPaymentHistory
                              participantId={b.participantId}
                              eventId={event.id}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </TooltipProvider>
        </div>
      )}

      <AddRosterBookingModal
        open={addOpen}
        onOpenChange={setAddOpen}
        event={event}
        existingBookings={bookings}
      />

      <RecordPaymentMilestoneModal
        open={milestoneBooking !== null}
        onOpenChange={(o) => !o && setMilestoneBooking(null)}
        event={event}
        booking={milestoneBookingWithLedger}
      />

      <EditRosterBookingModal
        open={editBooking !== null}
        onOpenChange={(o) => !o && setEditBooking(null)}
        booking={editBookingWithLedger}
        eventTitle={event.title}
        eventTicketPrice={event.ticketPrice}
      />

      {noShowFor && (
        <NoShowCountdownModal
          open={true}
          onOpenChange={(o) => !o && setNoShowFor(null)}
          participantId={noShowFor.participantId}
          participantName={noShowFor.participantName}
        />
      )}
    </div>
  );
}

function PaidBadge({
  baselineCost,
  netLedgerSum,
  trueBalance,
  bookingStatus,
}: {
  baselineCost: number;
  netLedgerSum: number;
  trueBalance: number;
  bookingStatus: string;
}) {
  if (bookingStatus === "Cancelled") {
    return (
      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-700 dark:bg-slate-800 dark:text-slate-300">
        Cancelled / Balanced
      </span>
    );
  }
  const balanceCents = Math.round(trueBalance * 100);
  const baselineCents = Math.round(baselineCost * 100);
  const paidCents = Math.round(netLedgerSum * 100);
  if (balanceCents <= 0) {
    return (
      <span className="rounded-full bg-success px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
        Paid
      </span>
    );
  }
  if (balanceCents === baselineCents || paidCents <= 0) {
    return (
      <span className="rounded-full bg-destructive px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
        Unpaid
      </span>
    );
  }
  return (
    <span className="rounded-full bg-warning px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
      Partial
    </span>
  );
}
