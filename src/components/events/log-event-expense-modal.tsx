import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LookupSelect } from "@/components/lookups/lookup-select";
import { VendorPicker } from "@/components/vendors/vendor-picker";
import { useInsertEventLedger, useVendors } from "@/hooks/use-supabase-data";
import {
  createVendor,
  findVendorByName,
  normalizeVendorName,
} from "@/lib/api/vendors";

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
  const qc = useQueryClient();
  const { data: vendors = [] } = useVendors();
  const [transactionDate, setTransactionDate] = useState(todayIso());
  const [vendor, setVendor] = useState("");
  const [financialCode, setFinancialCode] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [dirty, setDirty] = useState(false);
  const [createVendorPrompt, setCreateVendorPrompt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const mutation = useInsertEventLedger();

  useEffect(() => {
    if (open) {
      setTransactionDate(todayIso());
      setVendor("");
      setFinancialCode("");
      setAmount("");
      setDescription("");
      setDirty(false);
      setCreateVendorPrompt(null);
    }
  }, [open]);

  const amountNumber = Number(amount);
  const valid =
    transactionDate.length === 10 &&
    financialCode.trim().length > 0 &&
    description.trim().length > 0 &&
    Number.isFinite(amountNumber) &&
    amountNumber > 0;
  const canSubmit = dirty && valid && !mutation.isPending && !saving;

  async function logExpense(vendorName: string | null) {
    setSaving(true);
    try {
      await mutation.mutateAsync({
        eventId,
        transactionDate,
        description: description.trim(),
        amount: -Math.abs(amountNumber),
        financialCode,
        vendorName,
      });
      toast.success("Expense logged", {
        description: `${eventTitle} · −$${Math.abs(amountNumber).toFixed(2)}`,
      });
      onOpenChange(false);
    } catch {
      /* surfaced via hook onError */
    } finally {
      setSaving(false);
    }
  }

  async function addVendorAndLog(name: string) {
    setSaving(true);
    try {
      const created = await createVendor(name);
      qc.invalidateQueries({ queryKey: ["vendors"] });
      await logExpense(created.name);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not add vendor.";
      toast.error("Could not add vendor", { description: message });
      setSaving(false);
    }
  }

  const submit = async () => {
    if (!canSubmit) return;

    const vendorTrim = normalizeVendorName(vendor);
    if (!vendorTrim) {
      await logExpense(null);
      return;
    }

    const match = findVendorByName(vendors, vendorTrim);
    if (match) {
      await logExpense(match.name);
      return;
    }

    setCreateVendorPrompt(vendorTrim);
  };

  const mark = <T,>(fn: (v: T) => void) => (v: T) => {
    setDirty(true);
    fn(v);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg border-border bg-card">
          <DialogHeader>
            <DialogTitle>Log event expense</DialogTitle>
            <DialogDescription>
              {eventTitle} — negative amount posts to the event P&amp;L ledger.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
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
                  Amount ($)
                </Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => mark(setAmount)(e.target.value)}
                  placeholder="0.00"
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
              <VendorPicker
                value={vendor}
                onChange={(v) => mark(setVendor)(v)}
                vendors={vendors}
              />
              <p className="text-[11px] text-muted-foreground">
                Match MYOB supplier names. Manage the list in Admin → Vendors.
              </p>
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
              {mutation.isPending || saving ? "Saving…" : "Save Expense"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={createVendorPrompt !== null}
        onOpenChange={(next) => !next && setCreateVendorPrompt(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add vendor to list?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{createVendorPrompt}</span> is not in
              the vendor registry. Add it now so future expenses can pick it from the list? The
              expense will still be logged either way.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              disabled={saving}
              onClick={async () => {
                if (!createVendorPrompt) return;
                const name = createVendorPrompt;
                setCreateVendorPrompt(null);
                await logExpense(name);
              }}
            >
              Save without adding
            </Button>
            <AlertDialogAction
              disabled={saving}
              onClick={async (e) => {
                e.preventDefault();
                if (!createVendorPrompt) return;
                const name = createVendorPrompt;
                setCreateVendorPrompt(null);
                await addVendorAndLog(name);
              }}
            >
              Add &amp; save expense
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
