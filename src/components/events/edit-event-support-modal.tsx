/**
 * Edit a non-participant roster row: status, cost, transport, pickup, notes.
 * No medication fields.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MapPin } from "lucide-react";
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
import { DatePicker } from "@/components/ui/date-picker";
import {
  StopAddressChoices,
  choiceFromOverrideText,
} from "@/components/address/stop-address-picker";
import { personAddressQueryKey } from "@/components/address/person-address-list";
import { listPersonAddresses, loadHomeAddress } from "@/lib/api/person-addresses";
import { LOOKUP_CATEGORIES } from "@/lib/data-store";
import { useLookupParameters } from "@/hooks/use-supabase-data";
import { eventBusRunOptions } from "@/lib/event-bus-runs";
import {
  EVENT_SUPPORT_KEY,
  EVENT_SUPPORT_PAYMENTS_KEY,
  supportBookingCost,
  updateEventSupportBooking,
  type EventSupportBooking,
} from "@/lib/api/event-support";
import { PersonKindText } from "@/components/people/person-kind-badge";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import { cn, parseIsoDateLocal, todayLocalIso, toIsoDateString } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: EventSupportBooking | null;
  eventTitle: string;
  eventTicketPrice: number;
  financeWritable?: boolean;
}

const STATUS_OPTIONS = ["Confirmed", "Waitlisted", "Cancelled"] as const;

function fmtMoney(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function EditEventSupportModal({
  open,
  onOpenChange,
  booking,
  eventTitle,
  eventTicketPrice,
  financeWritable = true,
}: Props) {
  const qc = useQueryClient();
  const [status, setStatus] = useState("Confirmed");
  const [price, setPrice] = useState("0.00");
  const [notes, setNotes] = useState("");
  const [outMode, setOutMode] = useState<"bus" | "self">("bus");
  const [retMode, setRetMode] = useState<"bus" | "self">("bus");
  const [outRun, setOutRun] = useState<string | null>(null);
  const [retRun, setRetRun] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [issueRefund, setIssueRefund] = useState(false);
  const [refundAmount, setRefundAmount] = useState("0");
  const [refundDate, setRefundDate] = useState(todayLocalIso());
  const [saving, setSaving] = useState(false);

  const { data: busRunLookups = [] } = useLookupParameters(LOOKUP_CATEGORIES.busRun);
  const busOpts = useMemo(() => eventBusRunOptions(busRunLookups), [busRunLookups]);
  const defaultRun = busOpts[0]?.code ?? null;

  const addressOwner = {
    kind: (booking?.personKind === "carer" ? "carer" : "staff") as "carer" | "staff",
    id: (booking?.personKind === "carer" ? booking?.carerId : booking?.staffId) ?? "",
  };
  const placesQ = useQuery({
    queryKey: personAddressQueryKey(addressOwner),
    queryFn: () => listPersonAddresses(addressOwner),
    enabled: open && !!addressOwner.id,
  });
  const homeQ = useQuery({
    queryKey: ["home-address", addressOwner.kind, addressOwner.id],
    queryFn: () => loadHomeAddress(addressOwner),
    enabled: open && !!addressOwner.id,
  });

  useEffect(() => {
    if (!open || !booking) return;
    const baseline = supportBookingCost(booking, eventTicketPrice);
    setStatus(booking.bookingStatus || "Confirmed");
    setPrice(baseline.toFixed(2));
    setNotes(booking.notes ?? "");
    setOutMode(booking.outboundTransportMode);
    setRetMode(booking.returnTransportMode);
    setOutRun(booking.outboundBusRunCode);
    setRetRun(booking.returnBusRunCode);
    setAddress(booking.tripPickupAddressOverride ?? "");
    setIssueRefund(booking.amountPaid > 0);
    setRefundAmount(booking.amountPaid > 0 ? booking.amountPaid.toFixed(2) : "0");
    setRefundDate(todayLocalIso());
  }, [open, booking, eventTicketPrice]);

  if (!booking) return null;

  const parsed = Number(price);
  const priceInvalid = !Number.isFinite(parsed) || parsed < 0;
  const fullPrice = Number(eventTicketPrice) || 0;
  const collected = booking.amountPaid;
  const showRefund = status === "Cancelled" && collected > 0;
  const refundNum = Number(refundAmount);
  const refundInvalid =
    showRefund &&
    issueRefund &&
    (!Number.isFinite(refundNum) || refundNum <= 0 || refundNum > collected + 0.001);
  const missing: string[] = [];
  if (priceInvalid) missing.push("Booking cost");
  if (refundInvalid) missing.push("Refund amount");
  const canSave = missing.length === 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const matchesFull = Math.abs(parsed - fullPrice) < 0.001;
      await updateEventSupportBooking({
        booking,
        eventTitle,
        ticketPrice: fullPrice,
        bookingStatus: status,
        notes: notes.trim() || null,
        customPrice: matchesFull ? null : Number(parsed.toFixed(2)),
        outboundTransportMode: outMode,
        returnTransportMode: retMode,
        outboundBusRunCode: outMode === "bus" ? outRun ?? defaultRun : null,
        returnBusRunCode: retMode === "bus" ? retRun ?? defaultRun : null,
        tripPickupAddressOverride: address,
        refundOnCancel:
          showRefund && issueRefund && financeWritable
            ? { amount: refundNum, date: refundDate }
            : null,
      });
      await qc.invalidateQueries({ queryKey: EVENT_SUPPORT_KEY(booking.eventId) });
      await qc.invalidateQueries({ queryKey: EVENT_SUPPORT_PAYMENTS_KEY(booking.eventId) });
      toast.success("Booking updated", { description: booking.displayName });
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save booking");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100svh-1.5rem)] w-full max-w-md flex-col overflow-hidden border-border bg-card">
        <DialogHeader className="shrink-0">
          <DialogTitle>Edit booking</DialogTitle>
          <DialogDescription>
            {booking.displayName} · <PersonKindText kind={booking.personKind} />. Cost starts at
            the full event price. No medication fields.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto overscroll-contain px-6">
          <div className="space-y-3 pt-1">
            {!financeWritable && (
              <div className="rounded-lg border border-muted bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Billing locked — this event is Closed. Transport can still be updated.
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Booking status
              </Label>
              <Select value={status} onValueChange={setStatus}>
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

            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Booking cost ($)
                </Label>
                <span className="text-[10px] text-muted-foreground">
                  Event price ${fmtMoney(fullPrice)}
                </span>
              </div>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={price}
                disabled={!financeWritable}
                onChange={(e) => setPrice(e.target.value)}
                className={cn("bg-background tabular-nums", requiredFieldOutline(priceInvalid))}
              />
              <p className="text-[11px] text-muted-foreground">
                Full price is the default. Enter a lower amount when they pay only some of the cost.
                Collected ${fmtMoney(collected)}.
              </p>
            </div>

            {showRefund && (
              <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Refund collected ${fmtMoney(collected)}
                  </Label>
                  <Switch
                    checked={issueRefund && financeWritable}
                    disabled={!financeWritable}
                    onCheckedChange={setIssueRefund}
                  />
                </div>
                {issueRefund && financeWritable && (
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={refundAmount}
                      onChange={(e) => setRefundAmount(e.target.value)}
                      className={cn("bg-background", requiredFieldOutline(refundInvalid))}
                    />
                    <DatePicker
                      value={parseIsoDateLocal(refundDate)}
                      onChange={(d) => setRefundDate(d ? toIsoDateString(d) : "")}
                      dateFormat="dd-MMM-yy"
                      className="h-9 text-sm bg-background"
                    />
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                To meeting point
              </Label>
              <Select
                value={outMode}
                onValueChange={(v) => {
                  const mode = v as "bus" | "self";
                  setOutMode(mode);
                  if (mode === "bus" && !outRun) setOutRun(defaultRun);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bus">Bus</SelectItem>
                  <SelectItem value="self">Self</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Departure to home
              </Label>
              <Select
                value={retMode}
                onValueChange={(v) => {
                  const mode = v as "bus" | "self";
                  setRetMode(mode);
                  if (mode === "bus" && !retRun) setRetRun(defaultRun);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bus">Bus</SelectItem>
                  <SelectItem value="self">Self</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" /> Pickup for this event
              </div>
              {addressOwner.id ? (
                <StopAddressChoices
                  owner={addressOwner}
                  activeChoice={choiceFromOverrideText({
                    override: address,
                    home: homeQ.data ?? null,
                    places: placesQ.data ?? [],
                  })}
                  allowCustom
                  customText={address}
                  onCustomText={setAddress}
                  onChoose={(choice) => {
                    if (choice.mode === "home") setAddress((homeQ.data ?? "").trim());
                    else if (choice.mode === "saved") {
                      const place = (placesQ.data ?? []).find((p) => p.id === choice.addressId);
                      setAddress(place?.address ?? "");
                    } else setAddress(choice.text);
                  }}
                />
              ) : null}
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Notes / billing arrangements
              </Label>
              <Textarea
                rows={3}
                value={notes}
                placeholder="What they are paying, and any billing note…"
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {missing.length > 0 && (
              <p className="text-sm text-destructive">Need: {missing.join(", ")}</p>
            )}
          </div>
        </div>
        <DialogFooter className="shrink-0 border-t border-border pt-3 sm:justify-between">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" disabled={!canSave} onClick={() => void save()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
