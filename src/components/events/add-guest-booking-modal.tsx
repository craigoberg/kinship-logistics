/**
 * BL-098 — Add planned guest to event roster (creates/reuses guest participant).
 * Required fields use GUARDRAILS §4.3 red outline + missing checklist.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Loader2, UserRoundPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DatePicker,
  getDobDatePickerProps,
} from "@/components/ui/date-picker";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { MobileOptionButton } from "@/components/manifest/mobile-field-button";
import { listParticipants, type EventManifest } from "@/lib/data-store";
import { useLookupParameters } from "@/hooks/use-supabase-data";
import { LOOKUP_CATEGORIES } from "@/lib/data-store";
import { eventBusRunOptions } from "@/lib/event-bus-runs";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import { cn } from "@/lib/utils";
import {
  addGuestBookingToEvent,
  createGuestParticipant,
  listGuestParticipants,
  type GuestBookingPrefill,
  type GuestParticipant,
} from "@/lib/api/event-guest";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: EventManifest;
  /** Day Centre visitor → guest: seed name/host/note; force New mode. */
  prefill?: GuestBookingPrefill | null;
}

type Mode = "new" | "reuse";

function ReqLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label>
      {children}{" "}
      <span className="font-semibold text-destructive" aria-hidden>
        *
      </span>
    </Label>
  );
}

export function AddGuestBookingModal({
  open,
  onOpenChange,
  event,
  prefill = null,
}: Props) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("new");
  const [reuseId, setReuseId] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState<Date | undefined>(undefined);
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [emergencyRel, setEmergencyRel] = useState("");
  const [allergies, setAllergies] = useState("");
  const [street, setStreet] = useState("");
  const [pickup, setPickup] = useState("");

  const [hostId, setHostId] = useState<string | null>(null);
  const [opsNote, setOpsNote] = useState("");
  const [outbound, setOutbound] = useState<"bus" | "self">("bus");
  const [ret, setRet] = useState<"bus" | "self">("bus");
  const [outRun, setOutRun] = useState<string | null>(null);
  const [retRun, setRetRun] = useState<string | null>(null);
  const [medBag, setMedBag] = useState<"yes" | "no" | "not_set">("not_set");
  const [pickupOverride, setPickupOverride] = useState("");

  const fromVisitor = !!prefill;

  const guestsQ = useQuery({
    queryKey: ["guest-participants"],
    queryFn: listGuestParticipants,
    enabled: open && !fromVisitor,
    staleTime: 30_000,
  });
  const hostsQ = useQuery({
    queryKey: ["participants"],
    queryFn: listParticipants,
    enabled: open,
    staleTime: 60_000,
  });
  const { data: busRunLookups = [] } = useLookupParameters(LOOKUP_CATEGORIES.busRun);
  const busRunOpts = useMemo(() => eventBusRunOptions(busRunLookups), [busRunLookups]);

  const reset = () => {
    setMode("new");
    setReuseId(null);
    setFirstName("");
    setLastName("");
    setDob(undefined);
    setEmergencyName("");
    setEmergencyPhone("");
    setEmergencyRel("");
    setAllergies("");
    setStreet("");
    setPickup("");
    setHostId(null);
    setOpsNote("");
    setOutbound("bus");
    setRet("bus");
    setOutRun(null);
    setRetRun(null);
    setMedBag("not_set");
    setPickupOverride("");
  };

  useEffect(() => {
    if (!open || !prefill) return;
    setMode("new");
    setReuseId(null);
    setFirstName(prefill.firstName);
    setLastName(prefill.lastName);
    setDob(undefined);
    setEmergencyName("");
    setEmergencyPhone("");
    setEmergencyRel("");
    setAllergies("");
    setStreet("");
    setPickup("");
    setHostId(prefill.hostParticipantId ?? null);
    setOpsNote(prefill.opsNote ?? "");
    setOutbound("bus");
    setRet("bus");
    setOutRun(null);
    setRetRun(null);
    setMedBag("not_set");
    setPickupOverride("");
  }, [
    open,
    prefill?.sourceVisitorId,
    prefill?.firstName,
    prefill?.lastName,
    prefill?.hostParticipantId,
    prefill?.opsNote,
  ]);

  const needsBus = outbound === "bus" || ret === "bus";
  const pickupOk = !needsBus
    ? true
    : !!(
        pickupOverride.trim() ||
        pickup.trim() ||
        street.trim() ||
        (mode === "reuse" &&
          (guestsQ.data?.find((g) => g.id === reuseId)?.regularPickupAddress ||
            guestsQ.data?.find((g) => g.id === reuseId)?.streetAddress))
      );
  const medBagOk = outbound === "self" || medBag !== "not_set";

  const missing = useMemo(() => {
    const items: string[] = [];
    if (mode === "reuse") {
      if (!reuseId) items.push("Select a guest to reuse");
    } else {
      if (!firstName.trim()) items.push("First name");
      if (!lastName.trim()) items.push("Last name");
      if (!dob) items.push("Date of birth");
      if (!emergencyName.trim()) items.push("Emergency contact name");
      if (!emergencyPhone.trim()) items.push("Emergency phone");
      if (!allergies.trim()) items.push('Allergies / alerts (enter "None" if none)');
    }
    if (outbound === "bus" && medBag === "not_set") {
      items.push("Transport med bag — Yes or No");
    }
    if (needsBus && !pickupOk) {
      items.push("Pickup or home address (required when busing)");
    }
    return items;
  }, [
    mode,
    reuseId,
    firstName,
    lastName,
    dob,
    emergencyName,
    emergencyPhone,
    allergies,
    outbound,
    medBag,
    needsBus,
    pickupOk,
  ]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (missing.length > 0) {
        throw new Error(`Still needed: ${missing.join("; ")}`);
      }
      let participantId = reuseId;
      if (mode === "new") {
        if (!dob) throw new Error("Date of birth is required.");
        const y = dob.getFullYear();
        const m = String(dob.getMonth() + 1).padStart(2, "0");
        const d = String(dob.getDate()).padStart(2, "0");
        const created = await createGuestParticipant({
          firstName,
          lastName,
          dateOfBirth: `${y}-${m}-${d}`,
          emergencyContactName: emergencyName,
          emergencyContactPhone: emergencyPhone,
          emergencyContactRelationship: emergencyRel,
          allergiesNotes: allergies,
          streetAddress: street,
          regularPickupAddress: pickup || pickupOverride || street,
        });
        participantId = created.id;
      } else if (!participantId) {
        throw new Error("Select an existing guest to reuse.");
      }

      const effectivePickup =
        pickupOverride.trim() ||
        pickup.trim() ||
        street.trim() ||
        (mode === "reuse"
          ? guestsQ.data?.find((g) => g.id === participantId)?.regularPickupAddress ||
            guestsQ.data?.find((g) => g.id === participantId)?.streetAddress
          : null);

      return addGuestBookingToEvent({
        eventId: event.id,
        participantId: participantId!,
        hostParticipantId: hostId,
        guestOpsNote: opsNote,
        outboundTransportMode: outbound,
        returnTransportMode: ret,
        outboundBusRunCode: outRun,
        returnBusRunCode: retRun,
        tripPickupAddressOverride: effectivePickup,
        transportMedBagRequired: outbound === "bus" ? medBag : "no",
        ticketPrice: event.ticketPrice,
        eventTitle: event.title,
      });
    },
    onSuccess: () => {
      toast.success("Guest added to roster.");
      qc.invalidateQueries({ queryKey: ["event_roster_bookings", event.id] });
      qc.invalidateQueries({ queryKey: ["guest-participants"] });
      qc.invalidateQueries({ queryKey: ["participants"] });
      reset();
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast.error("Could not add guest", { description: e.message }),
  });

  const guests = guestsQ.data ?? [];
  const hosts = (hostsQ.data ?? []).filter(
    (p) => !guests.some((g) => g.id === p.id),
  );
  const selectedReuse: GuestParticipant | undefined = guests.find(
    (g) => g.id === reuseId,
  );
  const formReady = missing.length === 0 && !saveMut.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (saveMut.isPending) return;
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add guest / friend</DialogTitle>
          <DialogDescription>
            {fromVisitor
              ? "Name, host, and note were filled from the Day Centre visitor. Complete DOB, emergency contact, and allergies to add them to this event."
              : "Creates a real participant record (guest) and a roster booking. They ride the same floor paths as clients. Non-NDIS billing."}
          </DialogDescription>
        </DialogHeader>

        {missing.length > 0 && (
          <div className="space-y-1.5 rounded-lg border-2 border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Complete required fields to enable Add guest
            </div>
            <ul className="ml-5 list-disc space-y-0.5 text-xs">
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-4">
          {!fromVisitor && (
            <div className="grid grid-cols-2 gap-2">
              <MobileOptionButton
                label="New guest"
                selected={mode === "new"}
                onClick={() => {
                  setMode("new");
                  setReuseId(null);
                }}
              />
              <MobileOptionButton
                label="Reuse guest"
                selected={mode === "reuse"}
                onClick={() => setMode("reuse")}
              />
            </div>
          )}

          {mode === "reuse" ? (
            <div
              className={cn(
                "rounded-md border",
                requiredFieldOutline(!reuseId),
              )}
            >
              <Command>
                <CommandInput placeholder="Search previous guests…" />
                <CommandList className="max-h-44">
                  {guestsQ.isLoading ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  ) : guests.length === 0 ? (
                    <CommandEmpty>No guest records yet.</CommandEmpty>
                  ) : (
                    <CommandGroup>
                      {guests.map((g) => (
                        <CommandItem
                          key={g.id}
                          value={g.fullName}
                          onSelect={() => setReuseId(g.id)}
                          className={
                            reuseId === g.id ? "bg-primary/10 text-primary" : ""
                          }
                        >
                          {g.fullName}
                          {g.archivedAt ? (
                            <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                              archived
                            </span>
                          ) : null}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <ReqLabel>First name</ReqLabel>
                  <Input
                    className={cn("h-11", requiredFieldOutline(!firstName.trim()))}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <ReqLabel>Last name</ReqLabel>
                  <Input
                    className={cn("h-11", requiredFieldOutline(!lastName.trim()))}
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <ReqLabel>Date of birth</ReqLabel>
                <DatePicker
                  value={dob}
                  onChange={setDob}
                  className={requiredFieldOutline(!dob)}
                  {...getDobDatePickerProps()}
                />
              </div>
              <div className="space-y-1">
                <ReqLabel>Emergency contact name</ReqLabel>
                <Input
                  className={cn(
                    "h-11",
                    requiredFieldOutline(!emergencyName.trim()),
                  )}
                  value={emergencyName}
                  onChange={(e) => setEmergencyName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <ReqLabel>Emergency phone</ReqLabel>
                  <Input
                    className={cn(
                      "h-11",
                      requiredFieldOutline(!emergencyPhone.trim()),
                    )}
                    value={emergencyPhone}
                    onChange={(e) => setEmergencyPhone(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Relationship</Label>
                  <Input
                    className="h-11"
                    value={emergencyRel}
                    onChange={(e) => setEmergencyRel(e.target.value)}
                    placeholder="Optional"
                  />
                </div>
              </div>
              <CharacterCountedTextarea
                label='Allergies / alerts'
                value={allergies}
                onValueChange={setAllergies}
                minChars={1}
                maxChars={500}
                required
                counterMode="minimum"
                placeholder='Required — enter "None" if none known'
                rows={2}
              />
              <div className="space-y-1">
                <Label>Home / street address</Label>
                <Input
                  className={cn(
                    "h-11",
                    needsBus &&
                      requiredFieldOutline(
                        !street.trim() && !pickup.trim() && !pickupOverride.trim(),
                      ),
                  )}
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>
                  Regular pickup address
                  {needsBus ? (
                    <span className="font-semibold text-destructive"> *</span>
                  ) : null}
                </Label>
                <Input
                  className={cn(
                    "h-11",
                    needsBus &&
                      requiredFieldOutline(
                        !pickup.trim() && !street.trim() && !pickupOverride.trim(),
                      ),
                  )}
                  value={pickup}
                  onChange={(e) => setPickup(e.target.value)}
                  placeholder={
                    needsBus
                      ? "Required if busing (or use home address)"
                      : "Optional when self-transport"
                  }
                />
              </div>
            </div>
          )}

          {selectedReuse && (
            <p className="text-xs text-muted-foreground">
              Reusing {selectedReuse.fullName}
              {selectedReuse.archivedAt ? " (will reactivate)" : ""}.
            </p>
          )}

          <div className="space-y-1">
            <Label>Accompanying client (optional)</Label>
            <div className="rounded-md border">
              <Command>
                <CommandInput placeholder="Search clients…" />
                <CommandList className="max-h-36">
                  <CommandGroup>
                    <CommandItem value="__none__" onSelect={() => setHostId(null)}>
                      None
                    </CommandItem>
                    {hosts.map((p) => (
                      <CommandItem
                        key={p.id}
                        value={p.fullName}
                        onSelect={() => setHostId(p.id)}
                        className={
                          hostId === p.id ? "bg-primary/10 text-primary" : ""
                        }
                      >
                        {p.fullName}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Ticket / room / capacity note</Label>
            <Textarea
              rows={2}
              value={opsNote}
              onChange={(e) => setOpsNote(e.target.value)}
              placeholder="Optional — booking refs, room share…"
            />
          </div>

          <div className="space-y-2">
            <ReqLabel>Outbound transport</ReqLabel>
            <div className="grid grid-cols-2 gap-2">
              <MobileOptionButton
                label="Bus"
                selected={outbound === "bus"}
                onClick={() => setOutbound("bus")}
              />
              <MobileOptionButton
                label="Self"
                selected={outbound === "self"}
                onClick={() => {
                  setOutbound("self");
                  setMedBag("no");
                }}
              />
            </div>
            {outbound === "bus" && busRunOpts.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {busRunOpts.map((opt) => (
                  <MobileOptionButton
                    key={opt.code}
                    label={opt.shortLabel}
                    hint={opt.displayName}
                    selected={outRun === opt.code}
                    onClick={() => setOutRun(opt.code)}
                  />
                ))}
              </div>
            )}
            {outbound === "bus" && (
              <div
                className={cn(
                  "space-y-2 rounded-lg p-2",
                  requiredFieldOutline(!medBagOk),
                )}
              >
                <ReqLabel>Transport med bag</ReqLabel>
                <div className="grid grid-cols-2 gap-2">
                  <MobileOptionButton
                    label="Med bag: Yes"
                    selected={medBag === "yes"}
                    onClick={() => setMedBag("yes")}
                  />
                  <MobileOptionButton
                    label="Med bag: No"
                    selected={medBag === "no"}
                    onClick={() => setMedBag("no")}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <ReqLabel>Return transport</ReqLabel>
            <div className="grid grid-cols-2 gap-2">
              <MobileOptionButton
                label="Bus"
                selected={ret === "bus"}
                onClick={() => setRet("bus")}
              />
              <MobileOptionButton
                label="Self"
                selected={ret === "self"}
                onClick={() => setRet("self")}
              />
            </div>
            {ret === "bus" && busRunOpts.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {busRunOpts.map((opt) => (
                  <MobileOptionButton
                    key={opt.code}
                    label={opt.shortLabel}
                    hint={opt.displayName}
                    selected={retRun === opt.code}
                    onClick={() => setRetRun(opt.code)}
                  />
                ))}
              </div>
            )}
          </div>

          {needsBus && (
            <div className="space-y-1">
              <Label>Trip pickup override (if needed)</Label>
              <Input
                className="h-11"
                value={pickupOverride}
                onChange={(e) => setPickupOverride(e.target.value)}
                placeholder="Overrides regular pickup for this event"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          <Button
            type="button"
            disabled={!formReady}
            onClick={() => saveMut.mutate()}
            className="gap-2"
            title={
              missing.length > 0
                ? `Still needed: ${missing.join("; ")}`
                : undefined
            }
          >
            {saveMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserRoundPlus className="h-4 w-4" />
            )}
            Add guest
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
