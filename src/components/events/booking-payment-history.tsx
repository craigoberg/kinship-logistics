import { useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  useDeleteEventPaymentMilestone,
  useEventPaymentLedger,
  useUpdateEventPaymentMilestone,
} from "@/hooks/use-supabase-data";
import type { EventRosterBooking, LedgerEntry } from "@/lib/data-store";
import { formatDate, parseIsoDateLocal, toIsoDateString, cn } from "@/lib/utils";
import { IconActionButton } from "@/components/ui/icon-action-button";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { requiredFieldOutline } from "@/lib/ui/required-field";

interface Props {
  participantId: string;
  eventId: string;
  eventTitle: string;
  booking: EventRosterBooking;
  ticketBaseline: number;
  financeWritable: boolean;
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Strip the internal "[event:<uuid>]" marker we embed in the description. */
function cleanDescription(d: string): string {
  return d.replace(/\s*\[event:[^\]]+\]\s*$/i, "").trim() || "—";
}

export function BookingPaymentHistory({
  participantId,
  eventId,
  eventTitle,
  booking,
  ticketBaseline,
  financeWritable,
}: Props) {
  const { data: entries = [], isLoading, error } = useEventPaymentLedger(
    participantId,
    eventId,
  );
  const updateMut = useUpdateEventPaymentMilestone();
  const deleteMut = useDeleteEventPaymentMilestone();
  const [editRow, setEditRow] = useState<LedgerEntry | null>(null);
  const [deleteRow, setDeleteRow] = useState<LedgerEntry | null>(null);

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
      <div className="mx-6 my-3 rounded-lg border border-dashed bg-muted/30 py-4 text-center text-xs text-muted-foreground">
        No recorded payment milestones for this booking yet.
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="border-l-2 border-info/40 bg-muted/30 px-6 py-3">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Payment milestone history ({entries.length})
        </h4>
        <table className="w-full text-xs">
          <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="py-1.5 pr-3 font-medium">Payment date</th>
              <th className="py-1.5 pr-3 text-right font-medium">Amount ($)</th>
              <th className="py-1.5 font-medium">Receipt reference / description</th>
              {financeWritable && (
                <th className="py-1.5 pl-2 text-right font-medium">Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const isRefund = e.financialCode === "EVENT_REFUND" || e.amount < 0;
              return (
                <tr key={e.id} className="border-t border-border/60">
                  <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">
                    {formatDate(e.transactionDate)}
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap py-1.5 pr-3 text-right font-semibold tabular-nums",
                      isRefund ? "text-destructive" : "text-success",
                    )}
                  >
                    {isRefund ? "−" : ""}${fmtMoney(Math.abs(e.amount))}
                  </td>
                  <td className="py-1.5 text-muted-foreground">
                    {cleanDescription(e.description)}
                    {isRefund && (
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-destructive/80">
                        refund
                      </span>
                    )}
                  </td>
                  {financeWritable && (
                    <td className="py-1.5 pl-2 text-right">
                      <div className="inline-flex items-center justify-end gap-0.5">
                        <IconActionButton
                          tooltip="Edit payment"
                          className="h-8 w-8 text-info"
                          onClick={() => setEditRow(e)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </IconActionButton>
                        <IconActionButton
                          tooltip="Delete payment"
                          className="h-8 w-8 text-destructive"
                          onClick={() => setDeleteRow(e)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconActionButton>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <EditPaymentMilestoneDialog
        open={editRow !== null}
        onOpenChange={(o) => !o && setEditRow(null)}
        entry={editRow}
        booking={booking}
        eventId={eventId}
        eventTitle={eventTitle}
        ticketBaseline={ticketBaseline}
        pending={updateMut.isPending}
        onSave={async (input) => {
          await updateMut.mutateAsync(input);
          toast.success("Payment updated");
          setEditRow(null);
        }}
      />

      <AlertDialog open={deleteRow !== null} onOpenChange={(o) => !o && setDeleteRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this payment line?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteRow
                ? `${formatDate(deleteRow.transactionDate)} · ${cleanDescription(deleteRow.description)} · $${fmtMoney(Math.abs(deleteRow.amount))}. Booking paid total will be recalculated.`
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
                if (!deleteRow) return;
                try {
                  await deleteMut.mutateAsync({
                    ledgerId: deleteRow.id,
                    bookingId: booking.id,
                    eventId,
                    participantId,
                    ticketPrice: ticketBaseline,
                  });
                  toast.success("Payment deleted");
                  setDeleteRow(null);
                } catch {
                  /* hook */
                }
              }}
            >
              {deleteMut.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}

function EditPaymentMilestoneDialog({
  open,
  onOpenChange,
  entry,
  booking,
  eventId,
  eventTitle,
  ticketBaseline,
  pending,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: LedgerEntry | null;
  booking: EventRosterBooking;
  eventId: string;
  eventTitle: string;
  ticketBaseline: number;
  pending: boolean;
  onSave: (input: {
    ledgerId: string;
    bookingId: string;
    eventId: string;
    eventTitle: string;
    participantId: string;
    ticketPrice: number;
    transactionDate: string;
    amount: number;
    financialCode: "EVENT_PMT" | "EVENT_REFUND";
    description: string;
  }) => Promise<void>;
}) {
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [code, setCode] = useState<"EVENT_PMT" | "EVENT_REFUND">("EVENT_PMT");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open || !entry) return;
    setDate(entry.transactionDate.slice(0, 10));
    setAmount(Math.abs(entry.amount).toFixed(2));
    setCode(
      entry.financialCode === "EVENT_REFUND" || entry.amount < 0
        ? "EVENT_REFUND"
        : "EVENT_PMT",
    );
    setDescription(cleanDescription(entry.description));
  }, [open, entry]);

  const amountNum = Number(amount);
  const amountInvalid = !Number.isFinite(amountNum) || amountNum <= 0;
  const dateInvalid = date.length !== 10;
  const descInvalid = description.trim().length === 0;
  const valid = !amountInvalid && !dateInvalid && !descInvalid;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle>Edit payment milestone</DialogTitle>
          <DialogDescription>
            {booking.participantName} · {eventTitle}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!valid && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Amount, date, and description are required.
            </div>
          )}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Type
            </Label>
            <Select
              value={code}
              onValueChange={(v) => setCode(v as "EVENT_PMT" | "EVENT_REFUND")}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EVENT_PMT">Payment</SelectItem>
                <SelectItem value="EVENT_REFUND">Refund</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Amount (AUD)
            </Label>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={cn("tabular-nums", requiredFieldOutline(amountInvalid))}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Date
            </Label>
            <DatePicker
              value={parseIsoDateLocal(date)}
              onChange={(d) => setDate(d ? toIsoDateString(d) : "")}
              dateFormat="dd-MMM-yy"
              className={cn("h-9 text-sm", requiredFieldOutline(dateInvalid))}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Description
            </Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={requiredFieldOutline(descInvalid)}
            />
          </div>
        </div>
        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            disabled={!valid || pending || !entry}
            onClick={async () => {
              if (!entry || !valid) return;
              await onSave({
                ledgerId: entry.id,
                bookingId: booking.id,
                eventId,
                eventTitle,
                participantId: booking.participantId,
                ticketPrice: ticketBaseline,
                transactionDate: date,
                amount: amountNum,
                financialCode: code,
                description: description.trim(),
              });
            }}
          >
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
