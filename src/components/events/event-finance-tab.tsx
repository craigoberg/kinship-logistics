import { useMemo, useState } from "react";
import { Plus, Search, BadgeDollarSign, Wallet, TrendingUp, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconActionButton } from "@/components/ui/icon-action-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useDeleteEventLedger,
  useEventLedger,
  useEventPaymentLedgerForEvent,
} from "@/hooks/use-supabase-data";
import { isEventFinanceLocked, summarizeEventFinance } from "@/lib/data-store";
import type { EventLedgerEntry, EventManifest } from "@/lib/data-store";
import { formatDate } from "@/lib/utils";
import { LogEventExpenseModal } from "./log-event-expense-modal";
import { TooltipProvider } from "@/components/ui/tooltip";

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
  const financeLocked = isEventFinanceLocked(event);
  const [addOpen, setAddOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<EventLedgerEntry | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<EventLedgerEntry | null>(null);
  const [query, setQuery] = useState("");
  const { data: ledger = [], isLoading, error } = useEventLedger(event.id);
  const { data: paymentLedger = [] } = useEventPaymentLedgerForEvent(event.id);
  const deleteMut = useDeleteEventLedger();

  const { revenue, expenses, net } = useMemo(() => {
    const totals = summarizeEventFinance(paymentLedger, ledger);
    return {
      revenue: totals.ticketRevenue,
      expenses: totals.vendorExpenses,
      net: totals.netPnl,
    };
  }, [paymentLedger, ledger]);

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
      {financeLocked && (
        <div className="rounded-lg border border-muted bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Billing locked — this event is Closed. Expenses are read-only.
        </div>
      )}

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
        <Button
          onClick={() => setAddOpen(true)}
          className="gap-1.5"
          disabled={financeLocked}
          title={financeLocked ? "Billing locked" : undefined}
        >
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
        <TooltipProvider>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Vendor</th>
                  <th className="px-4 py-2 font-medium">Code</th>
                  <th className="px-4 py-2 font-medium">Description</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
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
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <IconActionButton
                            tooltip="Edit expense"
                            disabled={financeLocked || deleteMut.isPending}
                            className="h-8 w-8 text-info"
                            onClick={() => setEditEntry(e)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </IconActionButton>
                          <IconActionButton
                            tooltip="Delete expense"
                            disabled={financeLocked || deleteMut.isPending}
                            className="h-8 w-8 text-destructive"
                            onClick={() => setDeleteEntry(e)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </IconActionButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TooltipProvider>
      )}

      <LogEventExpenseModal
        open={addOpen}
        onOpenChange={setAddOpen}
        eventId={event.id}
        eventTitle={event.title}
      />

      <LogEventExpenseModal
        open={editEntry !== null}
        onOpenChange={(o) => !o && setEditEntry(null)}
        eventId={event.id}
        eventTitle={event.title}
        entry={editEntry}
      />

      <AlertDialog
        open={deleteEntry !== null}
        onOpenChange={(o) => !o && setDeleteEntry(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteEntry
                ? `${formatDate(deleteEntry.transactionDate)} · ${deleteEntry.description} · $${fmtMoney(deleteEntry.amount)}. This cannot be undone.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMut.isPending}
              onClick={async (ev) => {
                ev.preventDefault();
                if (!deleteEntry) return;
                try {
                  await deleteMut.mutateAsync({
                    id: deleteEntry.id,
                    eventId: event.id,
                  });
                  toast.success("Expense deleted");
                  setDeleteEntry(null);
                } catch {
                  /* hook toast */
                }
              }}
            >
              {deleteMut.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
