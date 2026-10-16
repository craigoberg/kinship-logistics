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
import { loadLinkedHomeStreets, ownerFromLeg, type AddressOwner } from "@/lib/api/person-addresses";
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

function surnameKey(name: string, lastName?: string | null): string {
  const last =
    (lastName ?? "").trim() ||
    name.trim().split(/\s+/).filter(Boolean).at(-1) ||
    name;
  return `${last}\u0000${name}`.toLocaleLowerCase();
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
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

  const companionCarerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const b of confirmedBookings) {
      if (!b.bringsCarer) continue;
      const carerId = b.carerId || b.companionCarerId;
      if (!carerId || supportCarerIds.has(carerId)) continue;
      ids.add(carerId);
    }
    return [...ids].sort();
  }, [confirmedBookings, supportCarerIds]);

  const linkedCarerHomes = useQuery({
    queryKey: ["linked-home", "carer", companionCarerIds],
    queryFn: () => loadLinkedHomeStreets("carer", companionCarerIds),
    enabled: companionCarerIds.length > 0,
  });

  const companions = useMemo(() => {
    const groups = new Map<string, EventRosterBooking[]>();
    for (const b of confirmedBookings) {
      if (!b.bringsCarer) continue;
      const carerId = b.carerId || b.companionCarerId;
      if (!carerId || supportCarerIds.has(carerId)) continue;
      const list = groups.get(carerId) ?? [];
      list.push(b);
      groups.set(carerId, list);
    }
    return [...groups.entries()].map(([carerId, bookings]) => {
      const ordered = [...bookings].sort(
        (a, b) =>
          surnameKey(a.participantName, a.participantLastName).localeCompare(
            surnameKey(b.participantName, b.participantLastName),
          ) || a.id.localeCompare(b.id),
      );
      const booking =
        [...ordered].sort(
          (a, b) =>
            (a.carerPickupOrder ?? a.pickupOrder ?? 9999) -
            (b.carerPickupOrder ?? b.pickupOrder ?? 9999),
        )[0] ?? ordered[0]!;
      const carer = carersById.get(carerId);
      const outbound = carerLegMode(booking.carerOutboundTransportMode, booking.carerTransportRequired);
      const ret = carerLegMode(booking.carerReturnTransportMode, booking.carerTransportRequired);
      const profile =
        (carer?.streetAddress ?? "").trim() || linkedCarerHomes.data?.get(carerId) || "";
      const meeting = legAddress(booking.carerTripPickupAddressOverride, profile);
      return {
        booking,
        bookingIds: ordered.map((row) => row.id),
        withLabel: joinNames(ordered.map((row) => row.participantName)),
        carerId,
        name: carer?.fullName || "Carer",
        outbound,
        ret,
        profile,
        meeting,
        home: legAddress(booking.carerTripReturnAddressOverride, meeting || profile),
      };
    });
  }, [carersById, confirmedBookings, linkedCarerHomes.data, supportCarerIds]);

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
    void qc.invalidateQueries({ queryKey: ["event-venue-stops", event.id] });
  };

  const saveParticipant = useMutation({
    mutationFn: (input: {
      booking: EventRosterBooking;
      outbound: "bus" | "self";
      ret: "bus" | "self";
      pickup?: string | null;
      home?: string | null;
      pickupJoin?: string | null;
      alightMode?: string | null;
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
        pickup_join: input.pickupJoin,
        alight_mode: input.alightMode,
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
      pickupJoin?: string | null;
      alightMode?: string | null;
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
        pickupJoin: input.pickupJoin,
        alightMode: input.alightMode,
      }),
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast.error(err.message),
    onSettled: () => setSavingId(null),
  });

  const saveCarer = useMutation({
    mutationFn: async (input: {
      bookingIds: string[];
      displayName: string;
      outbound: "bus" | "self";
      ret: "bus" | "self";
      pickup?: string | null;
      home?: string | null;
      pickupJoin?: string | null;
      alightMode?: string | null;
    }) => {
      for (const bookingId of input.bookingIds) {
        await updateCompanionCarerTravel({
          bookingId,
          displayName: input.displayName,
          outbound: input.outbound,
          ret: input.ret,
          pickupAddress: input.pickup,
          returnAddress: input.home,
          pickupJoin: input.pickupJoin,
          alightMode: input.alightMode,
        });
      }
    },
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast.error(err.message),
    onSettled: () => setSavingId(null),
  });

  const handlePickupReorder = useCallback(
    (orderedIds: string[]) => {
      const ordered: Array<{
        kind: "participant" | "support" | "carer";
        id: string;
        order: number;
      }> = [];
      orderedIds.forEach((key, index) => {
        const order = index + 1;
        if (key.startsWith("c:")) {
          const group = companionByBookingId.get(key.slice(2));
          const ids = group?.bookingIds ?? [key.slice(2)];
          for (const id of ids) ordered.push({ kind: "carer", id, order });
          return;
        }
        ordered.push({
          kind: key.startsWith("s:") ? "support" : "participant",
          id: key.slice(2),
          order,
        });
      });
      reorderPickup.mutate({ eventId: event.id, ordered });
    },
    [companionByBookingId, event.id, reorderPickup],
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
    pickupJoin: string | null,
    alightMode: string | null,
    onPickupJoin: (mode: "meeting_point" | "home" | "address") => void,
    onAlightMode: (mode: "departure_point" | "home" | "same" | "address") => void,
    addressOwner: AddressOwner | null,
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
        pickupJoin={pickupJoin}
        alightMode={alightMode}
        onPickupJoin={onPickupJoin}
        onAlightMode={onAlightMode}
        addressOwner={addressOwner}
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
    const doorMeeting = legAddress(b.tripPickupAddressOverride, profile);
    const meeting =
      b.pickupJoin === "address" ? (b.tripPickupAddressOverride ?? "") : doorMeeting;
    const leavesEarly = b.alightMode === "address" || b.alightMode === "same";
    const home = leavesEarly
      ? b.alightMode === "same"
        ? meeting
        : (b.tripReturnAddressOverride ?? "")
      : legAddress(b.tripReturnAddressOverride, doorMeeting || profile);
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
          pickup:
            b.pickupJoin === "address" ? next.trim() || null : legOverrideToStore(next, profile),
          pickupJoin: b.pickupJoin === "address" ? "address" : undefined,
        });
      },
      (next) => {
        setSavingId(b.id);
        saveParticipant.mutate({
          booking: b,
          outbound,
          ret,
          home:
            b.alightMode === "address" || b.alightMode === "same"
              ? next.trim() || null
              : legOverrideToStore(next, doorMeeting || profile),
          alightMode:
            b.alightMode === "address" || b.alightMode === "same" ? "address" : undefined,
        });
      },
      b.pickupJoin,
      b.alightMode,
      (mode) => {
        setSavingId(b.id);
        saveParticipant.mutate({
          booking: b,
          outbound: mode === "address" ? "self" : outbound,
          ret,
          pickupJoin: mode,
        });
      },
      (mode) => {
        setSavingId(b.id);
        saveParticipant.mutate({
          booking: b,
          outbound,
          ret: mode === "address" || mode === "home" ? "bus" : ret,
          alightMode: mode,
        });
      },
      b.participantId ? { kind: "participant", id: b.participantId } : null,
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
  ) => {
    const door = legAddress(s.tripPickupAddressOverride, s.profileAddress);
    return personRow(
      s.displayName,
      s.personKind,
      null,
      s.outboundTransportMode,
      s.returnTransportMode,
      s.pickupJoin === "address" ? (s.tripPickupAddressOverride ?? "") : door,
      s.alightMode === "same"
        ? s.pickupJoin === "address"
          ? (s.tripPickupAddressOverride ?? "")
          : door
        : s.alightMode === "address"
          ? (s.tripReturnAddressOverride ?? "")
          : legAddress(s.tripReturnAddressOverride, door || s.profileAddress),
      (mode) => setSupportMode(s, "meet", mode),
      (mode) => setSupportMode(s, "home", mode),
      (next) => {
        setSavingId(s.id);
        saveSupport.mutate({
          booking: s,
          outbound: s.outboundTransportMode,
          ret: s.returnTransportMode,
          pickup:
            s.pickupJoin === "address" ? next.trim() || null : legOverrideToStore(next, s.profileAddress),
          pickupJoin: s.pickupJoin === "address" ? "address" : undefined,
        });
      },
      (next) => {
        setSavingId(s.id);
        saveSupport.mutate({
          booking: s,
          outbound: s.outboundTransportMode,
          ret: s.returnTransportMode,
          home:
            s.alightMode === "address" || s.alightMode === "same"
              ? next.trim() || null
              : legOverrideToStore(next, door || s.profileAddress),
          alightMode:
            s.alightMode === "address" || s.alightMode === "same" ? "address" : undefined,
        });
      },
      s.pickupJoin,
      s.alightMode,
      (mode) => {
        setSavingId(s.id);
        saveSupport.mutate({
          booking: s,
          outbound: mode === "address" ? "self" : s.outboundTransportMode,
          ret: s.returnTransportMode,
          pickupJoin: mode,
        });
      },
      (mode) => {
        setSavingId(s.id);
        saveSupport.mutate({
          booking: s,
          outbound: s.outboundTransportMode,
          ret: mode === "address" || mode === "home" ? "bus" : s.returnTransportMode,
          alightMode: mode,
        });
      },
      ownerFromLeg({ staffId: s.staffId, carerId: s.carerId }),
      () => {
        const netPaid = supportPaidById.get(s.id) ?? s.amountPaid;
        setEditSupport({ ...s, amountPaid: netPaid });
      },
      savingId === s.id,
      null,
      rowBind,
    );
  };

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
    const save = (patch: {
      outbound?: "bus" | "self";
      ret?: "bus" | "self";
      pickup?: string | null;
      home?: string | null;
      pickupJoin?: string | null;
      alightMode?: string | null;
    }) => {
      setSavingId(c.booking.id);
      saveCarer.mutate({
        bookingIds: c.bookingIds,
        displayName: c.name,
        outbound: patch.outbound ?? c.outbound,
        ret: patch.ret ?? c.ret,
        pickup: patch.pickup,
        home: patch.home,
        pickupJoin: patch.pickupJoin,
        alightMode: patch.alightMode,
      });
    };
    const pickupJoin = c.booking.carerPickupJoin;
    const alightMode = c.booking.carerAlightMode;
    return personRow(
      c.name,
      "carer",
      `Carer for ${c.withLabel}`,
      c.outbound,
      c.ret,
      pickupJoin === "address" ? (c.booking.carerTripPickupAddressOverride ?? "") : c.meeting,
      alightMode === "same"
        ? c.meeting
        : alightMode === "address"
          ? (c.booking.carerTripReturnAddressOverride ?? "")
          : c.home,
      (mode) => save({ outbound: mode }),
      (mode) => save({ ret: mode }),
      (next) =>
        save({
          pickup: pickupJoin === "address" ? next.trim() || null : legOverrideToStore(next, c.profile),
          pickupJoin: pickupJoin === "address" ? "address" : undefined,
        }),
      (next) =>
        save({
          home:
            alightMode === "address" || alightMode === "same"
              ? next.trim() || null
              : legOverrideToStore(next, c.meeting || c.profile),
          alightMode: alightMode === "address" || alightMode === "same" ? "address" : undefined,
        }),
      pickupJoin,
      alightMode,
      (mode) => save({ pickupJoin: mode, outbound: mode === "address" ? "self" : c.outbound }),
      (mode) =>
        save({
          alightMode: mode,
          ret: mode === "address" || mode === "home" ? "bus" : c.ret,
        }),
      { kind: "carer", id: c.carerId },
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
            Joins trip is At meeting point or On trip. Leaves trip is At departure point or Before
            departure. At the meeting point, Bus or Self is how they get there. On trip, they make
            their own way to the address and the bus collects them there. Before departure, the bus
            drops them at that address and the itinerary gains a line. From the departure point,
            Bus or Self is how they get home. A carer, staff member, or volunteer is their own line.
            One carer with several people is still one line, and a change is saved for each of them.
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
