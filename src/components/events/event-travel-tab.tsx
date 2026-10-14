/**
 * Event Manage — how confirmed people reach the meeting point and leave
 * the departure point. Waitlisted and cancelled stay on the Roster tab.
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bus, GripVertical, Pencil, Pill } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PersonKindBadge } from "@/components/people/person-kind-badge";
import type { PersonKindChip } from "@/lib/ui/person-kind-chip";
import {
  useCarersRegistry,
  useEventBookings,
  useEventPaymentLedgerForEvent,
  useReorderEventRosterPickupOrder,
} from "@/hooks/use-supabase-data";
import {
  isEventFinanceLocked,
  type EventManifest,
  type EventRosterBooking,
} from "@/lib/data-store";
import { carerLegMode, legAddress, legOverrideToStore } from "@/lib/event-travel-legs";
import {
  EVENT_SUPPORT_KEY,
  EVENT_SUPPORT_PAYMENTS_KEY,
  listEventSupportBookings,
  listEventSupportPayments,
  setEventSupportTravel,
  type EventSupportBooking,
} from "@/lib/api/event-support";
import {
  TRANSPORT_MED_BAG_LABELS,
  updateBookingTransportModes,
  updateCompanionCarerTravel,
} from "@/lib/api/event-outing";
import { PointerSortableList } from "@/components/manifest/manage-pickups-panel";
import { cn } from "@/lib/utils";
import { EditEventSupportModal } from "./edit-event-support-modal";
import { EditRosterBookingModal } from "./edit-roster-booking-modal";
import { TravelLegControls } from "./travel-leg-controls";

interface Props {
  event: EventManifest;
  eventKind?: string;
}

function ridesBus(outbound?: string | null, ret?: string | null) {
  return (outbound ?? "bus") === "bus" || (ret ?? "bus") === "bus";
}

function orderRank(order: number | null | undefined) {
  const n = order ?? 0;
  return n > 0 ? n : Number.MAX_SAFE_INTEGER;
}

function coming(status: string) {
  return status !== "Cancelled" && status !== "Waitlisted";
}

function profileStop(regular: string | null | undefined, street: string | null | undefined) {
  return (regular ?? "").trim() || (street ?? "").trim();
}

export function EventTravelTab({ event, eventKind = "legacy" }: Props) {
  const isOuting = eventKind === "single_day_outing" || eventKind === "multi_day_tour";
  const qc = useQueryClient();
  const { data: bookings = [], isLoading } = useEventBookings(event.id);
  const { data: supportBookings = [] } = useQuery({
    queryKey: EVENT_SUPPORT_KEY(event.id),
    queryFn: () => listEventSupportBookings(event.id),
    staleTime: 15_000,
  });
  const { data: carersAll = [] } = useCarersRegistry();
  const reorderPickup = useReorderEventRosterPickupOrder();
  const financeWritable = !isEventFinanceLocked(event);
  const { data: paymentLedger = [] } = useEventPaymentLedgerForEvent(event.id);
  const { data: supportPayments = [] } = useQuery({
    queryKey: EVENT_SUPPORT_PAYMENTS_KEY(event.id),
    queryFn: () => listEventSupportPayments(event.id),
    staleTime: 15_000,
  });
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editBooking, setEditBooking] = useState<EventRosterBooking | null>(null);
  const [editSupport, setEditSupport] = useState<EventSupportBooking | null>(null);

  const confirmedBookings = useMemo(
    () => bookings.filter((b) => coming(b.bookingStatus)),
    [bookings],
  );
  const confirmedSupport = useMemo(
    () => supportBookings.filter((s) => coming(s.bookingStatus)),
    [supportBookings],
  );

  const ledgerTotalsByParticipant = useMemo(() => {
    return paymentLedger.reduce((totals, entry) => {
      const next = (totals.get(entry.participantId) ?? 0) + entry.amount;
      totals.set(entry.participantId, Number(next.toFixed(2)));
      return totals;
    }, new Map<string, number>());
  }, [paymentLedger]);

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

  const editBookingWithLedger = useMemo(() => {
    if (!editBooking) return null;
    const netLedgerSum = ledgerTotalsByParticipant.get(editBooking.participantId) ?? 0;
    const baselineCost = editBooking.customPrice ?? event.ticketPrice;
    const trueBalance = editBooking.bookingStatus === "Cancelled" ? 0 : baselineCost - netLedgerSum;
    return { ...editBooking, amountPaid: netLedgerSum, isFullyPaid: trueBalance <= 0 };
  }, [editBooking, event.ticketPrice, ledgerTotalsByParticipant]);

  const carersById = useMemo(() => {
    const m = new Map<string, (typeof carersAll)[number]>();
    carersAll.forEach((c) => m.set(c.id, c));
    return m;
  }, [carersAll]);

  const supportCarerIds = useMemo(
    () =>
      new Set(
        confirmedSupport
          .filter((s) => s.personKind === "carer" && s.carerId)
          .map((s) => s.carerId as string),
      ),
    [confirmedSupport],
  );

  const companions = useMemo(() => {
    return confirmedBookings.flatMap((b) => {
      if (!b.bringsCarer) return [];
      const carerId = b.carerId || b.companionCarerId;
      if (!carerId || supportCarerIds.has(carerId)) return [];
      const carer = carersById.get(carerId);
      const outbound = carerLegMode(b.carerOutboundTransportMode, b.carerTransportRequired);
      const ret = carerLegMode(b.carerReturnTransportMode, b.carerTransportRequired);
      const profile = (carer?.streetAddress ?? "").trim();
      const meeting = legAddress(b.carerTripPickupAddressOverride, profile);
      return [
        {
          booking: b,
          carerId,
          name: carer?.fullName || "Carer",
          outbound,
          ret,
          profile,
          meeting,
          home: legAddress(b.carerTripReturnAddressOverride, meeting || profile),
        },
      ];
    });
  }, [carersById, confirmedBookings, supportCarerIds]);

  const { busIds, selfBookingIds, selfSupportIds, selfCarerIds } = useMemo(() => {
    const busPeople = [
      ...confirmedBookings
        .filter((b) => ridesBus(b.outboundTransportMode, b.returnTransportMode))
        .map((b) => ({
          key: `p:${b.id}`,
          order: orderRank(b.pickupOrder),
          name: b.participantName,
        })),
      ...confirmedSupport
        .filter((s) => ridesBus(s.outboundTransportMode, s.returnTransportMode))
        .map((s) => ({
          key: `s:${s.id}`,
          order: orderRank(s.pickupOrder),
          name: s.displayName,
        })),
      ...companions
        .filter((c) => ridesBus(c.outbound, c.ret))
        .map((c) => ({
          key: `c:${c.booking.id}`,
          order: orderRank(c.booking.carerPickupOrder ?? c.booking.pickupOrder),
          name: c.name,
        })),
    ].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    return {
      busIds: busPeople.map((p) => p.key),
      selfBookingIds: confirmedBookings
        .filter((b) => !ridesBus(b.outboundTransportMode, b.returnTransportMode))
        .sort((a, b) => a.participantName.localeCompare(b.participantName))
        .map((b) => b.id),
      selfSupportIds: confirmedSupport
        .filter((s) => !ridesBus(s.outboundTransportMode, s.returnTransportMode))
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .map((s) => s.id),
      selfCarerIds: companions
        .filter((c) => !ridesBus(c.outbound, c.ret))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => c.booking.id),
    };
  }, [companions, confirmedBookings, confirmedSupport]);

  const bookingById = useMemo(
    () => new Map(confirmedBookings.map((b) => [b.id, b])),
    [confirmedBookings],
  );
  const supportById = useMemo(
    () => new Map(confirmedSupport.map((s) => [s.id, s])),
    [confirmedSupport],
  );
  const companionByBookingId = useMemo(
    () => new Map(companions.map((c) => [c.booking.id, c])),
    [companions],
  );

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["event_roster_bookings", event.id] });
    void qc.invalidateQueries({ queryKey: EVENT_SUPPORT_KEY(event.id) });
  };

  const saveParticipant = useMutation({
    mutationFn: (input: {
      booking: EventRosterBooking;
      outbound: "bus" | "self";
      ret: "bus" | "self";
      pickup?: string | null;
      home?: string | null;
    }) =>
      updateBookingTransportModes({
        booking_id: input.booking.id,
        outbound_transport_mode: input.outbound,
        return_transport_mode: input.ret,
        outbound_bus_run_code:
          input.outbound === "bus" ? input.booking.outboundBusRunCode : null,
        return_bus_run_code: input.ret === "bus" ? input.booking.returnBusRunCode : null,
        trip_pickup_address_override: input.pickup,
        trip_return_address_override: input.home,
      }),
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast.error(err.message),
    onSettled: () => setSavingId(null),
  });

  const saveSupport = useMutation({
    mutationFn: (input: {
      booking: EventSupportBooking;
      outbound: "bus" | "self";
      ret: "bus" | "self";
      pickup?: string | null;
      home?: string | null;
    }) =>
      setEventSupportTravel({
        id: input.booking.id,
        displayName: input.booking.displayName,
        outbound: input.outbound,
        ret: input.ret,
        outboundBusRunCode:
          input.outbound === "bus" ? input.booking.outboundBusRunCode : null,
        returnBusRunCode: input.ret === "bus" ? input.booking.returnBusRunCode : null,
        tripPickupAddressOverride: input.pickup,
        tripReturnAddressOverride: input.home,
      }),
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast.error(err.message),
    onSettled: () => setSavingId(null),
  });

  const saveCarer = useMutation({
    mutationFn: (input: {
      bookingId: string;
      displayName: string;
      outbound: "bus" | "self";
      ret: "bus" | "self";
      pickup?: string | null;
      home?: string | null;
    }) =>
      updateCompanionCarerTravel({
        bookingId: input.bookingId,
        displayName: input.displayName,
        outbound: input.outbound,
        ret: input.ret,
        pickupAddress: input.pickup,
        returnAddress: input.home,
      }),
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast.error(err.message),
    onSettled: () => setSavingId(null),
  });

  const handlePickupReorder = useCallback(
    (orderedIds: string[]) => {
      reorderPickup.mutate({
        eventId: event.id,
        ordered: orderedIds.map((key) => ({
          kind: key.startsWith("s:")
            ? ("support" as const)
            : key.startsWith("c:")
              ? ("carer" as const)
              : ("participant" as const),
          id: key.slice(2),
        })),
      });
    },
    [event.id, reorderPickup],
  );

  const setParticipantMode = (
    booking: EventRosterBooking,
    leg: "meet" | "home",
    mode: "bus" | "self",
  ) => {
    setSavingId(booking.id);
    saveParticipant.mutate({
      booking,
      outbound: leg === "meet" ? mode : ((booking.outboundTransportMode as "bus" | "self") ?? "bus"),
      ret: leg === "home" ? mode : ((booking.returnTransportMode as "bus" | "self") ?? "bus"),
    });
  };

  const setSupportMode = (
    booking: EventSupportBooking,
    leg: "meet" | "home",
    mode: "bus" | "self",
  ) => {
    setSavingId(booking.id);
    saveSupport.mutate({
      booking,
      outbound: leg === "meet" ? mode : booking.outboundTransportMode,
      ret: leg === "home" ? mode : booking.returnTransportMode,
    });
  };

  const personRow = (
    name: string,
    kind: PersonKindChip,
    subtitle: string | null,
    outbound: "bus" | "self",
    ret: "bus" | "self",
    meetingAddress: string,
    homeAddress: string,
    onMeet: (mode: "bus" | "self") => void,
    onHome: (mode: "bus" | "self") => void,
    onMeetingAddress: (next: string) => void,
    onHomeAddress: (next: string) => void,
    onEdit: (() => void) | null,
    saving: boolean,
    extra?: ReactNode,
    rowBind?: {
      rowRef: (el: HTMLElement | null) => void;
      onGripPointerDown: (e: React.PointerEvent) => void;
      isDragging: boolean;
    },
  ) => (
    <div
      ref={rowBind?.rowRef}
      className={cn(
        "flex items-start gap-3 overflow-x-auto rounded-md border border-border bg-card px-2 py-1.5",
        rowBind?.isDragging && "z-10 shadow-md ring-2 ring-primary/40",
      )}
    >
      {rowBind && (
        <button
          type="button"
          className="mt-0.5 flex h-8 w-6 shrink-0 touch-none items-center justify-center text-muted-foreground cursor-grab active:cursor-grabbing"
          aria-label="Drag to set pickup order"
          onPointerDown={rowBind.onGripPointerDown}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <div className="min-w-[11rem] flex-1 pt-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium">{name}</span>
          <PersonKindBadge kind={kind} />
          {extra}
        </div>
        {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      <TravelLegControls
        outbound={outbound}
        ret={ret}
        disabled={saving}
        meetingAddress={meetingAddress}
        homeAddress={homeAddress}
        onMeet={onMeet}
        onHome={onHome}
        onMeetingAddress={onMeetingAddress}
        onHomeAddress={onHomeAddress}
      />
      {onEdit && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="mt-0.5 h-8 w-8 shrink-0"
          aria-label={`Edit ${name}`}
          onClick={onEdit}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );

  const renderBooking = (
    b: EventRosterBooking,
    rowBind?: {
      rowRef: (el: HTMLElement | null) => void;
      onGripPointerDown: (e: React.PointerEvent) => void;
      isDragging: boolean;
    },
  ) => {
    const outbound = (b.outboundTransportMode as "bus" | "self") ?? "bus";
    const ret = (b.returnTransportMode as "bus" | "self") ?? "bus";
    const profile = profileStop(b.participantRegularPickupAddress, b.participantStreetAddress);
    const meeting = legAddress(b.tripPickupAddressOverride, profile);
    const home = legAddress(b.tripReturnAddressOverride, meeting || profile);
    return personRow(
      b.participantName,
      b.isGuestBooking ? "guest" : "participant",
      null,
      outbound,
      ret,
      meeting,
      home,
      (mode) => setParticipantMode(b, "meet", mode),
      (mode) => setParticipantMode(b, "home", mode),
      (next) => {
        setSavingId(b.id);
        saveParticipant.mutate({
          booking: b,
          outbound,
          ret,
          pickup: legOverrideToStore(next, profile),
        });
      },
      (next) => {
        setSavingId(b.id);
        saveParticipant.mutate({
          booking: b,
          outbound,
          ret,
          home: legOverrideToStore(next, meeting || profile),
        });
      },
      () => setEditBooking(b),
      savingId === b.id,
      isOuting && outbound === "bus" ? (
        <span
          className={
            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
            (b.transportMedBagRequired === "yes"
              ? "bg-info/15 text-info"
              : b.transportMedBagRequired === "no"
                ? "bg-muted text-muted-foreground"
                : "bg-warning/15 text-warning")
          }
        >
          <Pill className="h-3 w-3" />
          {TRANSPORT_MED_BAG_LABELS[b.transportMedBagRequired]}
        </span>
      ) : null,
      rowBind,
    );
  };

  const renderSupport = (
    s: EventSupportBooking,
    rowBind?: {
      rowRef: (el: HTMLElement | null) => void;
      onGripPointerDown: (e: React.PointerEvent) => void;
      isDragging: boolean;
    },
  ) =>
    personRow(
      s.displayName,
      s.personKind,
      null,
      s.outboundTransportMode,
      s.returnTransportMode,
      legAddress(s.tripPickupAddressOverride, s.profileAddress),
      legAddress(s.tripReturnAddressOverride, legAddress(s.tripPickupAddressOverride, s.profileAddress)),
      (mode) => setSupportMode(s, "meet", mode),
      (mode) => setSupportMode(s, "home", mode),
      (next) => {
        setSavingId(s.id);
        saveSupport.mutate({
          booking: s,
          outbound: s.outboundTransportMode,
          ret: s.returnTransportMode,
          pickup: legOverrideToStore(next, s.profileAddress),
        });
      },
      (next) => {
        setSavingId(s.id);
        const meeting = legAddress(s.tripPickupAddressOverride, s.profileAddress);
        saveSupport.mutate({
          booking: s,
          outbound: s.outboundTransportMode,
          ret: s.returnTransportMode,
          home: legOverrideToStore(next, meeting || s.profileAddress),
        });
      },
      () => {
        const netPaid = supportPaidById.get(s.id) ?? s.amountPaid;
        setEditSupport({ ...s, amountPaid: netPaid });
      },
      savingId === s.id,
      null,
      rowBind,
    );

  const renderCarer = (
    bookingId: string,
    rowBind?: {
      rowRef: (el: HTMLElement | null) => void;
      onGripPointerDown: (e: React.PointerEvent) => void;
      isDragging: boolean;
    },
  ) => {
    const c = companionByBookingId.get(bookingId);
    if (!c) return null;
    const save = (patch: { outbound?: "bus" | "self"; ret?: "bus" | "self"; pickup?: string | null; home?: string | null }) => {
      setSavingId(c.booking.id);
      saveCarer.mutate({
        bookingId: c.booking.id,
        displayName: c.name,
        outbound: patch.outbound ?? c.outbound,
        ret: patch.ret ?? c.ret,
        pickup: patch.pickup,
        home: patch.home,
      });
    };
    return personRow(
      c.name,
      "carer",
      `Carer for ${c.booking.participantName}`,
      c.outbound,
      c.ret,
      c.meeting,
      c.home,
      (mode) => save({ outbound: mode }),
      (mode) => save({ ret: mode }),
      (next) => save({ pickup: legOverrideToStore(next, c.profile) }),
      (next) => save({ home: legOverrideToStore(next, c.meeting || c.profile) }),
      null,
      savingId === c.booking.id,
      null,
      rowBind,
    );
  };

  const busSeats =
    confirmedBookings.filter((b) => ridesBus(b.outboundTransportMode, b.returnTransportMode))
      .length +
    confirmedSupport.filter((s) => ridesBus(s.outboundTransportMode, s.returnTransportMode))
      .length +
    companions.filter((c) => ridesBus(c.outbound, c.ret)).length;

  if (isLoading) {
    return <div className="py-10 text-center text-sm text-muted-foreground">Loading travel…</div>;
  }

  if (confirmedBookings.length === 0 && confirmedSupport.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
        <Bus className="mx-auto mb-2 h-5 w-5" />
        Nobody is confirmed yet. Set people to Confirmed on the Roster tab.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Travel</h3>
          <p className="max-w-3xl text-xs text-muted-foreground">
            This sets only how each confirmed person gets to the meeting point, and how they
            get home from the departure point. When a leg is Bus, the address under it is that
            stop — the two addresses can be different. Self hides the address. A carer travelling
            with someone is their own line.
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-card/60 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide">
          <Bus className="h-3.5 w-3.5 text-info" />
          Bus seats: <span className="tabular-nums text-info">{busSeats}</span>
        </div>
      </div>
      {busIds.length > 1 && (
        <p className="text-xs text-muted-foreground">
          Drag people on the bus to set the pickup order. The driver can still reorder on the
          manifest.
        </p>
      )}

      {busIds.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            On the bus
          </h4>
          <PointerSortableList
            itemIds={busIds}
            onReorder={handlePickupReorder}
            disabled={reorderPickup.isPending}
          >
            {({ ids, bindRow }) => (
              <div className="space-y-1.5">
                {ids.map((key) => {
                  const bind = bindRow(key);
                  if (key.startsWith("s:")) {
                    const s = supportById.get(key.slice(2));
                    return s ? <div key={key}>{renderSupport(s, bind)}</div> : null;
                  }
                  if (key.startsWith("c:")) {
                    return <div key={key}>{renderCarer(key.slice(2), bind)}</div>;
                  }
                  const b = bookingById.get(key.slice(2));
                  return b ? <div key={key}>{renderBooking(b, bind)}</div> : null;
                })}
              </div>
            )}
          </PointerSortableList>
        </section>
      )}

      {(selfBookingIds.length > 0 || selfSupportIds.length > 0 || selfCarerIds.length > 0) && (
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Self — not on the bus
          </h4>
          <div className="space-y-1.5">
            {selfBookingIds.map((id) => {
              const b = bookingById.get(id);
              return b ? <div key={b.id}>{renderBooking(b)}</div> : null;
            })}
            {selfSupportIds.map((id) => {
              const s = supportById.get(id);
              return s ? <div key={s.id}>{renderSupport(s)}</div> : null;
            })}
            {selfCarerIds.map((id) => (
              <div key={`c:${id}`}>{renderCarer(id)}</div>
            ))}
          </div>
        </section>
      )}

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
    </div>
  );
}
