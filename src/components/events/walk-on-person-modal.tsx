/**
 * BL-122 — Unplanned walk-on (guest / client / carer).
 * Manifest stop or Event Deliver Check-In. Driver PIN accepts the risk.
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
import { Badge } from "@/components/ui/badge";
import { CharacterCountedInput } from "@/components/ui/character-counted-input";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { MobileOptionButton } from "@/components/manifest/mobile-field-button";
import { PinEntryDialog } from "@/components/auth/pin-entry-dialog";
import { verifyOperatorPin } from "@/components/auth/pin-verify";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import { cn } from "@/lib/utils";
import { listCarersForParticipant, type Carer } from "@/lib/data-store";
import { listGuestParticipants } from "@/lib/api/event-guest";
import {
  addEventWalkOn,
  listWalkOnBookings,
  listWalkOnClientCandidates,
  listWalkOnHosts,
  type WalkOnKind,
  type WalkOnSource,
} from "@/lib/api/event-walk-on";

export function WalkOnCompanionsLine({
  eventId,
  boardedLegId,
  hostParticipantId,
}: {
  eventId: string;
  boardedLegId?: string | null;
  hostParticipantId?: string | null;
}) {
  const q = useQuery({
    queryKey: ["event-walk-ons", eventId],
    queryFn: () => listWalkOnBookings(eventId),
    enabled: !!eventId,
    staleTime: 10_000,
  });
  const rows = (q.data ?? []).filter((w) => {
    if (boardedLegId && w.boardedLegId === boardedLegId) return true;
    if (
      hostParticipantId &&
      (w.hostParticipantId === hostParticipantId ||
        (w.carerIsWalkOn && w.participantId === hostParticipantId))
    ) {
      return true;
    }
    return false;
  });
  if (rows.length === 0) return null;
  return (
    <div className="mt-2 space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
      {rows.map((w) => (
        <div key={w.bookingId} className="font-medium">
          {w.carerIsWalkOn && w.carerName
            ? `Also boarding: ${w.carerName}`
            : `Also boarding: ${w.participantName}`}{" "}
          <WalkOnBadge carer={w.carerIsWalkOn && !w.isWalkOn} />
        </div>
      ))}
    </div>
  );
}

/** Manifest active-stop header — same chrome as pickup Cancel / Absent. */
export function WalkOnStopIconButton({
  onClick,
  disabled,
  className,
}: {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={cn(
        "h-9 w-9 shrink-0 border-amber-500/50 text-amber-600 hover:bg-amber-500/10 hover:text-amber-700",
        className,
      )}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label="Someone extra here"
      title="Someone extra here"
    >
      <UserRoundPlus className="h-4 w-4" />
    </Button>
  );
}

/** Event Deliver Check-In — quiet footer under the roll, not a floor CTA. */
export function WalkOnFloorButton({
  label,
  className,
  onClick,
}: {
  label: string;
  className?: string;
  onClick: () => void;
}) {
  return (
    <div className="flex justify-center pt-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onClick}
        className={cn("h-8 gap-1.5 text-xs text-muted-foreground", className)}
      >
        <UserRoundPlus className="h-3.5 w-3.5" />
        {label}
      </Button>
    </div>
  );
}

export function WalkOnBadge({
  className,
  carer,
}: {
  className?: string;
  carer?: boolean;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] uppercase tracking-wide border-amber-500/50 bg-amber-500/10 text-amber-800",
        className,
      )}
    >
      {carer ? "Carer · Walk-on" : "Walk-on · Intake incomplete"}
    </Badge>
  );
}

export type WalkOnPersonModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  source: WalkOnSource;
  eventDaySessionId?: string | null;
  hostParticipantId?: string | null;
  pickupAddress?: string | null;
  boardedLegId?: string | null;
  busRunCode?: string | null;
};

export function WalkOnPersonModal({
  open,
  onOpenChange,
  eventId,
  source,
  eventDaySessionId = null,
  hostParticipantId = null,
  pickupAddress = null,
  boardedLegId = null,
  busRunCode = null,
}: WalkOnPersonModalProps) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<WalkOnKind>("guest");
  const [hostId, setHostId] = useState<string | null>(hostParticipantId);
  const [guestMode, setGuestMode] = useState<"reuse" | "new">("reuse");
  const [reuseGuestId, setReuseGuestId] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [carerId, setCarerId] = useState<string | null>(null);
  const [newCarer, setNewCarer] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [newCarerName, setNewCarerName] = useState("");
  const [allergies, setAllergies] = useState("");
  const [phone, setPhone] = useState("");
  const [ret, setRet] = useState<"bus" | "self">(source === "venue" ? "self" : "bus");
  const [pinOpen, setPinOpen] = useState(false);

  const outbound: "bus" | "self" = source === "manifest" ? "bus" : "self";

  const hostsQ = useQuery({
    queryKey: ["walk-on-hosts", eventId],
    queryFn: () => listWalkOnHosts(eventId),
    enabled: open,
    staleTime: 15_000,
  });
  const clientsQ = useQuery({
    queryKey: ["walk-on-clients", eventId],
    queryFn: () => listWalkOnClientCandidates(eventId),
    enabled: open && kind === "client",
    staleTime: 15_000,
  });
  const guestsQ = useQuery({
    queryKey: ["guest-participants"],
    queryFn: listGuestParticipants,
    enabled: open && kind === "guest",
    staleTime: 30_000,
  });
  const carersQ = useQuery({
    queryKey: ["walk-on-carers", hostId],
    queryFn: () => listCarersForParticipant(hostId!),
    enabled: open && kind === "carer" && !!hostId,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!open) return;
    setHostId(hostParticipantId);
    setKind("guest");
    setGuestMode("reuse");
    setReuseGuestId(null);
    setClientId(null);
    setCarerId(null);
    setNewCarer(false);
    setFirstName("");
    setLastName("");
    setNewCarerName("");
    setAllergies("");
    setPhone("");
    setRet(source === "venue" ? "self" : "bus");
    setPinOpen(false);
  }, [open, hostParticipantId, source]);

  useEffect(() => {
    if (kind === "guest" && guestsQ.data && guestsQ.data.length === 0) {
      setGuestMode("new");
    }
  }, [kind, guestsQ.data]);

  useEffect(() => {
    if (kind !== "guest" || guestMode !== "reuse" || !reuseGuestId) return;
    const g = guestsQ.data?.find((x) => x.id === reuseGuestId);
    if (g?.allergiesNotes) setAllergies(g.allergiesNotes);
  }, [kind, guestMode, reuseGuestId, guestsQ.data]);

  useEffect(() => {
    if (kind !== "client" || !clientId) return;
    const c = clientsQ.data?.find((x) => x.id === clientId);
    if (c?.allergiesNotes) setAllergies(c.allergiesNotes);
  }, [kind, clientId, clientsQ.data]);

  const hosts = hostsQ.data ?? [];
  const clients = clientsQ.data ?? [];
  const guests = guestsQ.data ?? [];
  const carers: Carer[] = carersQ.data ?? [];

  const missing = useMemo(() => {
    const items: string[] = [];
    if (kind === "guest" || kind === "carer") {
      if (!hostId) items.push("Who they are with");
    }
    if (kind === "client" && !clientId) items.push("Select a client");
    if (kind === "guest") {
      if (guestMode === "reuse" && !reuseGuestId) items.push("Select a prior guest");
      if (guestMode === "new") {
        if (firstName.trim().length < 2) items.push("First name");
        if (lastName.trim().length < 2) items.push("Last name");
      }
    }
    if (kind === "carer") {
      if (newCarer) {
        if (newCarerName.trim().length < 2) items.push("Carer name");
      } else if (!carerId) {
        items.push("Select a carer (or add new)");
      }
    }
    if (kind !== "carer" && allergies.trim().length < 4) {
      items.push('Allergies / alerts (enter "None" if none)');
    }
    return items;
  }, [
    kind,
    hostId,
    clientId,
    guestMode,
    reuseGuestId,
    firstName,
    lastName,
    newCarer,
    newCarerName,
    carerId,
    allergies,
  ]);

  const formReady = missing.length === 0;

  const saveMut = useMutation({
    mutationFn: () =>
      addEventWalkOn({
        eventId,
        source,
        kind,
        hostParticipantId: hostId,
        returnTransportMode: ret,
        outboundTransportMode: outbound,
        busRunCode,
        pickupAddress,
        boardedLegId,
        eventDaySessionId,
        allergiesNotes: kind === "carer" ? "None" : allergies,
        phone,
        medBagRequired: "no",
        participantId:
          kind === "client"
            ? clientId
            : kind === "guest" && guestMode === "reuse"
              ? reuseGuestId
              : null,
        firstName: kind === "guest" && guestMode === "new" ? firstName : undefined,
        lastName: kind === "guest" && guestMode === "new" ? lastName : undefined,
        carerId: kind === "carer" && !newCarer ? carerId : null,
        newCarerName: kind === "carer" && newCarer ? newCarerName : null,
      }),
    onSuccess: (result) => {
      toast.success(`${result.displayName} added to the trip.`, {
        description: result.issueId
          ? "YELLOW office follow-up logged for payment and intake."
          : "Added — office follow-up issue could not be created. Tell the office.",
      });
      qc.invalidateQueries({ queryKey: ["event_roster_bookings", eventId] });
      qc.invalidateQueries({ queryKey: ["walk-on-hosts", eventId] });
      qc.invalidateQueries({ queryKey: ["event-walk-ons", eventId] });
      qc.invalidateQueries({ queryKey: ["guest-participants"] });
      qc.invalidateQueries({ queryKey: ["participants"] });
      qc.invalidateQueries({
        predicate: (q) =>
          q.queryKey?.[0] === "event-attendance-log" ||
          q.queryKey?.[0] === "event-issues" ||
          q.queryKey?.[0] === "event-actual-transport" ||
          q.queryKey?.[0] === "transport_trips",
      });
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast.error("Could not add walk-on", { description: e.message }),
  });

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (saveMut.isPending) return;
          onOpenChange(o);
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Someone extra</DialogTitle>
            <DialogDescription>
              {source === "manifest"
                ? "Accept them onto this stop. They ride and roll from here. Office follows up on payment."
                : "Accept them at the venue (self-transport). They join the event roll from here."}
            </DialogDescription>
          </DialogHeader>

          {missing.length > 0 && (
            <div className="space-y-1.5 rounded-lg border-2 border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Complete required fields to enable Accept
              </div>
              <ul className="ml-5 list-disc space-y-0.5 text-xs">
                {missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <MobileOptionButton
                label="Guest"
                selected={kind === "guest"}
                onClick={() => setKind("guest")}
              />
              <MobileOptionButton
                label="Client"
                selected={kind === "client"}
                onClick={() => setKind("client")}
              />
              <MobileOptionButton
                label="Carer"
                selected={kind === "carer"}
                onClick={() => setKind("carer")}
              />
            </div>

            <PickerBox
              invalid={(kind === "guest" || kind === "carer") && !hostId}
              placeholder="Who are they with?"
              empty="No clients on this event."
              loading={hostsQ.isLoading}
              valueLabel={hosts.find((h) => h.participantId === hostId)?.participantName}
            >
              {hosts.map((h) => (
                <CommandItem
                  key={h.participantId}
                  value={h.participantName}
                  onSelect={() => setHostId(h.participantId)}
                >
                  {h.participantName}
                </CommandItem>
              ))}
            </PickerBox>

            {kind === "guest" && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <MobileOptionButton
                    label="Prior guest"
                    selected={guestMode === "reuse"}
                    onClick={() => setGuestMode("reuse")}
                  />
                  <MobileOptionButton
                    label="New person"
                    selected={guestMode === "new"}
                    onClick={() => setGuestMode("new")}
                  />
                </div>
                {guestMode === "reuse" ? (
                  <PickerBox
                    invalid={!reuseGuestId}
                    placeholder="Search prior guests…"
                    empty="No prior guests on file."
                    loading={guestsQ.isLoading}
                    valueLabel={guests.find((g) => g.id === reuseGuestId)?.fullName}
                  >
                    {guests.map((g) => (
                      <CommandItem
                        key={g.id}
                        value={g.fullName}
                        onSelect={() => setReuseGuestId(g.id)}
                      >
                        {g.fullName}
                        {g.archivedAt ? " (archived)" : ""}
                      </CommandItem>
                    ))}
                  </PickerBox>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <CharacterCountedInput
                      label="First name"
                      value={firstName}
                      onValueChange={setFirstName}
                      minChars={2}
                    />
                    <CharacterCountedInput
                      label="Last name"
                      value={lastName}
                      onValueChange={setLastName}
                      minChars={2}
                    />
                  </div>
                )}
              </>
            )}

            {kind === "client" && (
              <PickerBox
                invalid={!clientId}
                placeholder="Search clients not on this event…"
                empty="Every client is already booked, or none on file."
                loading={clientsQ.isLoading}
                valueLabel={clients.find((c) => c.id === clientId)?.fullName}
              >
                {clients.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.fullName}
                    onSelect={() => setClientId(c.id)}
                  >
                    {c.fullName}
                  </CommandItem>
                ))}
              </PickerBox>
            )}

            {kind === "carer" && hostId && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <MobileOptionButton
                    label="Listed carer"
                    selected={!newCarer}
                    onClick={() => setNewCarer(false)}
                  />
                  <MobileOptionButton
                    label="New carer"
                    selected={newCarer}
                    onClick={() => setNewCarer(true)}
                  />
                </div>
                {newCarer ? (
                  <CharacterCountedInput
                    label="Carer name"
                    value={newCarerName}
                    onValueChange={setNewCarerName}
                    minChars={2}
                  />
                ) : (
                  <PickerBox
                    invalid={!carerId}
                    placeholder="This client’s carers…"
                    empty="No carers on file — use New carer."
                    loading={carersQ.isLoading}
                    valueLabel={carers.find((c) => c.id === carerId)?.fullName}
                  >
                    {carers.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={c.fullName}
                        onSelect={() => setCarerId(c.id)}
                      >
                        {c.fullName}
                        {c.relationship ? ` · ${c.relationship}` : ""}
                      </CommandItem>
                    ))}
                  </PickerBox>
                )}
              </>
            )}

            {kind !== "carer" && (
              <CharacterCountedTextarea
                label="Allergies / alerts"
                value={allergies}
                onValueChange={setAllergies}
                minChars={4}
                hint='Enter "None" if none known'
              />
            )}

            <CharacterCountedInput
              label="Phone"
              value={phone}
              onValueChange={setPhone}
              required={false}
              minChars={0}
              hint="Optional"
            />

            <div>
              <p className="mb-2 text-sm font-semibold">Going home</p>
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
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saveMut.isPending}
            >
              Close
            </Button>
            <Button
              type="button"
              disabled={!formReady || saveMut.isPending}
              onClick={() => setPinOpen(true)}
              className="gap-1.5"
            >
              {saveMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserRoundPlus className="h-4 w-4" />
              )}
              Accept onto trip — PIN
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PinEntryDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        title="Accept walk-on"
        description="Your PIN accepts this person onto the trip. Office will follow up."
        length={4}
        onVerify={verifyOperatorPin}
        onSuccess={() => {
          setPinOpen(false);
          saveMut.mutate();
        }}
      />
    </>
  );
}

function PickerBox({
  invalid,
  placeholder,
  empty,
  loading,
  valueLabel,
  children,
}: {
  invalid: boolean;
  placeholder: string;
  empty: string;
  loading: boolean;
  valueLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      {valueLabel && (
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          Selected: <span className="text-foreground">{valueLabel}</span>
        </p>
      )}
      <div className={cn("rounded-md border", requiredFieldOutline(invalid))}>
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandList className="max-h-40">
            {loading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : (
              <>
                <CommandEmpty>{empty}</CommandEmpty>
                <CommandGroup>{children}</CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </div>
    </div>
  );
}
