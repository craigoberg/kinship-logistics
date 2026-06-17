import { CalendarRange, Ticket } from "lucide-react";
import { useEventBookingsForParticipant } from "@/hooks/use-supabase-data";
import { formatDate } from "@/lib/utils";

interface Props {
  participantId: string;
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ParticipantRegisteredEvents({ participantId }: Props) {
  const { data: rows = [], isLoading, error } = useEventBookingsForParticipant(participantId);

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
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">Start date</th>
                <th className="px-3 py-2 font-medium">Booking status</th>
                <th className="px-3 py-2 text-right font-medium">Fee</th>
                <th className="px-3 py-2 text-right font-medium">Paid</th>
                <th className="px-3 py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const balance = Math.max(0, r.eventTicketPrice - r.amountPaid);
                return (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-medium">{r.eventTitle}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                      {r.eventStartDate ? formatDate(r.eventStartDate) : "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.bookingStatus}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      ${fmtMoney(r.eventTicketPrice)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      ${fmtMoney(r.amountPaid)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <BalanceBadge fullyPaid={r.isFullyPaid} balance={balance} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function BalanceBadge({ fullyPaid, balance }: { fullyPaid: boolean; balance: number }) {
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
