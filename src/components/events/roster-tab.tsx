import { useMemo, useState } from "react";
import { CircleDollarSign, Search, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useEventBookings } from "@/hooks/use-supabase-data";
import type { EventManifest, EventRosterBooking } from "@/lib/data-store";
import { AddRosterBookingModal } from "./add-roster-booking-modal";
import { RecordPaymentMilestoneModal } from "./record-payment-milestone-modal";

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
  const { data: bookings = [], isLoading, error } = useEventBookings(event.id);

  const filtered = useMemo(() => {
    const n = query.trim().toLowerCase();
    if (!n) return bookings;
    return bookings.filter((b) =>
      [b.participantName, b.bookingStatus, b.amountPaid.toFixed(2), b.isFullyPaid ? "paid" : "partial unpaid"]
        .join(" ")
        .toLowerCase()
        .includes(n),
    );
  }, [bookings, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Participant booking roster</h3>
          <p className="text-xs text-muted-foreground">
            {isLoading ? "Loading…" : `${bookings.length} participants on roster.`}
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="gap-1.5">
          <UserPlus className="h-4 w-4" />
          Add Participant to Roster
        </Button>
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
                  <th className="px-4 py-2 font-medium">Participant</th>
                  <th className="px-4 py-2 font-medium">Booking status</th>
                  <th className="px-4 py-2 text-right font-medium">Amount paid</th>
                  <th className="px-4 py-2 text-right font-medium">Balance</th>
                  <th className="px-4 py-2 text-right font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => {
                  const balance = event.ticketPrice - b.amountPaid;
                  const owes = balance > 0 && !b.isFullyPaid;
                  return (
                    <tr key={b.id} className="border-t border-border align-top">
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
                        {b.notes && (
                          <div className="mt-0.5 line-clamp-2 text-xs italic text-muted-foreground">
                            “{b.notes}”
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{b.bookingStatus}</td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums">
                        ${fmtMoney(b.amountPaid)}
                      </td>
                      <td
                        className={
                          "px-4 py-2 text-right font-semibold tabular-nums " +
                          (balance <= 0 ? "text-success" : "text-warning")
                        }
                      >
                        ${fmtMoney(Math.max(0, balance))}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <PaidBadge fullyPaid={b.isFullyPaid} />
                      </td>
                      <td className="px-4 py-2 text-right">
                        {owes ? (
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
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
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
        booking={milestoneBooking}
      />
    </div>
  );
}

function PaidBadge({ fullyPaid }: { fullyPaid: boolean }) {
  return fullyPaid ? (
    <span className="rounded-full bg-success px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
      Paid
    </span>
  ) : (
    <span className="rounded-full bg-warning px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
      Partial / Unpaid
    </span>
  );
}
