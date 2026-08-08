import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Save } from "lucide-react";
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
import { DatePicker } from "@/components/ui/date-picker";
import { parseIsoDateLocal, toIsoDateString, cn } from "@/lib/utils";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import { VendorPicker } from "@/components/vendors/vendor-picker";
import {
  useInsertEventLedger,
  useUpdateEventLedger,
  useVendors,
} from "@/hooks/use-supabase-data";
import type { EventLedgerEntry } from "@/lib/data-store";
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
  /** When set, modal edits this expense instead of creating. */
  entry?: EventLedgerEntry | null;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function LogEventExpenseModal({
  open,
  onOpenChange,
  eventId,
  eventTitle,
  entry = null,
}: Props) {
  const isEdit = !!entry;
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
  const insertMut = useInsertEventLedger();
  const updateMut = useUpdateEventLedger();

  useEffect(() => {
    if (!open) return;
    if (entry) {
      setTransactionDate(entry.transactionDate.slice(0, 10));
      setVendor(entry.vendorName ?? "");
      setFinancialCode(entry.financialCode);
      setAmount(Math.abs(entry.amount).toFixed(2));
      setDescription(entry.description);
    } else {
      setTransactionDate(todayIso());
      setVendor("");
      setFinancialCode("");
      setAmount("");
      setDescription("");
    }
    setDirty(false);
    setCreateVendorPrompt(null);
  }, [open, entry]);

  const amountNumber = Number(amount);
  const dateInvalid = transactionDate.length !== 10;
  const codeInvalid = financialCode.trim().length === 0;
  const descInvalid = description.trim().length === 0;
  const amountInvalid = !Number.isFinite(amountNumber) || amountNumber <= 0;
  const valid = !dateInvalid && !codeInvalid && !descInvalid && !amountInvalid;
  const pending = insertMut.isPending || updateMut.isPending || saving;
  const canSubmit = dirty && valid && !pending;

  async function saveExpense(vendorName: string | null) {
    setSaving(true);
    try {
      const payload = {
        eventId,
        transactionDate,
        description: description.trim(),
        amount: -Math.abs(amountNumber),
        financialCode,
        vendorName,
      };
      if (isEdit && entry) {
        await updateMut.mutateAsync({ id: entry.id, ...payload });
        toast.success("Expense updated", {
          description: `${eventTitle} · −$${Math.abs(amountNumber).toFixed(2)}`,
        });
      } else {
        await insertMut.mutateAsync(payload);
        toast.success("Expense logged", {
          description: `${eventTitle} · −$${Math.abs(amountNumber).toFixed(2)}`,
        });
      }
      onOpenChange(false);
    } catch {
      /* surfaced via hook onError */
    } finally {
      setSaving(false);
    }
  }

  async function addVendorAndSave(name: string) {
    setSaving(true);
    try {
      const created = await createVendor(name);
      qc.invalidateQueries({ queryKey: ["vendors"] });
      await saveExpense(created.name);
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
      await saveExpense(null);
      return;
    }

    const match = findVendorByName(vendors, vendorTrim);
    if (match) {
      await saveExpense(match.name);
      return;
    }

    setCreateVendorPrompt(vendorTrim);
  };

  const mark = <T,>(fn: (v: T) => void) => (v: T) => {
    setDirty(true);
    fn(v);
  };

  const missing: string[] = [];
  if (dateInvalid) missing.push("Transaction date");
  if (amountInvalid) missing.push("Amount");
  if (codeInvalid) missing.push("Financial code");
  if (descInvalid) missing.push("Description");

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg border-border bg-card">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit event expense" : "Log event expense"}</DialogTitle>
            <DialogDescription>
              {eventTitle} — negative amount posts to the event P&amp;L ledger.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {!valid && dirty && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                Required: {missing.join(" · ")}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Transaction date
                </Label>
                <DatePicker
                  value={parseIsoDateLocal(transactionDate)}
                  onChange={(d) => mark(setTransactionDate)(d ? toIsoDateString(d) : "")}
                  dateFormat="dd-MMM-yy"
                  className={cn("h-9 text-sm", requiredFieldOutline(dateInvalid))}
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
                  className={requiredFieldOutline(amountInvalid)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Financial code
              </Label>
              <div className={cn(codeInvalid && "rounded-md ring-2 ring-destructive/60")}>
                <LookupSelect
                  category="financial_codes"
                  value={financialCode}
                  onChange={(code) => mark(setFinancialCode)(code)}
                  placeholder="Select financial code"
                />
              </div>
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
                className={requiredFieldOutline(descInvalid)}
              />
            </div>
          </div>

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button onClick={submit} disabled={!canSubmit} className="gap-1.5">
              {isEdit ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {pending ? "Saving…" : isEdit ? "Save changes" : "Save Expense"}
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
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              disabled={saving}
              onClick={async () => {
                if (!createVendorPrompt) return;
                const name = createVendorPrompt;
                setCreateVendorPrompt(null);
                await saveExpense(name);
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
                await addVendorAndSave(name);
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
