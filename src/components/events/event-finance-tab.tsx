import { useMemo, useState } from "react";
import { Plus, Search, BadgeDollarSign, Wallet, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEventBookings, useEventLedger } from "@/hooks/use-supabase-data";
import { formatDate } from "@/lib/utils";
import type { EventManifest } from "@/lib/data-store";
import { LogEventExpenseModal } from "./log-event-expense-modal";

interface Props {
  event: EventManifest;
}

function fmtMoney(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `(${abs})` : abs;
}

export function EventFinanceTab({ event }: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: bookings = [] } = useEventBookings(event.id);
  const { data: ledger = [], isLoading, error } = useEventLedger(event.id);

  const revenue = useMemo(
    () => bookings.reduce((s, b) => s + b.amountPaid, 0),
    [bookings],
  );
  const expenses = useMemo(
    () =>
      ledger.reduce((s, e) => (e.amount < 0 ? s + e.amount : s), 0), // negative sum
    [ledger],
  );
  const net = revenue + expenses;

  const filtered = useMemo(() => {
    const n = query.trim().toLowerCase();
    if (!n) return ledger;
    return ledger.filter((e) =>
      [e.transactionDate, e.description, e.financialCode, e.vendorName ?? "", e.amount.toFixed(2)]
        .join(" ")
        .toLowerCase()
        .includes(n),
    );
  }, [ledger, query]);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Ticket revenue"
          value={`$${fmtMoney(revenue)}`}
          icon={<BadgeDollarSign className="h-4 w-4" />}
        />
        <SummaryCard
          label="Vendor expenses"
          value={`$${fmtMoney(expenses)}`}
          tone="expense"
          icon={<Wallet className="h-4 w-4" />}
        />
        <SummaryCard
          label="Net P&L"
          value={`${net < 0 ? "−" : ""}$${fmtMoney(Math.abs(net))}`}
          tone={net >= 0 ? "positive" : "negative"}
          icon={<TrendingUp className="h-4 w-4" />}
          emphasis
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search vendor, code, description…"
            className="h-9 pl-9"
          />
        </div>
        <Button onClick={() => setAddOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Log Event Expense
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading ledger…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          {query ? `No ledger rows match "${query}".` : "No expenses logged yet."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Vendor</th>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const negative = e.amount < 0;
                return (
                  <tr key={e.id} className="border-t border-border align-top">
                    <td className="whitespace-nowrap px-4 py-2 font-medium tabular-nums">
                      {formatDate(e.transactionDate)}
                    </td>
                    <td className="px-4 py-2">{e.vendorName || "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">
                      {e.financialCode}
                    </td>
                    <td className="px-4 py-2">{e.description}</td>
                    <td
                      className={
                        "whitespace-nowrap px-4 py-2 text-right font-semibold tabular-nums " +
                        (negative ? "text-destructive" : "text-success")
                      }
                    >
                      ${fmtMoney(e.amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <LogEventExpenseModal
        open={addOpen}
        onOpenChange={setAddOpen}
        eventId={event.id}
        eventTitle={event.title}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
  emphasis,
  icon,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "expense";
  emphasis?: boolean;
  icon?: React.ReactNode;
}) {
  const valueClass =
    tone === "negative"
      ? "text-destructive"
      : tone === "expense"
        ? "text-warning"
        : "text-white";
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div
        className={
          "mt-1 tabular-nums " +
          (emphasis ? "text-2xl font-bold " : "text-xl font-semibold ") +
          valueClass
        }
      >
        {value}
      </div>
    </div>
  );
}
