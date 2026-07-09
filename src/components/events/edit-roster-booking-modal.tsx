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
  useRefreshBookingSnapshot,
} from "@/hooks/use-supabase-data";
import type { EventRosterBooking } from "@/lib/data-store";
import { updateBookingTransportModes, updateBookingTransportMed, type TransportMedBagRequired } from "@/lib/api/event-outing";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: EventRosterBooking | null;
  eventTitle?: string;
  eventTicketPrice?: number;
  /** §12.3.1 — show outbound/return transport mode pickers for outing events. */
  eventKind?: string;
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
  eventKind = "legacy",
}: Props) {
  const isOuting = eventKind === "single_day_outing" || eventKind === "multi_day_tour";
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
  const [tripPickupOverride, setTripPickupOverride] = useState<string>("");
  const [outboundMode, setOutboundMode] = useState<"bus" | "self">("bus");
  const [returnMode, setReturnMode] = useState<"bus" | "self">("bus");
  const [medBagRequired, setMedBagRequired] = useState<TransportMedBagRequired>("not_set");
  const [medBagNotes, setMedBagNotes] = useState("");
  const [snapshotDisplay, setSnapshotDisplay] = useState<string | null>(null);
  const mutation = useUpdateEventBooking();
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
      setTripPickupOverride(booking.tripPickupAddressOverride ?? "");
      setOutboundMode((booking.outboundTransportMode as "bus" | "self") ?? "bus");
      setReturnMode((booking.returnTransportMode as "bus" | "self") ?? "bus");
      setMedBagRequired(booking.transportMedBagRequired ?? "not_set");
      setMedBagNotes(booking.transportMedNotes ?? "");
      setSnapshotDisplay(booking.dynamicMedicalNotesSnapshot);
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

  const profileRegularPickup = (booking?.participantRegularPickupAddress ?? "").trim();
  const profileStreetAddress = (booking?.participantStreetAddress ?? "").trim();
  const effectiveProfilePickup = profileRegularPickup || profileStreetAddress || null;
  const usesStreetFallback = !profileRegularPickup && !!profileStreetAddress;

  const manifestPickupPreview = useMemo(() => {
    const override = tripPickupOverride.trim();
    if (override) return override;
    return effectiveProfilePickup ?? null;
  }, [tripPickupOverride, effectiveProfilePickup]);

  if (!booking) return null;

  const canSubmit =
    dirty && !mutation.isPending && bookingStatus.length > 0 && !refundInvalid;

  const submit = async () => {
    if (!canSubmit) return;
    try {
      const willRefund = showRefundPanel && issueRefund && parsedRefund > 0;

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
      // Persist outing transport modes if changed.
      if (isOuting) {
        const origOut = (booking.outboundTransportMode ?? "bus") as "bus" | "self";
        const origRet = (booking.returnTransportMode ?? "bus") as "bus" | "self";
        if (outboundMode !== origOut || returnMode !== origRet) {
          await updateBookingTransportModes({
            booking_id: booking.id,
            outbound_transport_mode: outboundMode,
            return_transport_mode: returnMode,
          });
        }

        const resolvedMed: TransportMedBagRequired =
          outboundMode === "self" ? "no" : medBagRequired;
        const origMed = booking.transportMedBagRequired ?? "not_set";
        const origNotes = (booking.transportMedNotes ?? "").trim();
        const newNotes = medBagNotes.trim();
        if (
          resolvedMed !== origMed ||
          newNotes !== origNotes ||
          (outboundMode === "self" && origMed !== "no")
        ) {
          await updateBookingTransportMed({
            booking_id: booking.id,
            transport_med_bag_required: resolvedMed,
            transport_med_notes: resolvedMed === "yes" ? newNotes || null : null,
          });
        }
      }

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

          {/* ----- Outing transport modes (§12.3.2) ----- */}
          {isOuting && (
            <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Outing transport modes
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Outbound</Label>
                  <Select
                    value={outboundMode}
                    onValueChange={(v) => { setOutboundMode(v as "bus" | "self"); setDirty(true); }}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bus">Bus</SelectItem>
                      <SelectItem value="self">Self-transport</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">Self = first-day inbound only.</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Return</Label>
                  <Select
                    value={returnMode}
                    onValueChange={(v) => { setReturnMode(v as "bus" | "self"); setDirty(true); }}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bus">Bus</SelectItem>
                      <SelectItem value="self">Self-transport</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">Self = last-day outbound only.</p>
                </div>
              </div>
            </div>
          )}

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
                      onSuccess: (text) => {
                        setSnapshotDisplay(text.length > 0 ? text : null);
                        toast.success("Medical snapshot refreshed");
                      },
                    },
                  )
                }
              >
                <RefreshCw className={"h-3.5 w-3.5 " + (refreshSnapshot.isPending ? "animate-spin" : "")} />
                Re-snapshot
              </Button>
            </div>
            {snapshotDisplay && snapshotDisplay.trim().length > 0 ? (
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-background/60 p-2 font-mono text-[11px] leading-snug text-foreground">
                {snapshotDisplay}
              </pre>
            ) : (
              <p className="text-[11px] italic text-muted-foreground">
                No snapshot on file yet — frozen copy from when {booking.participantName} was
                rostered. Click &quot;Re-snapshot&quot; to pull compliance medical alerts and
                active medication schedules from the participant profile.
              </p>
            )}
          </div>

          {/* ----- Outing transport med bag (BL-014) — bus outbound only ----- */}
          {isOuting && outboundMode === "bus" && (
            <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <HeartPulse className="h-3.5 w-3.5" />
                Transport med bag (this outing)
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Does a <strong>labelled med supply</strong> travel on the bus for this trip?
                Daytime schedules (e.g. 11 AM Panadol) do not auto-require a bag — set explicitly.
                Administration at the venue is the trip leader&apos;s responsibility.
              </p>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Med bag on bus?</Label>
                <Select
                  value={medBagRequired}
                  onValueChange={(v) => {
                    setMedBagRequired(v as TransportMedBagRequired);
                    if (v !== "yes") setMedBagNotes("");
                    setDirty(true);
                  }}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not_set">Not assessed yet</SelectItem>
                    <SelectItem value="no">No — no bag on bus</SelectItem>
                    <SelectItem value="yes">Yes — bag required on bus</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {medBagRequired === "yes" && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">What is in the bag?</Label>
                  <Textarea
                    value={medBagNotes}
                    onChange={(e) => {
                      setMedBagNotes(e.target.value);
                      setDirty(true);
                    }}
                    rows={3}
                    placeholder="e.g. Epilim PRN + spacer. No daytime Panadol in bag."
                    className="text-sm"
                  />
                </div>
              )}
            </div>
          )}

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

          {/* ----- Event pickup (profile read-only + this-event override) ----- */}
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" /> Event pickup address
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              <strong className="text-foreground">Event outings</strong> use the client&apos;s{" "}
              <em>regular pickup address</em> from their profile (or home address if pickup is blank).
              <strong className="text-foreground"> Day Centre bus runs</strong> use the weekly schedule
              instead — edit those under Client profile → Schedules &amp; Attendance.
              Permanent address changes belong in Client profile → Contact Information.
            </p>

            <div className="space-y-1">
              <Label className="text-[11px] font-medium text-muted-foreground">
                From client profile (read-only)
              </Label>
              <div className="rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-foreground">
                {effectiveProfilePickup ?? (
                  <span className="italic text-muted-foreground">No pickup or home address on file</span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {profileRegularPickup
                  ? "Regular pickup address on file."
                  : usesStreetFallback
                    ? "No regular pickup set — manifest will use home / street address."
                    : "Add addresses in Participants → open client → Contact Information."}
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="override-addr" className="text-[11px] font-medium text-muted-foreground">
                One-off override (this event only)
              </Label>
              <Input
                id="override-addr"
                value={tripPickupOverride}
                placeholder="Leave blank to use the profile address above"
                onChange={(e) => {
                  setTripPickupOverride(e.target.value);
                  setDirty(true);
                }}
              />
              <p className="text-[10px] text-muted-foreground">
                Overrides the profile for this event&apos;s manifest only — does not change the client record.
              </p>
            </div>

            <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-[11px]">
              <span className="font-semibold text-muted-foreground">Driver manifest will use: </span>
              <span className="text-foreground">
                {manifestPickupPreview ?? (
                  <span className="italic text-amber-600 dark:text-amber-400">No address — set profile or override</span>
                )}
              </span>
            </div>
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
