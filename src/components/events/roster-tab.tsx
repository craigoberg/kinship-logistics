import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronRight, CircleDollarSign, GripVertical, HeartHandshake, Pencil, RotateCcw, Search, UserPlus, UserRoundPlus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useEventBookings,
  useEventPaymentLedgerForEvent,
  useCarersRegistry,
  useUpdateEventBooking,
} from "@/hooks/use-supabase-data";
import type { EventManifest, EventRosterBooking } from "@/lib/data-store";
import {
  isEventFinanceLocked,
  manifestPickupForBooking,
} from "@/lib/data-store";
import { AddRosterBookingModal } from "./add-roster-booking-modal";
import { AddGuestBookingModal } from "./add-guest-booking-modal";
import { AddEventSupportModal } from "./add-event-support-modal";
import {
  EVENT_SUPPORT_KEY,
  EVENT_SUPPORT_PAYMENTS_KEY,
  listEventSupportBookings,
  listEventSupportPayments,
  setEventSupportBookingStatus,
  supportBookingCost,
  type EventSupportBooking,
} from "@/lib/api/event-support";
import { EditEventSupportModal } from "./edit-event-support-modal";
import { RecordSupportMoneyModal } from "./record-support-money-modal";
import { supportPersonKindLabel } from "@/lib/support-person";
import { carerLegMode, legAddress, legOverrideToStore } from "@/lib/event-travel-legs";
import { updateCompanionCarerTravel } from "@/lib/api/event-outing";
import { TravelLegControls } from "./travel-leg-controls";
import { WalkOnBadge } from "./walk-on-person-modal";
import { RecordPaymentMilestoneModal } from "./record-payment-milestone-modal";
import { RecordRefundMilestoneModal } from "./record-refund-milestone-modal";
import { EditRosterBookingModal } from "./edit-roster-booking-modal";
import { BookingPaymentHistory } from "./booking-payment-history";
import { NoShowCountdownModal } from "@/components/attendance/no-show-countdown-modal";
import { PointerLaneList } from "./pointer-lane-list";
import { cn, formatDate } from "@/lib/utils";

interface Props {
  event: EventManifest;
  /** Passed through to EditRosterBookingModal for outing transport mode pickers. */
  eventKind?: string;
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function RosterTab({ event, eventKind = "legacy" }: Props) {
  const isOuting = eventKind === "single_day_outing" || eventKind === "multi_day_tour";
  const financeWritable = !isEventFinanceLocked(event);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [guestOpen, setGuestOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [milestoneBooking, setMilestoneBooking] = useState<EventRosterBooking | null>(null);
  const [refundBooking, setRefundBooking] = useState<EventRosterBooking | null>(null);
  const [editBooking, setEditBooking] = useState<EventRosterBooking | null>(null);
  const [editSupport, setEditSupport] = useState<EventSupportBooking | null>(null);
  const [paySupport, setPaySupport] = useState<EventSupportBooking | null>(null);
  const [refundSupport, setRefundSupport] = useState<EventSupportBooking | null>(null);
  const [noShowFor, setNoShowFor] = useState<EventRosterBooking | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const qc = useQueryClient();
  const { data: bookings = [], isLoading, error } = useEventBookings(event.id);
  const { data: supportBookings = [] } = useQuery({
    queryKey: EVENT_SUPPORT_KEY(event.id),
    queryFn: () => listEventSupportBookings(event.id),
    staleTime: 15_000,
  });
  const { data: supportPayments = [] } = useQuery({
    queryKey: EVENT_SUPPORT_PAYMENTS_KEY(event.id),
    queryFn: () => listEventSupportPayments(event.id),
    staleTime: 15_000,
  });
  const listedBookings = bookings;
  const listedSupport = supportBookings;
  const updateBooking = useUpdateEventBooking();
  const [savingCarerId, setSavingCarerId] = useState<string | null>(null);
  const saveCarerTravel = useMutation({
    mutationFn: updateCompanionCarerTravel,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["event_roster_bookings", event.id] });
    },
    onError: (err: Error) => toast.error(err.message),
    onSettled: () => setSavingCarerId(null),
  });
  const { data: paymentLedger = [] } = useEventPaymentLedgerForEvent(event.id);
  const { data: carersAll = [] } = useCarersRegistry();

  const carersById = useMemo(() => {
    const m = new Map<string, (typeof carersAll)[number]>();
    carersAll.forEach((c) => m.set(c.id, c));
    return m;
  }, [carersAll]);

  const waitlistedCount =
    listedBookings.filter((b) => b.bookingStatus === "Waitlisted").length +
    listedSupport.filter((s) => s.bookingStatus === "Waitlisted").length;
  const confirmedCount =
    listedBookings.filter((b) => b.bookingStatus !== "Cancelled" && b.bookingStatus !== "Waitlisted")
      .length +
    listedSupport.filter((s) => s.bookingStatus !== "Cancelled" && s.bookingStatus !== "Waitlisted")
      .length;
  const cancelledCount =
    listedBookings.filter((b) => b.bookingStatus === "Cancelled").length +
    listedSupport.filter((s) => s.bookingStatus === "Cancelled").length;

  const ledgerTotalsByParticipant = useMemo(() => {
    return paymentLedger.reduce((totals, entry) => {
      const next = (totals.get(entry.participantId) ?? 0) + entry.amount;
      totals.set(entry.participantId, Number(next.toFixed(2)));
      return totals;
    }, new Map<string, number>());
  }, [paymentLedger]);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const supportPaidById = useMemo(() => {
    const totals = new Map<string, number>();
    for (const entry of supportPayments) {
      totals.set(
        entry.supportBookingId,
        Number(((totals.get(entry.supportBookingId) ?? 0) + entry.amount).toFixed(2)),
      );
    }
    return totals;
  }, [supportPayments]);

  const filtered = useMemo(() => {
    const n = query.trim().toLowerCase();
    if (!n) return listedBookings;
    return listedBookings.filter((b) =>
      [
        b.participantName,
        b.bookingStatus,
        (b.carerId && carersById.get(b.carerId)?.fullName) || "",
        (b.companionCarerId && carersById.get(b.companionCarerId)?.fullName) || "",
        manifestPickupForBooking(b) ?? "",
        (ledgerTotalsByParticipant.get(b.participantId) ?? 0).toFixed(2),
      ]
        .join(" ")
        .toLowerCase()
        .includes(n),
    );
  }, [carersById, ledgerTotalsByParticipant, listedBookings, query]);

  const filteredSupport = useMemo(() => {
    const n = query.trim().toLowerCase();
    if (!n) return listedSupport;
    return listedSupport.filter((s) =>
      [s.displayName, s.bookingStatus, s.notes ?? "", supportPersonKindLabel(s.personKind)]
        .join(" ")
        .toLowerCase()
        .includes(n),
    );
  }, [query, listedSupport]);
  const bookingById = useMemo(
    () => new Map(listedBookings.map((b) => [b.id, b])),
    [listedBookings],
  );
  const supportById = useMemo(
    () => new Map(listedSupport.map((s) => [s.id, s])),
    [listedSupport],
  );
  const setRosterStatus = useMutation({
    mutationFn: async (input: { key: string; status: string }) => {
      if (input.key.startsWith("s:")) {
        const person = supportById.get(input.key.slice(2));
        if (!person || person.bookingStatus === input.status) return;
        await setEventSupportBookingStatus(person.id, input.status, person.displayName);
        return;
      }
      const person = bookingById.get(input.key.slice(2));
      if (!person || person.bookingStatus === input.status) return;
      await updateBooking.mutateAsync({
        bookingId: person.id,
        bookingStatus: input.status,
        notes: person.notes,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["event_roster_bookings", event.id] });
      void qc.invalidateQueries({ queryKey: EVENT_SUPPORT_KEY(event.id) });
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const dragEnabled = !query.trim() && !setRosterStatus.isPending;
  const statusLanes = useMemo(() => {
    const laneOf = (status: string) =>
      status === "Cancelled" ? "Cancelled" : status === "Waitlisted" ? "Waitlisted" : "Confirmed";
    const buckets: Record<"Confirmed" | "Waitlisted" | "Cancelled", string[]> = {
      Confirmed: [],
      Waitlisted: [],
      Cancelled: [],
    };
    for (const b of filtered) buckets[laneOf(b.bookingStatus)].push(`p:${b.id}`);
    for (const s of filteredSupport) buckets[laneOf(s.bookingStatus)].push(`s:${s.id}`);
    return (["Confirmed", "Waitlisted", "Cancelled"] as const).map((id) => ({
      id,
      itemIds: buckets[id],
    }));
  }, [filtered, filteredSupport]);

  type RowBind = {
    rowRef: (el: HTMLElement | null) => void;
    onGripPointerDown: (e: React.PointerEvent) => void;
    isDragging: boolean;
  };

  const renderBookingRow = (
    b: EventRosterBooking,
    rowBind?: RowBind,
    showDragHandle = false,
  ) => {
    const baselineCost = b.customPrice ?? event.ticketPrice;
    const netLedgerSum = ledgerTotalsByParticipant.get(b.participantId) ?? 0;
    const trueBalance = b.bookingStatus === "Cancelled" ? 0 : baselineCost - netLedgerSum;
    const owes = financeWritable && b.bookingStatus !== "Cancelled" && trueBalance > 0;
    const canRefund = financeWritable && netLedgerSum > 0;
    const isOpen = expanded.has(b.id);
    return (
      <Fragment key={b.id}>
        <tr
          ref={rowBind?.rowRef}
          className={cn(
            "border-t border-border align-top",
            rowBind?.isDragging && "bg-muted/50 shadow-md",
          )}
        >{[
          <td key="ctrl" className="px-2 py-2 align-middle">
            <div className="flex items-center">
              {showDragHandle && rowBind && (
                <button
                  type="button"
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground",
                    setRosterStatus.isPending
                      ? "cursor-not-allowed opacity-50"
                      : "cursor-grab touch-none active:cursor-grabbing",
                  )}
                  aria-label="Drag to another list"
                  disabled={setRosterStatus.isPending}
                  onPointerDown={rowBind.onGripPointerDown}
                >
                  <GripVertical className="h-4 w-4" />
                </button>
              )}
              <Button
                size="icon"
                variant="ghost"
                onClick={() => toggleExpanded(b.id)}
                className="h-6 w-6 text-muted-foreground"
                aria-label={isOpen ? "Collapse payment history" : "Expand payment history"}
                aria-expanded={isOpen}
              >
                {isOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </div>
          </td>,
          <td key="participant" className="px-4 py-2">
            <div className="flex flex-nowrap items-center gap-1.5 font-medium">
              <span className="whitespace-nowrap">{b.participantName}</span>
              <Badge
                variant="outline"
                className="shrink-0 align-middle text-[10px] uppercase"
              >
                Participant
              </Badge>
              {b.isGuestBooking && (
                <Badge
                  variant="outline"
                  className="ml-1.5 align-middle text-[10px] uppercase"
                >
                  Guest
                </Badge>
              )}
              {b.isWalkOn && (
                <WalkOnBadge className="ml-1.5 align-middle" />
              )}
              {b.carerIsWalkOn && !b.isWalkOn && (
                <WalkOnBadge className="ml-1.5 align-middle" carer />
              )}
              {b.notes && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="ml-1.5 cursor-help text-[10px] uppercase tracking-wide text-info">
                      ⓘ
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">{b.notes}</TooltipContent>
                </Tooltip>
              )}
            </div>
            {b.notes && (
              <div className="mt-0.5 line-clamp-2 text-xs italic text-muted-foreground">
                “{b.notes}”
              </div>
            )}
          </td>,
          <td key="cost" className="px-4 py-2 text-right font-semibold tabular-nums">
            ${fmtMoney(baselineCost)}
            {b.customPrice != null && b.customPrice !== event.ticketPrice && (
              <span className="ml-1 text-[10px] uppercase tracking-wide text-info">custom</span>
            )}
          </td>,
          <td key="paid" className="px-4 py-2 text-right font-semibold tabular-nums">
            ${fmtMoney(netLedgerSum)}
          </td>,
          <td
            key="balance"
            className={cn(
              "px-4 py-2 text-right font-semibold tabular-nums",
              b.bookingStatus === "Cancelled"
                ? "text-muted-foreground"
                : trueBalance <= 0
                  ? "text-success"
                  : "text-warning",
            )}
          >
            ${fmtMoney(b.bookingStatus === "Cancelled" ? 0 : Math.max(0, trueBalance))}
          </td>,
          <td key="paid-badge" className="px-4 py-2 text-right">
            <PaidBadge
              baselineCost={baselineCost}
              netLedgerSum={netLedgerSum}
              trueBalance={trueBalance}
              bookingStatus={b.bookingStatus}
            />
          </td>,
          <td key="actions" className="px-4 py-2 text-right">
            <div className="flex items-center justify-end gap-1">
              {owes && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setMilestoneBooking(b)}
                      className="h-7 w-7 text-success hover:text-success"
                      aria-label="Record payment milestone"
                    >
                      <CircleDollarSign className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Record Payment Milestone</TooltipContent>
                </Tooltip>
              )}
              {canRefund && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setRefundBooking(b)}
                      className="h-7 w-7 text-warning hover:text-warning"
                      aria-label="Record refund"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Record Refund</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setEditBooking(b)}
                    className="h-7 w-7 text-info hover:text-info"
                    aria-label="Edit booking"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit Booking</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setNoShowFor(b)}
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    aria-label="Trigger no-show countdown"
                  >
                    <AlertTriangle className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Trigger No-Show Countdown</TooltipContent>
              </Tooltip>
            </div>
          </td>,
          ]}</tr>
        {b.bringsCarer && !(b.carerId && supportBookings.some((s) => s.personKind === "carer" && s.carerId === b.carerId)) && (
          <tr className="border-t border-border/50 bg-muted/15">
            <td />
            <td colSpan={6} className="px-4 py-2">
              {(() => {
                const carerId = b.carerId || b.companionCarerId;
                const carer = carerId ? carersById.get(carerId) : undefined;
                const outbound = carerLegMode(b.carerOutboundTransportMode, b.carerTransportRequired);
                const ret = carerLegMode(b.carerReturnTransportMode, b.carerTransportRequired);
                const profile = (carer?.streetAddress ?? "").trim();
                const meeting = legAddress(b.carerTripPickupAddressOverride, profile);
                const home = legAddress(b.carerTripReturnAddressOverride, meeting || profile);
                const name = carer?.fullName || "Carer";
                const save = (patch: {
                  outbound?: "bus" | "self";
                  ret?: "bus" | "self";
                  pickup?: string | null;
                  home?: string | null;
                }) => {
                  setSavingCarerId(b.id);
                  saveCarerTravel.mutate({
                    bookingId: b.id,
                    displayName: name,
                    outbound: patch.outbound ?? outbound,
                    ret: patch.ret ?? ret,
                    pickupAddress: patch.pickup,
                    returnAddress: patch.home,
                  });
                };
                return (
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-[12rem] pt-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <HeartHandshake className="h-3.5 w-3.5 text-info" />
                        <span className="font-medium">{name}</span>
                        <Badge variant="outline" className="text-[10px] uppercase">
                          Carer
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">Carer for {b.participantName}</p>
                    </div>
                    <TravelLegControls
                      outbound={outbound}
                      ret={ret}
                      disabled={savingCarerId === b.id}
                      meetingAddress={meeting}
                      homeAddress={home}
                      onMeet={(mode) => save({ outbound: mode })}
                      onHome={(mode) => save({ ret: mode })}
                      onMeetingAddress={(next) => save({ pickup: legOverrideToStore(next, profile) })}
                      onHomeAddress={(next) =>
                        save({ home: legOverrideToStore(next, meeting || profile) })
                      }
                    />
                  </div>
                );
              })()}
            </td>
          </tr>
        )}
        {isOpen && (
          <tr className="border-t border-border/40 bg-muted/10">{[
            <td key="spacer" aria-hidden />,
            <td key="history" colSpan={6} className="p-0">
              <BookingPaymentHistory
                participantId={b.participantId}
                eventId={event.id}
                eventTitle={event.title}
                booking={b}
                ticketBaseline={baselineCost}
                financeWritable={financeWritable}
              />
            </td>,
          ]}</tr>
        )}
      </Fragment>
    );
  };

  const renderSupportRow = (
    s: EventSupportBooking,
    rowBind?: RowBind,
    showDragHandle = false,
  ) => {
    const baselineCost = supportBookingCost(s, event.ticketPrice);
    const netPaid = supportPaidById.get(s.id) ?? s.amountPaid;
    const trueBalance = s.bookingStatus === "Cancelled" ? 0 : baselineCost - netPaid;
    const owes = financeWritable && s.bookingStatus !== "Cancelled" && trueBalance > 0.001;
    const canRefund = financeWritable && netPaid > 0.001;
    const isOpen = expanded.has(s.id);
    const history = supportPayments.filter((p) => p.supportBookingId === s.id);

    return (
      <Fragment key={s.id}>
        <tr
          ref={rowBind?.rowRef}
          className={cn(
            "border-t border-border align-top",
            rowBind?.isDragging && "bg-muted/50 shadow-md",
          )}
        >
          <td className="px-2 py-2 align-middle">
            <div className="flex items-center">
              {showDragHandle && rowBind && (
                <button
                  type="button"
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground",
                    setRosterStatus.isPending
                      ? "cursor-not-allowed opacity-50"
                      : "cursor-grab touch-none active:cursor-grabbing",
                  )}
                  aria-label="Drag to another list"
                  disabled={setRosterStatus.isPending}
                  onPointerDown={rowBind.onGripPointerDown}
                >
                  <GripVertical className="h-4 w-4" />
                </button>
              )}
              <Button
                size="icon"
                variant="ghost"
                onClick={() => toggleExpanded(s.id)}
                className="h-6 w-6 text-muted-foreground"
                aria-label={isOpen ? "Collapse payment history" : "Expand payment history"}
                aria-expanded={isOpen}
              >
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </Button>
            </div>
          </td>
          <td className="px-4 py-2">
            <div className="flex flex-nowrap items-center gap-1.5 font-medium">
              <span className="whitespace-nowrap">{s.displayName}</span>
              <Badge variant="outline" className="shrink-0 align-middle text-[10px] uppercase">
                {supportPersonKindLabel(s.personKind)}
              </Badge>
            </div>
            {s.notes ? (
              <div className="mt-0.5 line-clamp-2 text-xs italic text-muted-foreground">“{s.notes}”</div>
            ) : null}
          </td>
          <td className="px-4 py-2 text-right font-semibold tabular-nums">
            ${fmtMoney(baselineCost)}
            {s.customPrice != null && s.customPrice !== event.ticketPrice && (
              <span className="ml-1 text-[10px] uppercase tracking-wide text-info">custom</span>
            )}
          </td>
          <td className="px-4 py-2 text-right font-semibold tabular-nums">
            ${fmtMoney(netPaid)}
          </td>
          <td
            className={cn(
              "px-4 py-2 text-right font-semibold tabular-nums",
              s.bookingStatus === "Cancelled"
                ? "text-muted-foreground"
                : trueBalance <= 0
                  ? "text-success"
                  : "text-warning",
            )}
          >
            ${fmtMoney(s.bookingStatus === "Cancelled" ? 0 : Math.max(0, trueBalance))}
          </td>
          <td className="px-4 py-2 text-right">
            <PaidBadge
              baselineCost={baselineCost}
              netLedgerSum={netPaid}
              trueBalance={trueBalance}
              bookingStatus={s.bookingStatus}
            />
          </td>
          <td className="px-4 py-2 text-right">
            <div className="flex items-center justify-end gap-1">
              {owes && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setPaySupport({ ...s, amountPaid: netPaid })}
                      className="h-7 w-7 text-success hover:text-success"
                      aria-label="Record payment"
                    >
                      <CircleDollarSign className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Record payment</TooltipContent>
                </Tooltip>
              )}
              {canRefund && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setRefundSupport({ ...s, amountPaid: netPaid })}
                      className="h-7 w-7 text-warning hover:text-warning"
                      aria-label="Record refund"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Record refund</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setEditSupport({ ...s, amountPaid: netPaid })}
                    className="h-7 w-7 text-info hover:text-info"
                    aria-label="Edit booking"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit booking</TooltipContent>
              </Tooltip>
            </div>
          </td>
        </tr>
        {isOpen && (
          <tr className="border-t border-border/40 bg-muted/10">
            <td aria-hidden />
            <td colSpan={6} className="px-4 py-3">
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments yet.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {history.map((p) => (
                    <li key={p.id} className="flex justify-between gap-3">
                      <span>
                        {formatDate(p.transactionDate)} · {p.description}
                      </span>
                      <span className="tabular-nums">${fmtMoney(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  const milestoneBookingWithLedger = useMemo(() => {
    if (!milestoneBooking) return null;
    const netLedgerSum = ledgerTotalsByParticipant.get(milestoneBooking.participantId) ?? 0;
    const baselineCost = milestoneBooking.customPrice ?? event.ticketPrice;
    const trueBalance = milestoneBooking.bookingStatus === "Cancelled" ? 0 : baselineCost - netLedgerSum;
    return { ...milestoneBooking, amountPaid: netLedgerSum, isFullyPaid: trueBalance <= 0 };
  }, [event.ticketPrice, ledgerTotalsByParticipant, milestoneBooking]);

  const editBookingWithLedger = useMemo(() => {
    if (!editBooking) return null;
    const netLedgerSum = ledgerTotalsByParticipant.get(editBooking.participantId) ?? 0;
    const baselineCost = editBooking.customPrice ?? event.ticketPrice;
    const trueBalance = editBooking.bookingStatus === "Cancelled" ? 0 : baselineCost - netLedgerSum;
    return { ...editBooking, amountPaid: netLedgerSum, isFullyPaid: trueBalance <= 0 };
  }, [editBooking, event.ticketPrice, ledgerTotalsByParticipant]);

  const refundBookingWithLedger = useMemo(() => {
    if (!refundBooking) return null;
    const netLedgerSum = ledgerTotalsByParticipant.get(refundBooking.participantId) ?? 0;
    const baselineCost = refundBooking.customPrice ?? event.ticketPrice;
    const trueBalance =
      refundBooking.bookingStatus === "Cancelled" ? 0 : baselineCost - netLedgerSum;
    return { ...refundBooking, amountPaid: netLedgerSum, isFullyPaid: trueBalance <= 0 };
  }, [event.ticketPrice, ledgerTotalsByParticipant, refundBooking]);

  return (
    <div className="space-y-4">
      {!financeWritable && (
        <div className="rounded-lg border border-muted bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Billing locked — this event is Closed. Payments and refunds are read-only.
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Trip roster</h3>
          <p className="text-xs text-muted-foreground">
            {isLoading
              ? "Loading…"
              : `Confirmed ${confirmedCount} · Waitlisted ${waitlistedCount} · Cancelled ${cancelledCount}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setSupportOpen(true)}
            className="gap-1.5"
          >
            Add support person
          </Button>
          {isOuting && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setGuestOpen(true)}
              className="gap-1.5"
            >
              <UserRoundPlus className="h-4 w-4" />
              Add guest
            </Button>
          )}
          <Button onClick={() => setAddOpen(true)} className="gap-1.5">
            <UserPlus className="h-4 w-4" />
            Add Participant to Roster
          </Button>
        </div>
      </div>

      <div className="relative w-full sm:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, status, balance…"
          className="h-9 pl-9"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Drag a person between Confirmed, Waitlisted, and Cancelled. That sets their booking.
        Money stays on the row. A carer travelling with someone is listed under them, with their
        own Bus or Self. Everyone else’s travel is on the Travel tab.
      </p>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading roster…</div>
      ) : filtered.length === 0 && filteredSupport.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          <Users className="mx-auto mb-2 h-5 w-5" />
          {query ? `No bookings match "${query}".` : "No participants on this roster yet."}
        </div>
      ) : (
        <TooltipProvider delayDuration={200}>
          <PointerLaneList
            lanes={statusLanes}
            disabled={!dragEnabled}
            onMove={(key, status) => setRosterStatus.mutate({ key, status })}
          >
            {({ lanes, bindLane, bindRow }) => (
              <div className="space-y-4">
                {lanes.map((lane) => (
                  <section
                    key={lane.id}
                    ref={bindLane(lane.id)}
                    className="min-h-16 overflow-x-auto rounded-lg border border-border"
                  >
                    <h4 className="border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {lane.id}
                      <span className="ml-2 tabular-nums">{lane.itemIds.length}</span>
                    </h4>
                    {lane.itemIds.length === 0 ? (
                      <p className="px-4 py-6 text-sm text-muted-foreground">
                        {dragEnabled ? "Drag someone here." : "None."}
                      </p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <tr>
                            <th className="w-14 px-2 py-2" />
                            <th className="px-4 py-2 font-medium">Person</th>
                            <th className="px-4 py-2 text-right font-medium">
                              Booking cost
                            </th>
                            <th className="px-4 py-2 text-right font-medium">
                              Total paid
                            </th>
                            <th className="px-4 py-2 text-right font-medium">
                              Net balance
                            </th>
                            <th className="px-4 py-2 text-right font-medium">
                              Status
                            </th>
                            <th className="px-4 py-2 text-right font-medium">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lane.itemIds.map((key) => {
                            const bind = dragEnabled ? bindRow(key) : undefined;
                            if (key.startsWith("s:")) {
                              const s = supportById.get(key.slice(2));
                              return s ? renderSupportRow(s, bind, dragEnabled) : null;
                            }
                            const b = bookingById.get(key.slice(2));
                            return b ? renderBookingRow(b, bind, dragEnabled) : null;
                          })}
                        </tbody>
                      </table>
                    )}
                  </section>
                ))}
              </div>
            )}
          </PointerLaneList>
        </TooltipProvider>
      )}

      <p className="text-xs text-muted-foreground">
        Staff, volunteers, and carers sit in the same lists. Their cost starts at the full event
        price. They have no medication fields, and they stay off meals, medication, and overnight
        roll call.
      </p>

      <AddEventSupportModal
        open={supportOpen}
        eventId={event.id}
        ticketPrice={event.ticketPrice}
        existingBookings={supportBookings}
        onClose={() => setSupportOpen(false)}
      />

      <AddRosterBookingModal
        open={addOpen}
        onOpenChange={setAddOpen}
        event={event}
        existingBookings={bookings}
      />

      <AddGuestBookingModal
        open={guestOpen}
        onOpenChange={setGuestOpen}
        event={event}
      />

      <RecordPaymentMilestoneModal
        open={milestoneBooking !== null}
        onOpenChange={(o) => !o && setMilestoneBooking(null)}
        event={event}
        booking={milestoneBookingWithLedger}
      />

      <RecordRefundMilestoneModal
        open={refundBooking !== null}
        onOpenChange={(o) => !o && setRefundBooking(null)}
        event={event}
        booking={refundBookingWithLedger}
      />

      <EditRosterBookingModal
        open={editBooking !== null}
        onOpenChange={(o) => !o && setEditBooking(null)}
        booking={editBookingWithLedger}
        eventTitle={event.title}
        eventTicketPrice={event.ticketPrice}
        eventKind={eventKind}
        financeWritable={financeWritable}
      />

      <EditEventSupportModal
        open={editSupport !== null}
        onOpenChange={(o) => !o && setEditSupport(null)}
        booking={editSupport}
        eventTitle={event.title}
        eventTicketPrice={event.ticketPrice}
        financeWritable={financeWritable}
      />
      <RecordSupportMoneyModal
        open={paySupport !== null}
        onOpenChange={(o) => !o && setPaySupport(null)}
        booking={paySupport}
        eventTitle={event.title}
        eventTicketPrice={event.ticketPrice}
        mode="payment"
      />
      <RecordSupportMoneyModal
        open={refundSupport !== null}
        onOpenChange={(o) => !o && setRefundSupport(null)}
        booking={refundSupport}
        eventTitle={event.title}
        eventTicketPrice={event.ticketPrice}
        mode="refund"
      />

      {noShowFor && (
        <NoShowCountdownModal
          open={true}
          onOpenChange={(o) => !o && setNoShowFor(null)}
          participantId={noShowFor.participantId}
          participantName={noShowFor.participantName}
        />
      )}
    </div>
  );
}

function PaidBadge({
  baselineCost,
  netLedgerSum,
  trueBalance,
  bookingStatus,
}: {
  baselineCost: number;
  netLedgerSum: number;
  trueBalance: number;
  bookingStatus: string;
}) {
  if (bookingStatus === "Cancelled") {
    return (
      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-700 dark:bg-slate-800 dark:text-slate-300">
        Cancelled / Balanced
      </span>
    );
  }
  const balanceCents = Math.round(trueBalance * 100);
  const baselineCents = Math.round(baselineCost * 100);
  const paidCents = Math.round(netLedgerSum * 100);
  if (balanceCents <= 0) {
    return (
      <span className="rounded-full bg-success px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
        Paid
      </span>
    );
  }
  if (balanceCents === baselineCents || paidCents <= 0) {
    return (
      <span className="rounded-full bg-destructive px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
        Unpaid
      </span>
    );
  }
  return (
    <span className="rounded-full bg-warning px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
      Partial
    </span>
  );
}
