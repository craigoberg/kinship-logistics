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
import { CharacterCountedInput } from "@/components/ui/character-counted-input";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import {
  listStaffRegistry,
  listCarersRegistry,
  LOOKUP_CATEGORIES,
} from "@/lib/data-store";
import { useLookupParameters } from "@/hooks/use-supabase-data";
import { eventBusRunOptions } from "@/lib/event-bus-runs";
import {
  EVENT_SUPPORT_KEY,
  addEventSupportBooking,
} from "@/lib/api/event-support";
import { classifyWorkforceKind, type SupportPersonKind } from "@/lib/support-person";
import { listSupportSchedulesForPerson } from "@/lib/api/support-attendance";
import { isSelfTransportCode } from "@/components/transport/schedule-transport-pills";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  eventId: string;
  onClose: () => void;
}

export function AddEventSupportModal({ open, eventId, onClose }: Props) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<SupportPersonKind>("staff");
  const [personId, setPersonId] = useState("");
  const [outMode, setOutMode] = useState<"bus" | "self">("bus");
  const [retMode, setRetMode] = useState<"bus" | "self">("bus");
  const [outRun, setOutRun] = useState("");
  const [retRun, setRetRun] = useState("");
  const [address, setAddress] = useState("");

  const staffQ = useQuery({
    queryKey: ["staff-registry-support"],
    queryFn: listStaffRegistry,
    enabled: open,
  });
  const carerQ = useQuery({
    queryKey: ["carers-registry-support"],
    queryFn: listCarersRegistry,
    enabled: open,
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

  const people = useMemo(() => {
    if (kind === "carer") {
      return (carerQ.data ?? []).map((c) => ({
        id: c.id,
        name: c.fullName,
        subtitle: c.streetAddress ?? "",
      }));
    }
    return (staffQ.data ?? [])
      .filter((s) => s.active)
      .filter((s) => {
        const wk = classifyWorkforceKind(s.personnelType, s.role);
        return kind === "volunteer" ? wk === "volunteer" : wk === "staff";
      })
      .map((s) => ({ id: s.id, name: s.fullName, subtitle: s.streetAddress ?? s.role ?? "" }));
  }, [kind, staffQ.data, carerQ.data]);

  const missing: string[] = [];
  if (!personId) missing.push("Person");
  if (outMode === "bus" && busOpts.length > 1 && !outRun) missing.push("IN run");
  if (retMode === "bus" && busOpts.length > 1 && !retRun) missing.push("HOME run");

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
      toast.success("Support person added to the trip");
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
            Own pickup and drop-off methods — same as a client on this trip.
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
            <Label className="mb-2 block">Inbound</Label>
            <div className="grid grid-cols-2 gap-2">
              <MobileOptionButton label="Bus" selected={outMode === "bus"} onClick={() => setOutMode("bus")} />
              <MobileOptionButton label="Self" selected={outMode === "self"} onClick={() => setOutMode("self")} />
            </div>
            {outMode === "bus" &&
              busOpts.map((r) => (
                <MobileFieldButton
                  key={r.code}
                  title={r.shortLabel}
                  subtitle={r.displayName}
                  active={(outRun || busOpts[0]?.code) === r.code}
                  onClick={() => setOutRun(r.code)}
                />
              ))}
          </div>
          <div>
            <Label className="mb-2 block">Home</Label>
            <div className="grid grid-cols-2 gap-2">
              <MobileOptionButton label="Bus" selected={retMode === "bus"} onClick={() => setRetMode("bus")} />
              <MobileOptionButton label="Self" selected={retMode === "self"} onClick={() => setRetMode("self")} />
            </div>
            {retMode === "bus" &&
              busOpts.map((r) => (
                <MobileFieldButton
                  key={r.code}
                  title={r.shortLabel}
                  subtitle={r.displayName}
                  active={(retRun || busOpts[0]?.code) === r.code}
                  onClick={() => setRetRun(r.code)}
                />
              ))}
          </div>
          <CharacterCountedInput
            label="Pickup address (optional)"
            value={address}
            onValueChange={setAddress}
            required={false}
            minChars={0}
            maxChars={160}
          />
          {missing.length > 0 && (
            <p className="text-sm text-destructive">Need: {missing.join(", ")}</p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button disabled={missing.length > 0 || save.isPending} onClick={() => save.mutate()}>
            Add to trip
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
