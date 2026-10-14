/**
 * Event Manage: add staff / volunteer / carer with own IN/HOME methods.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { MobileFieldButton, MobileOptionButton } from "@/components/manifest/mobile-field-button";
import {
  StopAddressChoices,
  choiceFromOverrideText,
} from "@/components/address/stop-address-picker";
import { personAddressQueryKey } from "@/components/address/person-address-list";
import { listPersonAddresses, loadHomeAddress } from "@/lib/api/person-addresses";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import {
  listStaffRegistry,
  listCarersRegistry,
  LOOKUP_CATEGORIES,
} from "@/lib/data-store";
import { useLookupParameters } from "@/hooks/use-supabase-data";
import { useAuthReady } from "@/hooks/use-auth-ready";
import { eventBusRunOptions } from "@/lib/event-bus-runs";
import {
  EVENT_SUPPORT_KEY,
  addEventSupportBooking,
  type EventSupportBooking,
} from "@/lib/api/event-support";
import { classifyWorkforceKind, type SupportPersonKind } from "@/lib/support-person";
import { listSupportSchedulesForPerson } from "@/lib/api/support-attendance";
import { isSelfTransportCode } from "@/components/transport/schedule-transport-pills";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  eventId: string;
  ticketPrice: number;
  existingBookings: EventSupportBooking[];
  onClose: () => void;
}

export function AddEventSupportModal({
  open,
  eventId,
  ticketPrice,
  existingBookings,
  onClose,
}: Props) {
  const qc = useQueryClient();
  const { user, isReady } = useAuthReady();
  const signedIn = isReady && !!user;
  const [kind, setKind] = useState<SupportPersonKind>("staff");
  const [personId, setPersonId] = useState("");
  const [outMode, setOutMode] = useState<"bus" | "self">("bus");
  const [retMode, setRetMode] = useState<"bus" | "self">("bus");
  const [outRun, setOutRun] = useState("");
  const [retRun, setRetRun] = useState("");
  const [address, setAddress] = useState("");
  const addressOwner = {
    kind: (kind === "carer" ? "carer" : "staff") as "carer" | "staff",
    id: personId,
  };
  const placesQ = useQuery({
    queryKey: personAddressQueryKey(addressOwner),
    queryFn: () => listPersonAddresses(addressOwner),
    enabled: open && !!personId,
  });
  const homeQ = useQuery({
    queryKey: ["home-address", addressOwner.kind, personId],
    queryFn: () => loadHomeAddress(addressOwner),
    enabled: open && !!personId,
  });

  const staffQ = useQuery({
    queryKey: ["staff-registry-support"],
    queryFn: listStaffRegistry,
    enabled: open && signedIn,
  });
  const carerQ = useQuery({
    queryKey: ["carers-registry-support"],
    queryFn: listCarersRegistry,
    enabled: open && signedIn,
  });
  const { data: busRunLookups = [] } = useLookupParameters(LOOKUP_CATEGORIES.busRun);
  const busOpts = useMemo(() => eventBusRunOptions(busRunLookups), [busRunLookups]);

  const defaultsQ = useQuery({
    queryKey: ["support-schedule-defaults", kind, personId],
    queryFn: () =>
      listSupportSchedulesForPerson({
        staffId: kind === "carer" ? null : personId,
        carerId: kind === "carer" ? personId : null,
      }),
    enabled: open && !!personId,
  });

  useEffect(() => {
    if (!personId || !defaultsQ.data?.length) return;
    const first = defaultsQ.data[0];
    const inbound = first.inboundTransport ?? "";
    const outbound = first.outboundTransport ?? "";
    if (isSelfTransportCode(inbound) || !inbound) {
      setOutMode("self");
      setOutRun("");
    } else {
      setOutMode("bus");
      setOutRun(inbound);
    }
    if (isSelfTransportCode(outbound) || !outbound) {
      setRetMode("self");
      setRetRun("");
    } else {
      setRetMode("bus");
      setRetRun(outbound);
    }
    if (first.pickupAddressOverride) setAddress(first.pickupAddressOverride);
  }, [personId, defaultsQ.data]);

  const onTrip = useMemo(() => {
    const blocked = new Set<string>();
    const comingBack = new Set<string>();
    for (const b of existingBookings) {
      const id = b.personKind === "carer" ? b.carerId : b.staffId;
      if (!id) continue;
      blocked.add(id);
    }
    return { blocked, comingBack };
  }, [existingBookings]);

  const people = useMemo(() => {
    const mapRow = (id: string, name: string, subtitle: string) => ({
      id,
      name,
      subtitle: onTrip.comingBack.has(id)
        ? "Was on this trip — adding puts the same booking back"
        : subtitle,
    });
    if (kind === "carer") {
      return (carerQ.data ?? [])
        .filter((c) => !onTrip.blocked.has(c.id))
        .map((c) => mapRow(c.id, c.fullName, c.streetAddress ?? ""));
    }
    return (staffQ.data ?? [])
      .filter((s) => s.active && !onTrip.blocked.has(s.id))
      .filter((s) => {
        const wk = classifyWorkforceKind(s.personnelType, s.role);
        return kind === "volunteer" ? wk === "volunteer" : wk === "staff";
      })
      .map((s) => mapRow(s.id, s.fullName, s.streetAddress ?? s.role ?? ""));
  }, [kind, staffQ.data, carerQ.data, onTrip]);

  const missing: string[] = [];
  if (!personId) missing.push("Person");
  const save = useMutation({
    mutationFn: () =>
      addEventSupportBooking({
        eventId,
        personKind: kind,
        staffId: kind === "carer" ? null : personId,
        carerId: kind === "carer" ? personId : null,
        outboundTransportMode: outMode,
        returnTransportMode: retMode,
        outboundBusRunCode: outMode === "bus" ? outRun || busOpts[0]?.code || null : null,
        returnBusRunCode: retMode === "bus" ? retRun || busOpts[0]?.code || null : null,
        tripPickupAddressOverride: address,
      }),
    onSuccess: () => {
      toast.success(
        onTrip.comingBack.has(personId)
          ? "Back on the trip. Earlier payments and refunds are unchanged."
          : "Support person added to the trip",
      );
      void qc.invalidateQueries({ queryKey: EVENT_SUPPORT_KEY(eventId) });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add support person</DialogTitle>
          <DialogDescription>
            They count toward trip capacity. Cost starts at the full event price ($
            {ticketPrice.toFixed(2)}). Change it on the roster if they pay only some of it.
            Meeting point is how they reach the first stop (bus or self).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {(["staff", "volunteer", "carer"] as const).map((k) => (
              <MobileOptionButton
                key={k}
                label={k === "carer" ? "Carer" : k === "volunteer" ? "Volunteer" : "Staff"}
                selected={kind === k}
                onClick={() => {
                  setKind(k);
                  setPersonId("");
                }}
              />
            ))}
          </div>
          <div className={cn("max-h-48 space-y-1 overflow-y-auto rounded-md p-1", requiredFieldOutline(!personId))}>
            {people.map((p) => (
              <MobileFieldButton
                key={p.id}
                title={p.name}
                subtitle={p.subtitle || undefined}
                active={personId === p.id}
                onClick={() => setPersonId(p.id)}
              />
            ))}
          </div>
          <div>
            <Label className="mb-2 block">To meeting point</Label>
            <div className="grid grid-cols-2 gap-2">
              <MobileOptionButton label="Bus" selected={outMode === "bus"} onClick={() => setOutMode("bus")} />
              <MobileOptionButton label="Self" selected={outMode === "self"} onClick={() => setOutMode("self")} />
            </div>
          </div>
          <div>
            <Label className="mb-2 block">Departure to home</Label>
            <div className="grid grid-cols-2 gap-2">
              <MobileOptionButton label="Bus" selected={retMode === "bus"} onClick={() => setRetMode("bus")} />
              <MobileOptionButton label="Self" selected={retMode === "self"} onClick={() => setRetMode("self")} />
            </div>
          </div>
          {personId ? (
            <div className="space-y-2">
              <Label>Pickup place (this event)</Label>
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
            </div>
          ) : null}
          {missing.length > 0 && (
            <p className="text-sm text-destructive">Need: {missing.join(", ")}</p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button disabled={missing.length > 0 || save.isPending} onClick={() => save.mutate()}>
            {onTrip.comingBack.has(personId) ? "Put back on trip" : "Add to trip"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
