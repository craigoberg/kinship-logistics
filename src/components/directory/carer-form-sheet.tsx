import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Save } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { isOperationalParticipant, exitReasonLabel } from "@/lib/service-exit";
import { ServiceExitDialog } from "@/components/directory/service-exit-dialog";
import {
  useInsertCarer,
  useUpdateCarer,
  useParticipants,
} from "@/hooks/use-supabase-data";
import type { Carer, CarerPayload } from "@/lib/data-store";
import { OnboardingSubjectPanel } from "@/components/onboarding/onboarding-subject-panel";
import { SupportTransportDefaults } from "@/components/directory/support-transport-defaults";
import { PersonAddressList } from "@/components/address/person-address-list";
import { PinPad } from "@/components/auth/pin-pad";
import { managerSetPersonPin, managerUnlockPersonPin } from "@/lib/auth/pin-session";
import { grantVolunteerHat } from "@/lib/api/known-people";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  carer: Carer | null;
  /** Pre-fill linked participant when creating a brand-new carer. */
  defaultParticipantId?: string | null;
  /** Hide the participant picker entirely (use when launched from inside a participant profile). */
  lockParticipant?: boolean;
}

export function CarerFormSheet({
  open,
  onOpenChange,
  carer,
  defaultParticipantId = null,
  lockParticipant = false,
}: Props) {
  const isEdit = !!carer;
  const { data: participants = [] } = useParticipants();

  const [fullName, setFullName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [streetAddress, setStreetAddress] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [notes, setNotes] = useState("");
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [volunteerBusy, setVolunteerBusy] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);

  const insert = useInsertCarer();
  const update = useUpdateCarer();
  const busy = insert.isPending || update.isPending;

  useEffect(() => {
    if (!open) return;
    setFullName(carer?.fullName ?? "");
    setRelationship(carer?.relationship ?? "");
    setPhone(carer?.phone ?? "");
    setEmail(carer?.email ?? "");
    setStreetAddress(carer?.streetAddress ?? "");
    setIsPrimary(carer?.isPrimaryContact ?? false);
    setNotes(carer?.notes ?? "");
    setParticipantId(carer?.participantId ?? defaultParticipantId ?? null);
    setPin("");
  }, [open, carer, defaultParticipantId]);


  const selectedParticipant = useMemo(
    () => participants.find((p) => p.id === participantId) ?? null,
    [participants, participantId],
  );

  const save = async () => {
    if (!fullName.trim()) {
      toast.error("Full name is required", {
        className: "!bg-red-600 !text-white !border-red-700",
      });
      return;
    }
    const trimmedPin = pin.trim();
    if (!isEdit && !/^\d{6}$/.test(trimmedPin)) {
      toast.error("A 6-digit PIN is required", {
        className: "!bg-red-600 !text-white !border-red-700",
      });
      return;
    }
    if (isEdit && trimmedPin && !/^\d{6}$/.test(trimmedPin)) {
      toast.error("PIN must be exactly 6 digits", {
        className: "!bg-red-600 !text-white !border-red-700",
      });
      return;
    }
    const payload: CarerPayload = {
      fullName: fullName.trim(),
      relationship: relationship.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      streetAddress: streetAddress.trim() || null,
      isPrimaryContact: isPrimary,
      notes: notes.trim() || null,
      participantId,
    };
    try {
      if (isEdit && carer) {
        await update.mutateAsync({ id: carer.id, payload });
        if (trimmedPin) {
          await managerSetPersonPin({ personKind: "carer", personId: carer.id, newPin: trimmedPin });
        }
        toast.success("Carer updated", { description: payload.fullName });
      } else {
        const created = await insert.mutateAsync(payload);
        if (trimmedPin) {
          await managerSetPersonPin({ personKind: "carer", personId: created.id, newPin: trimmedPin });
        }
        toast.success("Carer added", { description: payload.fullName });
      }
      onOpenChange(false);
    } catch (err) {
      toast.error("Save failed — database rejected the record", {
        description: (err as Error).message,
        className: "!bg-red-600 !text-white !border-red-700",
        duration: 12_000,
      });
    }
  };

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b border-border px-6 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="flex flex-wrap items-center gap-2">
                {isEdit ? "Edit carer" : "Add carer / support contact"}
                {isEdit && carer?.exitedAt && (
                  <Badge variant="secondary" className="uppercase tracking-wide">
                    Off-boarded
                  </Badge>
                )}
              </SheetTitle>
              <SheetDescription>
                Writes directly to <code>carers_registry</code>.
              </SheetDescription>
            </div>
            {isEdit && carer && !carer.exitedAt && (
              <Button type="button" variant="outline" onClick={() => setExitOpen(true)}>
                Off-board
              </Button>
            )}
          </div>
          {isEdit && carer?.exitedAt && (
            <div className="mt-3 rounded-md bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground">
              Off-boarded
              {carer.exitReason ? ` — ${exitReasonLabel(carer.exitReason)}` : ""}
              {carer.exitNotes ? `. ${carer.exitNotes}` : ""}
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {!lockParticipant && (
            <Field label="Linked participant">
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal"
                  >
                    {selectedParticipant ? selectedParticipant.fullName : "Select participant…"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search participants…" />
                    <CommandList>
                      <CommandEmpty>No participant found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="__none__"
                          onSelect={() => {
                            setParticipantId(null);
                            setPickerOpen(false);
                          }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", !participantId ? "opacity-100" : "opacity-0")} />
                          <span className="text-muted-foreground">No participant linked</span>
                        </CommandItem>
                        {participants
                          .filter((p) => isOperationalParticipant(p) || p.id === participantId)
                          .map((p) => (
                          <CommandItem
                            key={p.id}
                            value={`${p.fullName} ${p.ndisNumber}`}
                            onSelect={() => {
                              setParticipantId(p.id);
                              setPickerOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                participantId === p.id ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <span>{p.fullName}</span>
                            <span className="ml-2 text-xs text-muted-foreground">{p.ndisNumber}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </Field>
          )}


          {isEdit && carer ? (
            <OnboardingSubjectPanel
              subjectTable="carers_registry"
              subjectId={carer.id}
              defaultPack="accompanying"
              seedName={carer.fullName}
            />
          ) : null}
          {isEdit && carer ? (
            <SupportTransportDefaults
              personKind="carer"
              carerId={carer.id}
              personName={fullName.trim() || carer.fullName}
            />
          ) : (
            <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
              Save this carer first, then set their Centre run (how they get in and out).
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name" className="sm:col-span-2">
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
            </Field>
            <Field label="Relationship">
              <Input
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                placeholder="e.g. Mother, Guardian"
              />
            </Field>
            <Field label="Phone">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
            </Field>
            <Field label="Email" className="sm:col-span-2">
              <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
            </Field>
            <Field label="Home / street address" className="sm:col-span-2">
              <Input value={streetAddress} onChange={(e) => setStreetAddress(e.target.value)} />
            </Field>
            {carer?.id ? (
              <PersonAddressList owner={{ kind: "carer", id: carer.id }} />
            ) : (
              <p className="text-[11px] text-muted-foreground sm:col-span-2">
                Save this carer first, then add other pickup places.
              </p>
            )}
            <Field label="Primary contact" className="sm:col-span-2">
              <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                <Switch checked={isPrimary} onCheckedChange={setIsPrimary} />
                <span className="text-sm text-muted-foreground">
                  {isPrimary ? "Flagged as primary support contact" : "Secondary / additional contact"}
                </span>
              </div>
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </Field>
            <Field
              label={isEdit ? "6-digit PIN (leave blank to keep current)" : "6-digit PIN"}
              className="sm:col-span-2"
            >
              <PinPad
                value={pin}
                onChange={(v) => setPin(v.replace(/\D/g, "").slice(0, 6))}
                length={6}
                showConfirmKey
                confirmLabel="Use this PIN"
                onComplete={(v) => setPin(v)}
              />
              {!isEdit && !/^\d{6}$/.test(pin) && (
                <p className="text-[11px] text-destructive">A 6-digit PIN is required before this carer can sign in.</p>
              )}
              {isEdit && pin.length > 0 && !/^\d{6}$/.test(pin) && (
                <p className="text-[11px] text-destructive">PIN must be exactly 6 digits.</p>
              )}
              {isEdit && carer && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={volunteerBusy}
                  onClick={() => {
                    setVolunteerBusy(true);
                    void grantVolunteerHat(carer.id)
                      .then(() =>
                        toast.success(`${carer.fullName} is now also a volunteer`, {
                          description:
                            "One person. The bus plan follows the volunteer hat. The carer link stays.",
                        }),
                      )
                      .catch((err: unknown) =>
                        toast.error("Could not add the volunteer hat", {
                          description: err instanceof Error ? err.message : String(err),
                        }),
                      )
                      .finally(() => setVolunteerBusy(false));
                  }}
                >
                  {volunteerBusy ? "Updating…" : "Also a volunteer"}
                </Button>
              )}
              {isEdit && carer && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={unlockBusy}
                  onClick={() => {
                    setUnlockBusy(true);
                    void managerUnlockPersonPin({ personKind: "carer", personId: carer.id })
                      .then(() => toast.success("PIN unlocked", { description: carer.fullName }))
                      .catch((err: unknown) =>
                        toast.error("Could not unlock PIN", {
                          description: err instanceof Error ? err.message : String(err),
                        }),
                      )
                      .finally(() => setUnlockBusy(false));
                  }}
                >
                  {unlockBusy ? "Unlocking…" : "Unlock PIN"}
                </Button>
              )}
            </Field>
          </div>
        </div>

        <SheetFooter className="flex-col-reverse gap-2 border-t border-border px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={save} disabled={busy || !!carer?.exitedAt || (!isEdit && !/^\d{6}$/.test(pin))} className="gap-1.5">
            <Save className="h-4 w-4" />
            {busy ? "Saving…" : isEdit ? "Save changes" : "Add carer"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
    {carer && (
      <ServiceExitDialog
        open={exitOpen}
        onOpenChange={setExitOpen}
        mode="offboard"
        subject="carer"
        personId={carer.id}
        displayName={carer.fullName}
        participantId={carer.participantId}
        participantName={
          participants.find((p) => p.id === carer.participantId)?.fullName ?? null
        }
        onCompleted={() => onOpenChange(false)}
      />
    )}
    </>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`grid gap-1.5 ${className ?? ""}`}>
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
