import { useMemo, useState } from "react";
import { Plus, Search, Wallet, BadgeDollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useParticipantLedger } from "@/hooks/use-supabase-data";
import { formatDate } from "@/lib/utils";
import { LogLedgerEntryModal } from "./log-ledger-entry-modal";
import { ParticipantRegisteredEvents } from "@/components/participants/participant-registered-events";

interface Props {
  participantId: string;
  participantName: string;
}

function fmtMoney(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `(${abs})` : abs;
}

function cleanDescription(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/\[[a-z_]+:[0-9a-f-]{8,}\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([—–-])\s*$/, "")
    .trim();
}

export function FinanceTab({ participantId, participantName }: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: entries = [], isLoading, error } = useParticipantLedger(participantId);

  const summary = useMemo(() => {
    let charges = 0;
    let paid = 0;
    for (const e of entries) {
      if (e.amount >= 0) charges += e.amount;
      else paid += e.amount;
    }
    return { charges, paid, outstanding: charges + paid };
  }, [entries]);

  const filtered = useMemo(() => {
    const n = query.trim().toLowerCase();
    if (!n) return entries;
    return entries.filter((e) =>
      [
        e.transactionDate,
        e.financialCode,
        e.description,
        e.amount.toString(),
        e.isReconciled ? "reconciled paid ndis" : "pending unpaid",
      ]
        .join(" ")
        .toLowerCase()
        .includes(n),
    );
  }, [entries, query]);

  return (
    <div className="space-y-5">
      {/* ===== Header + Add ===== */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Finance &amp; Ledger</h3>
          <p className="text-xs text-muted-foreground">
            Running NDIS &amp; fee statement for {participantName}.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Log Manual Charge/Credit
        </Button>
      </div>

      {/* ===== Account Balance Summary ===== */}
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Total charges"
          value={fmtMoney(summary.charges)}
          tone="charges"
          icon={<BadgeDollarSign className="h-4 w-4" />}
        />
        <SummaryCard
          label="Total reconciled / paid"
          value={fmtMoney(summary.paid)}
          tone="paid"
          icon={<Wallet className="h-4 w-4" />}
        />
        <SummaryCard
          label="Outstanding balance"
          value={fmtMoney(summary.outstanding)}
          tone="outstanding"
          emphasis
        />
      </div>

      {/* ===== Search ===== */}
      <div className="relative w-full sm:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search code, description, status…"
          className="h-9 pl-9"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {(error as Error).message}
        </div>
      )}

      {/* ===== Ledger Table ===== */}
      {isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          Loading ledger…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          <Wallet className="mx-auto mb-2 h-5 w-5" />
          {query
            ? `No ledger entries match "${query}".`
            : "No ledger entries yet."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Status</th>
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
                    <td className="px-4 py-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">
                      {e.financialCode}
                    </td>
                    <td className="px-4 py-2">{cleanDescription(e.description) || "—"}</td>
                    <td
                      className={
                        "whitespace-nowrap px-4 py-2 text-right font-semibold tabular-nums " +
                        (negative ? "text-success" : "text-white")
                      }
                    >
                      {fmtMoney(e.amount)}
                    </td>
                    <td className="px-4 py-2">
                      <ReconciliationBadge reconciled={e.isReconciled} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className="text-xs text-muted-foreground">—</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ParticipantRegisteredEvents participantId={participantId} />


      <LogLedgerEntryModal
        open={addOpen}
        onOpenChange={setAddOpen}
        participantId={participantId}
        participantName={participantName}
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
  tone: "charges" | "paid" | "outstanding";
  emphasis?: boolean;
  icon?: React.ReactNode;
}) {
  const valueClass =
    tone === "paid"
      ? "text-success"
      : tone === "outstanding"
        ? "text-white"
        : "text-foreground";
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

function ReconciliationBadge({ reconciled }: { reconciled: boolean }) {
  return reconciled ? (
    <span className="rounded-full bg-success px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
      Reconciled
    </span>
  ) : (
    <span className="rounded-full bg-warning px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
      Pending
    </span>
  );
}
