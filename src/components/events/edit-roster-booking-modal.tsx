import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Save, AlertTriangle, TrendingDown, MapPin, RefreshCw, HeartPulse } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useUpdateEventBooking,
  useCarersForParticipant,
  useUpdateParticipant,
  useRefreshBookingSnapshot,
} from "@/hooks/use-supabase-data";
import type { EventRosterBooking } from "@/lib/data-store";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: EventRosterBooking | null;
  eventTitle?: string;
  eventTicketPrice?: number;
}

const STATUS_OPTIONS = ["Confirmed", "Waitlisted", "Cancelled"] as const;

function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function EditRosterBookingModal({
  open,
  onOpenChange,
  booking,
  eventTitle,
  eventTicketPrice = 0,
}: Props) {
  const [bookingStatus, setBookingStatus] = useState<string>("Confirmed");
  const [notes, setNotes] = useState("");
  const [dirty, setDirty] = useState(false);
  const [issueRefund, setIssueRefund] = useState(true);
  const [refundAmount, setRefundAmount] = useState<string>("0");
  const [refundDate, setRefundDate] = useState<string>(todayISO());
  const [amendedPrice, setAmendedPrice] = useState<string>("0");
  const [bringsCarer, setBringsCarer] = useState(false);
  const [carerId, setCarerId] = useState<string>("");
  const [carerTransport, setCarerTransport] = useState(false);
  const [participantTransport, setParticipantTransport] = useState(false);
  const [permanentAddress, setPermanentAddress] = useState<string>("");
  const [tripPickupOverride, setTripPickupOverride] = useState<string>("");
  const mutation = useUpdateEventBooking();
  const updateParticipant = useUpdateParticipant();
  const refreshSnapshot = useRefreshBookingSnapshot();
  const { data: carers = [] } = useCarersForParticipant(booking?.participantId ?? null);

  const collected = booking?.amountPaid ?? 0;

  useEffect(() => {
    if (open && booking) {
      setBookingStatus(booking.bookingStatus || "Confirmed");
      setNotes(booking.notes ?? "");
      setDirty(false);
      setIssueRefund(collected > 0);
      setRefundAmount(collected > 0 ? collected.toFixed(2) : "0");
      setRefundDate(todayISO());
      setAmendedPrice(Number(booking.customPrice ?? eventTicketPrice ?? 0).toFixed(2));
      setBringsCarer(!!booking.bringsCarer);
      setCarerId(booking.carerId ?? "");
      setCarerTransport(!!booking.carerTransportRequired);
      setParticipantTransport(!!booking.participantTransportRequired);
      setPermanentAddress(booking.participantRegularPickupAddress ?? "");
      setTripPickupOverride(booking.tripPickupAddressOverride ?? "");
    }
  }, [open, booking, collected, eventTicketPrice]);

  useEffect(() => {
    if (bringsCarer && !carerId && carers.length > 0) {
      const primary = carers.find((c) => c.isPrimaryContact) ?? carers[0];
      setCarerId(primary.id);
    }
  }, [bringsCarer, carerId, carers]);

  const showRefundPanel = bookingStatus === "Cancelled" && collected > 0;
  const parsedRefund = useMemo(() => {
    const n = Number(refundAmount);
    return Number.isFinite(n) ? n : 0;
  }, [refundAmount]);
  const parsedAmended = useMemo(() => {
    const n = Number(amendedPrice);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [amendedPrice]);

  const refundInvalid =
    showRefundPanel && issueRefund && (parsedRefund <= 0 || parsedRefund > collected);
  const priceChanged = Math.abs(parsedAmended - Number(eventTicketPrice ?? 0)) > 0.001;
  const remainingBalance = Math.max(0, parsedAmended - collected);
  const overpaymentDelta = Math.max(0, collected - parsedAmended);
  const isCaseB = !showRefundPanel && priceChanged && parsedAmended < collected;

  if (!booking) return null;

  const canSubmit =
    dirty && !mutation.isPending && bookingStatus.length > 0 && !refundInvalid;

  const submit = async () => {
    if (!canSubmit) return;
    try {
      const willRefund = showRefundPanel && issueRefund && parsedRefund > 0;

      // Persist the participant-profile permanent pickup address change
      // (if any) BEFORE the booking update so the join read on the booking
      // refetch reflects the new value.
      const newPermanent = permanentAddress.trim();
      const originalPermanent = (booking.participantRegularPickupAddress ?? "").trim();
      if (newPermanent !== originalPermanent) {
        try {
          await updateParticipant.mutateAsync({
            id: booking.participantId,
            patch: { regularPickupAddress: newPermanent.length > 0 ? newPermanent : null },
          });
        } catch (e) {
          // Surface, but don't block the rest of the save.
          console.error("[edit-roster-booking-modal] permanent address save failed", e);
        }
      }

      const newOverride = tripPickupOverride.trim();
      const originalOverride = (booking.tripPickupAddressOverride ?? "").trim();
      const overrideChanged = newOverride !== originalOverride;

      const result = await mutation.mutateAsync({
        bookingId: booking.id,
        bookingStatus,
        notes: notes.trim() ? notes.trim() : null,
        amendedPrice: priceChanged ? parsedAmended : null,
        currentAmountPaid: collected,
        eventId: booking.eventId,
        eventTitle: eventTitle ?? "Event",
        participantId: booking.participantId,
        refund: willRefund
          ? {
              amount: parsedRefund,
              date: refundDate,
              eventId: booking.eventId,
              eventTitle: eventTitle ?? "Event",
              participantId: booking.participantId,
            }
          : null,
        bringsCarer,
        carerId: bringsCarer ? carerId || null : null,
        carerTransportRequired: bringsCarer ? carerTransport : false,
        participantTransportRequired: participantTransport,
        tripPickupAddressOverride: overrideChanged
          ? newOverride.length > 0
            ? newOverride
            : null
          : undefined,
      });
      toast.success("Booking updated", {
        description: result.refundLedger
          ? `${booking.participantName} → Cancelled · Refund $${fmtMoney(parsedRefund)} posted`
          : result.priceAdjustmentLedger
            ? `${booking.participantName} → Price amended · Credit $${fmtMoney(overpaymentDelta)} posted`
            : `${booking.participantName} → ${bookingStatus}`,
      });
      onOpenChange(false);
    } catch {
      /* raw error surfaced via hook onError toast */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden border-border bg-card">
        <DialogHeader className="shrink-0">
          <DialogTitle>Edit booking</DialogTitle>
          <DialogDescription>
            Update <strong>{booking.participantName}</strong>'s booking status, cost and billing notes.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 flex-1 overflow-y-auto px-6">
          <div className="space-y-3 pt-1">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Booking status
            </Label>
            <Select
              value={bookingStatus}
              onValueChange={(v) => {
                setBookingStatus(v);
                setDirty(true);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* ----- Amend Booking Cost ----- */}
          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Amend Booking Cost ($)
              </Label>
              <span className="text-[10px] text-muted-foreground">
                Event default: ${fmtMoney(Number(eventTicketPrice ?? 0))}
              </span>
            </div>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={amendedPrice}
              onChange={(e) => {
                setAmendedPrice(e.target.value);
                setDirty(true);
              }}
              className="bg-background tabular-nums"
            />
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded bg-background/60 px-2 py-1">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Collected
                </div>
                <div className="font-bold tabular-nums">${fmtMoney(collected)}</div>
              </div>
              <div
                className={
                  "rounded px-2 py-1 " +
                  (isCaseB
                    ? "bg-success/20 text-success-foreground"
                    : "bg-background/60")
                }
              >
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {isCaseB ? "Overpayment credit" : "Balance owing"}
                </div>
                <div className="font-bold tabular-nums">
                  ${fmtMoney(isCaseB ? overpaymentDelta : remainingBalance)}
                </div>
              </div>
            </div>
            {isCaseB && (
              <div className="flex items-start gap-1.5 rounded bg-success/10 px-2 py-1.5 text-[11px] text-success-foreground">
                <TrendingDown className="mt-0.5 h-3.5 w-3.5" />
                <span>
                  Price below collected total — <code>amount_paid</code> will cap to{" "}
                  <strong>${fmtMoney(parsedAmended)}</strong> and a negative{" "}
                  <strong>${fmtMoney(overpaymentDelta)}</strong> credit will post to the ledger.
                </span>
              </div>
            )}
          </div>

          {showRefundPanel && (
            <div className="space-y-3 rounded-lg border-2 border-destructive/60 bg-destructive/10 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
                  <div>
                    <div className="text-sm font-bold text-destructive">
                      Issue Refund for Collected Funds
                    </div>
                    <div className="text-[11px] text-destructive/80">
                      Total Collected to Date:{" "}
                      <span className="font-bold tabular-nums">${fmtMoney(collected)}</span>
                    </div>
                  </div>
                </div>
                <Switch
                  checked={issueRefund}
                  onCheckedChange={(v) => {
                    setIssueRefund(v);
                    setDirty(true);
                  }}
                />
              </div>

              {issueRefund && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] font-semibold uppercase tracking-wide text-destructive">
                      Refund Amount ($)
                    </Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max={collected}
                      value={refundAmount}
                      onChange={(e) => {
                        setRefundAmount(e.target.value);
                        setDirty(true);
                      }}
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] font-semibold uppercase tracking-wide text-destructive">
                      Refund Date
                    </Label>
                    <Input
                      type="date"
                      value={refundDate}
                      onChange={(e) => {
                        setRefundDate(e.target.value);
                        setDirty(true);
                      }}
                      className="bg-background"
                    />
                  </div>
                  {refundInvalid && (
                    <div className="col-span-2 text-[11px] font-medium text-destructive">
                      Refund must be &gt; $0 and ≤ ${fmtMoney(collected)}.
                    </div>
                  )}
                  <div className="col-span-2 text-[11px] text-destructive/80">
                    Posts a negative <code>participant_financial_ledger</code> row and zeros{" "}
                    <code>amount_paid</code> on the booking.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ----- Transport logistics ----- */}
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 p-3">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Client requires bus transport?
            </Label>
            <Switch
              checked={participantTransport}
              onCheckedChange={(v) => {
                setParticipantTransport(v);
                setDirty(true);
              }}
            />
          </div>

          {/* ----- Carer companion ----- */}
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Carer attending event?
              </Label>
              <Switch
                checked={bringsCarer}
                onCheckedChange={(v) => {
                  setBringsCarer(v);
                  if (!v) {
                    setCarerId("");
                    setCarerTransport(false);
                  }
                  setDirty(true);
                }}
              />
            </div>
            {bringsCarer && (
              <>
                <Select
                  value={carerId || undefined}
                  onValueChange={(v) => {
                    setCarerId(v);
                    setDirty(true);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        carers.length === 0
                          ? "No carers registered for this participant"
                          : "Select carer"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {carers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.fullName}
                        {c.isPrimaryContact ? " · Primary" : ""}
                        {c.relationship ? ` · ${c.relationship}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Carer requires bus transport seat?
                  </Label>
                  <Switch
                    checked={carerTransport}
                    onCheckedChange={(v) => {
                      setCarerTransport(v);
                      setDirty(true);
                    }}
                  />
                </div>
              </>
            )}
          </div>

          {/* ----- Pickup addresses (coordinator overrides) ----- */}
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" /> Pickup addresses
            </div>

            <div className="space-y-1">
              <Label htmlFor="permanent-addr" className="text-[11px] font-medium text-muted-foreground">
                Regular pickup address
              </Label>
              <Input
                id="permanent-addr"
                value={permanentAddress}
                placeholder="e.g. 12 Sunrise Cres, Bondi NSW 2026"
                onChange={(e) => {
                  setPermanentAddress(e.target.value);
                  setDirty(true);
                }}
              />
              <p className="text-[10px] text-muted-foreground">
                Saved to participant profile — used on every future event.
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="override-addr" className="text-[11px] font-medium text-muted-foreground">
                One-off pickup override (this event only)
              </Label>
              <Input
                id="override-addr"
                value={tripPickupOverride}
                placeholder="Leave blank to use the permanent address"
                onChange={(e) => {
                  setTripPickupOverride(e.target.value);
                  setDirty(true);
                }}
              />
              <p className="text-[10px] text-muted-foreground">
                Overrides permanent address for this event's manifest only.
              </p>
            </div>
          </div>

          {/* ----- Frozen medical alerts snapshot ----- */}
          <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                <HeartPulse className="h-3.5 w-3.5" /> Medical alerts snapshot
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                disabled={refreshSnapshot.isPending}
                onClick={() =>
                  refreshSnapshot.mutate(
                    {
                      bookingId: booking.id,
                      participantId: booking.participantId,
                      eventId: booking.eventId,
                    },
                    {
                      onSuccess: () => toast.success("Medical snapshot refreshed"),
                    },
                  )
                }
              >
                <RefreshCw className={"h-3.5 w-3.5 " + (refreshSnapshot.isPending ? "animate-spin" : "")} />
                Re-snapshot
              </Button>
            </div>
            {booking.dynamicMedicalNotesSnapshot && booking.dynamicMedicalNotesSnapshot.trim().length > 0 ? (
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-background/60 p-2 font-mono text-[11px] leading-snug text-foreground">
                {booking.dynamicMedicalNotesSnapshot}
              </pre>
            ) : (
              <p className="text-[11px] italic text-muted-foreground">
                No critical alerts captured. Click "Re-snapshot" to rebuild from the compliance &amp; medication tables.
              </p>
            )}
          </div>




          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Notes / Billing arrangements
            </Label>
            <Textarea
              rows={4}
              value={notes}
              placeholder="Billing arrangement, payment plan, ability-to-pay context…"
              onChange={(e) => {
                setNotes(e.target.value);
                setDirty(true);
              }}
            />
          </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-border pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={submit} disabled={!canSubmit} className="gap-1.5">
            <Save className="h-4 w-4" />
            {mutation.isPending ? "Saving…" : "Save booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
