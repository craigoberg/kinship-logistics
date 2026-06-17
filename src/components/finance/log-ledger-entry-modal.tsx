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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LookupSelect } from "@/components/lookups/lookup-select";
import { useInsertLedgerEntry } from "@/hooks/use-supabase-data";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participantId: string;
  participantName: string;
}

type Direction = "charge" | "credit";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Manual entry for `participant_financial_ledger`. Charges are stored as
 * positive amounts, payments/credits as negative — matches the running
 * balance contract used by the Finance & Ledger tab.
 */
export function LogLedgerEntryModal({
  open,
  onOpenChange,
  participantId,
  participantName,
}: Props) {
  const [transactionDate, setTransactionDate] = useState(todayIso());
  const [financialCode, setFinancialCode] = useState("");
  const [direction, setDirection] = useState<Direction>("charge");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [dirty, setDirty] = useState(false);
  const mutation = useInsertLedgerEntry();

  useEffect(() => {
    if (open) {
      setTransactionDate(todayIso());
      setFinancialCode("");
      setDirection("charge");
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
    const signed = direction === "credit" ? -Math.abs(amountNumber) : Math.abs(amountNumber);
    try {
      await mutation.mutateAsync({
        participantId,
        transactionDate,
        financialCode,
        description: description.trim(),
        amount: signed,
      });
      toast.success("Transaction saved", {
        description: `${participantName} · ${direction === "credit" ? "Credit" : "Charge"} of $${Math.abs(signed).toFixed(2)}.`,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error("Could not save transaction", {
        description: (err as Error).message,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle>Log manual charge / credit</DialogTitle>
          <DialogDescription>
            One ledger entry for {participantName}. Use credit to record a
            payment, reconciliation, or refund.
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
                onChange={(e) => {
                  setTransactionDate(e.target.value);
                  setDirty(true);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Direction
              </Label>
              <Select
                value={direction}
                onValueChange={(v) => {
                  setDirection(v as Direction);
                  setDirty(true);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="charge">Charge (+)</SelectItem>
                  <SelectItem value="credit">Credit / Payment (−)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Financial code
            </Label>
            <LookupSelect
              category="financial_codes"
              value={financialCode}
              onChange={(code) => {
                setFinancialCode(code);
                setDirty(true);
              }}
              placeholder="Select financial code"
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
              onChange={(e) => {
                setAmount(e.target.value);
                setDirty(true);
              }}
              placeholder="0.00"
              className="tabular-nums"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Description
            </Label>
            <Textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setDirty(true);
              }}
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
            {mutation.isPending ? "Saving…" : "Save Transaction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
