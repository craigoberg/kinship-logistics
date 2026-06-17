import { useEventPaymentLedger } from "@/hooks/use-supabase-data";
import { formatDate } from "@/lib/utils";

interface Props {
  participantId: string;
  eventId: string;
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Strip the internal "[event:<uuid>]" marker we embed in the description. */
function cleanDescription(d: string): string {
  return d.replace(/\s*\[event:[^\]]+\]\s*$/i, "").trim() || "—";
}

export function BookingPaymentHistory({ participantId, eventId }: Props) {
  const { data: entries = [], isLoading, error } = useEventPaymentLedger(
    participantId,
    eventId,
  );

  if (isLoading) {
    return (
      <div className="px-6 py-3 text-xs text-muted-foreground">Loading payment history…</div>
    );
  }
  if (error) {
    return (
      <div className="mx-6 my-3 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
        {(error as Error).message}
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="px-6 py-3 text-xs italic text-muted-foreground">
        No recorded payment milestones for this booking yet.
      </div>
    );
  }

  return (
    <div className="border-l-2 border-info/40 bg-muted/30 px-6 py-3">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Payment milestone history ({entries.length})
      </h4>
      <table className="w-full text-xs">
        <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="py-1.5 pr-3 font-medium">Payment date</th>
            <th className="py-1.5 pr-3 text-right font-medium">Amount paid ($)</th>
            <th className="py-1.5 font-medium">Receipt reference / description</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-t border-border/60">
              <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">
                {formatDate(e.transactionDate)}
              </td>
              <td className="whitespace-nowrap py-1.5 pr-3 text-right font-semibold tabular-nums text-success">
                ${fmtMoney(e.amount)}
              </td>
              <td className="py-1.5 text-muted-foreground">{cleanDescription(e.description)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
