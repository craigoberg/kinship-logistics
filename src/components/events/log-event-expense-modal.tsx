import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LookupSelect } from "@/components/lookups/lookup-select";
import { useInsertEventLedger } from "@/hooks/use-supabase-data";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  eventTitle: string;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function LogEventExpenseModal({ open, onOpenChange, eventId, eventTitle }: Props) {
  const [transactionDate, setTransactionDate] = useState(todayIso());
  const [vendor, setVendor] = useState("");
  const [financialCode, setFinancialCode] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [dirty, setDirty] = useState(false);
  const mutation = useInsertEventLedger();

  useEffect(() => {
    if (open) {
      setTransactionDate(todayIso());
      setVendor("");
      setFinancialCode("");
      setAmount("");
      setDescription("");
      setDirty(false);
    }
  }, [open]);

  const amountNumber = Number(amount);
  const valid =
    transactionDate.length === 10 &&
    financialCode.trim().length > 0 &&
    description.trim().length > 0 &&
    Number.isFinite(amountNumber) &&
    amountNumber > 0;
  const canSubmit = dirty && valid && !mutation.isPending;

  const submit = async () => {
    if (!canSubmit) return;
    try {
      await mutation.mutateAsync({
        eventId,
        transactionDate,
        description: description.trim(),
        amount: -Math.abs(amountNumber),  // expenses stored as negative
        financialCode,
        vendorName: vendor.trim() || null,
      });
      toast.success("Expense logged", {
        description: `${eventTitle} · −$${Math.abs(amountNumber).toFixed(2)}`,
      });
      onOpenChange(false);
    } catch {
      /* surfaced via hook onError */
    }
  };

  const mark = <T,>(fn: (v: T) => void) => (v: T) => {
    setDirty(true);
    fn(v);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle>Log event expense</DialogTitle>
          <DialogDescription>
            Saved as a negative row on <span className="font-mono">event_financial_ledger</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Transaction date
              </Label>
              <Input
                type="date"
                value={transactionDate}
                onChange={(e) => mark(setTransactionDate)(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Amount (AUD)
              </Label>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => mark(setAmount)(e.target.value)}
                placeholder="0.00"
                className="tabular-nums"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Financial code
            </Label>
            <LookupSelect
              category="financial_codes"
              value={financialCode}
              onChange={(code) => mark(setFinancialCode)(code)}
              placeholder="Select financial code"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Vendor (optional)
            </Label>
            <Input
              value={vendor}
              onChange={(e) => mark(setVendor)(e.target.value)}
              placeholder="e.g. Acme Catering"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Description
            </Label>
            <Textarea
              value={description}
              onChange={(e) => mark(setDescription)(e.target.value)}
              rows={3}
              placeholder="Short description shown on the ledger row…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit} className="gap-1.5">
            <Plus className="h-4 w-4" />
            {mutation.isPending ? "Saving…" : "Save Expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
