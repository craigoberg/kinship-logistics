/**
 * BL-073 — Open meal capture (Centre + Trips).
 * Source + menu + preparer / guest override + SFH amber ack + prep checklist.
 * Preparer (or MoD for guest) PIN attests — day-session user stays logged in.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import { MandatedChecksList } from "@/components/site-day/mandated-checks-list";
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import {
  verifyManagerPin,
  verifyNamedStaffPin,
} from "@/components/auth/pin-verify";
import { useMealPrepChecks } from "@/hooks/use-system-parameters";
import { listStaffRegistry } from "@/lib/data-store";
import {
  MEAL_PREP_CHECKS_PARAM_KEY,
  MEAL_SOURCE_OPTIONS,
  mealSourceNeedsMenu,
  mealSourceNeedsPrepChecks,
  mealSourceNeedsPreparer,
  validateMealOpenPayload,
  type MealOpenPayload,
  type MealSource,
  type PrepAttestationMode,
} from "@/lib/meal-open";
import { preparerCertStatusForSource } from "@/lib/meal-sfh-cert";
import {
  CAUTION_CALLOUT_BODY_CLASS,
  CAUTION_CALLOUT_CLASS,
  CAUTION_CALLOUT_ICON_CLASS,
} from "@/lib/ui/caution-callout";
import { cn } from "@/lib/utils";

type PreparerPick = "staff" | "guest";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Prefill from template / itinerary when present. */
  initialSource?: MealSource | null;
  initialMenuNotes?: string | null;
  pending?: boolean;
  onConfirm: (payload: MealOpenPayload) => void;
};

function isManagerOnDutyRole(role: string | null | undefined): boolean {
  const r = (role ?? "").toLowerCase();
  return r.includes("manager") || r.includes("coordinator");
}

export function OpenMealSheet({
  open,
  onOpenChange,
  title,
  initialSource = null,
  initialMenuNotes = null,
  pending = false,
  onConfirm,
}: Props) {
  const [source, setSource] = useState<MealSource | null>(initialSource);
  const [menuNotes, setMenuNotes] = useState(initialMenuNotes ?? "");
  const [preparerPick, setPreparerPick] = useState<PreparerPick>("staff");
  const [preparerId, setPreparerId] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [managerId, setManagerId] = useState<string | null>(null);
  const [overrideNote, setOverrideNote] = useState("");
  /** Manager justification for SFH gap (staff preparer warn path). */
  const [sfhNote, setSfhNote] = useState("");
  const [sfhManagerId, setSfhManagerId] = useState<string | null>(null);
  const [sfhManagerPin, setSfhManagerPin] = useState<string | null>(null);
  const [prepTicked, setPrepTicked] = useState<Set<number>>(new Set());
  const [formError, setFormError] = useState<string | null>(null);

  const prepCheckItems = useMealPrepChecks();

  const staffQ = useQuery({
    queryKey: ["staff_registry"],
    queryFn: listStaffRegistry,
    staleTime: 60_000,
    enabled: open,
  });

  const activeStaff = useMemo(
    () => (staffQ.data ?? []).filter((s) => s.active),
    [staffQ.data],
  );
  const managers = useMemo(
    () => activeStaff.filter((s) => isManagerOnDutyRole(s.role)),
    [activeStaff],
  );

  const preparer = activeStaff.find((s) => s.id === preparerId) ?? null;
  const needsMenu = source ? mealSourceNeedsMenu(source) : false;
  const needsPreparer = source ? mealSourceNeedsPreparer(source) : false;
  const needsPrepChecks = source ? mealSourceNeedsPrepChecks(source) : false;
  const isGuest = needsPreparer && preparerPick === "guest";
  const certStatus = isGuest
    ? "na"
    : preparerCertStatusForSource(needsPreparer, preparer);
  const certWarn =
    !isGuest &&
    (certStatus === "warn_missing" || certStatus === "warn_expired");

  const prepChecksReady =
    !needsPrepChecks ||
    prepCheckItems.length === 0 ||
    prepTicked.size >= prepCheckItems.length;

  const sfhManagerApproved =
    !certWarn ||
    (!!sfhManagerId &&
      !!sfhManagerPin &&
      sfhNote.trim().length >= 10);

  const formReadyForPin = (() => {
    if (!source || pending) return false;
    if (needsMenu && menuNotes.trim().length < 3) return false;
    if (!needsPreparer) return true;
    if (!prepChecksReady) return false;
    if (isGuest) {
      return (
        guestName.trim().length >= 2 &&
        !!managerId &&
        overrideNote.trim().length >= 10
      );
    }
    if (!preparerId) return false;
    if (!sfhManagerApproved) return false;
    return true;
  })();

  const resetLocal = () => {
    setSource(initialSource);
    setMenuNotes(initialMenuNotes ?? "");
    setPreparerPick("staff");
    setPreparerId(null);
    setGuestName("");
    setManagerId(null);
    setOverrideNote("");
    setSfhNote("");
    setSfhManagerId(null);
    setSfhManagerPin(null);
    setPrepTicked(new Set());
    setFormError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) resetLocal();
    else {
      setSource(initialSource);
      setMenuNotes(initialMenuNotes ?? "");
    }
    onOpenChange(next);
  };

  const buildPayload = (pin: string): MealOpenPayload | null => {
    if (!source) {
      setFormError("Select how this meal is being provided.");
      return null;
    }
    const prepChecksCompleted =
      needsPrepChecks && prepCheckItems.length > 0
        ? prepCheckItems.filter((_, i) => prepTicked.has(i))
        : [];

    let attestationMode: PrepAttestationMode | null = null;
    let attestedByStaffId: string | null = null;
    if (needsPreparer) {
      if (isGuest) {
        attestationMode = "manager_guest_override";
        attestedByStaffId = managerId;
      } else {
        attestationMode = "preparer_pin";
        attestedByStaffId = preparerId;
      }
    }

    const payload: MealOpenPayload = {
      mealSource: source,
      menuNotes: menuNotes.trim() || null,
      preparedByStaffId: needsPreparer && !isGuest ? preparerId : null,
      preparerCertStatus: certStatus,
      preparerAckNote: certWarn ? sfhNote.trim() || null : null,
      sfhManagerApproval:
        certWarn && sfhManagerId && sfhManagerPin
          ? {
              managerStaffId: sfhManagerId,
              note: sfhNote.trim(),
              pin: sfhManagerPin,
            }
          : null,
      prepChecksCompleted,
      prepAttestation:
        needsPreparer && attestationMode && attestedByStaffId
          ? {
              mode: attestationMode,
              attestedByStaffId,
              pin,
              guestPreparerName: isGuest ? guestName.trim() : null,
              overrideNote: isGuest ? overrideNote.trim() : null,
            }
          : null,
    };
    const err = validateMealOpenPayload(payload, prepCheckItems);
    if (err) {
      setFormError(err);
      return null;
    }
    setFormError(null);
    return payload;
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={handleOpenChange}
      title={`Open ${title}`}
      description="Record how the meal is provided. For cooked/packed, the kitchen lead PINs the prep checklist (walk the tablet over) — you stay logged in on the floor."
    >
      <div className="space-y-4 pb-2">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Meal source
          </p>
          <div className="space-y-2">
            {MEAL_SOURCE_OPTIONS.map((opt) => (
              <MobileFieldButton
                key={opt.id}
                title={opt.title}
                subtitle={opt.subtitle}
                tone="neutral"
                active={source === opt.id}
                onClick={() => {
                  setSource(opt.id);
                  setFormError(null);
                  if (!mealSourceNeedsPreparer(opt.id)) {
                    setPreparerId(null);
                    setAckNote("");
                    setPrepTicked(new Set());
                    setPreparerPick("staff");
                    setGuestName("");
                    setManagerId(null);
                    setOverrideNote("");
                  }
                }}
              />
            ))}
          </div>
        </div>

        {needsMenu && (
          <CharacterCountedTextarea
            label="What it is / was"
            value={menuNotes}
            onValueChange={setMenuNotes}
            minChars={3}
            maxChars={200}
            rows={3}
            required
            placeholder="e.g. BBQ sausages & salad · Haberfield chicken rolls · Hotel buffet"
          />
        )}

        {source === "own_food" && (
          <CharacterCountedTextarea
            label="Optional note"
            value={menuNotes}
            onValueChange={setMenuNotes}
            minChars={0}
            maxChars={120}
            rows={2}
            required={false}
            placeholder="Optional — e.g. family packed"
          />
        )}

        {needsPreparer && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Prepared by
            </p>
            <div className="space-y-2">
              <MobileFieldButton
                title="Staff preparer"
                subtitle="Nominate staff → they PIN-attest the checklist"
                tone="info"
                active={preparerPick === "staff"}
                onClick={() => {
                  setPreparerPick("staff");
                  setGuestName("");
                  setManagerId(null);
                  setOverrideNote("");
                  setPrepTicked(new Set());
                  setFormError(null);
                }}
              />
              <MobileFieldButton
                title="Guest / external preparer"
                subtitle="Manager on Duty attests on their behalf + justification"
                tone="neutral"
                active={preparerPick === "guest"}
                onClick={() => {
                  setPreparerPick("guest");
                  setPreparerId(null);
                  setSfhNote("");
                  setSfhManagerId(null);
                  setSfhManagerPin(null);
                  setPrepTicked(new Set());
                  setFormError(null);
                }}
              />
            </div>

            {preparerPick === "staff" && (
              <>
                {staffQ.isLoading ? (
                  <div className="flex justify-center py-3">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : (
                  <div className="max-h-48 space-y-1.5 overflow-y-auto">
                    {activeStaff.map((s) => (
                      <MobileFieldButton
                        key={s.id}
                        title={s.fullName}
                        subtitle={s.role ?? "Staff"}
                        tone="info"
                        active={preparerId === s.id}
                        onClick={() => {
                          setPreparerId(s.id);
                          setPrepTicked(new Set());
                          setSfhNote("");
                          setSfhManagerId(null);
                          setSfhManagerPin(null);
                          setFormError(null);
                        }}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {preparerPick === "guest" && (
              <div className="space-y-3">
                <CharacterCountedTextarea
                  label="Guest preparer name"
                  value={guestName}
                  onValueChange={setGuestName}
                  minChars={2}
                  maxChars={80}
                  rows={1}
                  required
                  placeholder="e.g. Caterer — Sam Lee"
                />
                <CharacterCountedTextarea
                  label="Manager justification"
                  value={overrideNote}
                  onValueChange={setOverrideNote}
                  minChars={10}
                  maxChars={240}
                  rows={3}
                  required
                  placeholder="Why Manager is attesting for a guest (min 10 characters)"
                />
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Manager on Duty
                  </p>
                  {managers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No Manager / Coordinator staff on file. Add one before
                      guest override.
                    </p>
                  ) : (
                    <div className="max-h-40 space-y-1.5 overflow-y-auto">
                      {managers.map((s) => (
                        <MobileFieldButton
                          key={s.id}
                          title={s.fullName}
                          subtitle={s.role ?? "Manager"}
                          tone="info"
                          active={managerId === s.id}
                          onClick={() => {
                            setManagerId(s.id);
                            setFormError(null);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {formError && (
          <p className="text-sm text-destructive">{formError}</p>
        )}

        {source && !needsPreparer && (
          <Button
            type="button"
            className="h-12 min-h-12 w-full"
            disabled={!formReadyForPin || pending}
            onClick={() => {
              const payload = buildPayload("");
              if (!payload) return;
              onConfirm({ ...payload, prepAttestation: null });
            }}
          >
            {pending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Opening…
              </>
            ) : (
              "Open meal service"
            )}
          </Button>
        )}

        {/* SFH gap: Manager must approve before preparer can attest */}
        {needsPreparer &&
          preparerPick === "staff" &&
          preparerId &&
          certWarn && (
            <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <div className={cn("space-y-2", CAUTION_CALLOUT_CLASS, "p-3")}>
                <div className="flex items-start gap-2">
                  <AlertTriangle
                    className={cn(
                      "mt-0.5 h-4 w-4",
                      CAUTION_CALLOUT_ICON_CLASS,
                    )}
                  />
                  <p className={cn("text-sm", CAUTION_CALLOUT_BODY_CLASS)}>
                    {certStatus === "warn_missing"
                      ? `${preparer?.fullName ?? "This staff member"} has no Safe Food Handling / Food Handling certification on file.`
                      : `${preparer?.fullName ?? "This staff member"}’s Safe Food Handling certification appears expired.`}{" "}
                    A Manager / Coordinator must approve before prep attestation.
                  </p>
                </div>
              </div>
              <CharacterCountedTextarea
                label="Manager justification"
                value={sfhNote}
                onValueChange={(v) => {
                  setSfhNote(v);
                  setSfhManagerPin(null);
                }}
                minChars={10}
                maxChars={240}
                rows={3}
                required
                placeholder="Why proceeding with this preparer (min 10 characters)"
              />
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Manager on Duty
                </p>
                <div className="max-h-40 space-y-1.5 overflow-y-auto">
                  {managers.map((s) => (
                    <MobileFieldButton
                      key={s.id}
                      title={s.fullName}
                      subtitle={s.role ?? "Manager"}
                      tone="info"
                      active={sfhManagerId === s.id}
                      onClick={() => {
                        setSfhManagerId(s.id);
                        setSfhManagerPin(null);
                        setFormError(null);
                      }}
                    />
                  ))}
                </div>
              </div>
              <PinEntryTrigger
                className="w-full"
                label={
                  sfhNote.trim().length < 10 || !sfhManagerId
                    ? "Justification + Manager first"
                    : sfhManagerPin
                      ? "SFH approved by Manager"
                      : "Manager PIN — approve SFH gap"
                }
                verified={!!sfhManagerPin}
                verifiedLabel="SFH approved — hand tablet to preparer"
                length={4}
                title="Manager SFH approval"
                description="Approve proceeding with a preparer whose Safe Food Handling is missing or expired."
                disabled={
                  pending ||
                  !sfhManagerId ||
                  sfhNote.trim().length < 10 ||
                  !!sfhManagerPin
                }
                onVerify={async (pin) => {
                  await verifyManagerPin(sfhManagerId!, pin);
                }}
                onSuccess={(pin) => {
                  setSfhManagerPin(pin);
                  setFormError(null);
                }}
              />
            </div>
          )}

        {/* Staff preparer: hand tablet over — Mark ticks + Mark's PIN */}
        {needsPreparer &&
          preparerPick === "staff" &&
          preparerId &&
          sfhManagerApproved && (
          <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                Hand tablet to {preparer?.fullName ?? "preparer"}
              </p>
              <p className="text-xs text-muted-foreground">
                You stay signed in on the floor.{" "}
                {preparer?.fullName ?? "They"} confirm each prep item, then
                enter{" "}
                <span className="font-medium text-foreground">their</span> PIN
                — not yours.
                {certWarn ? " (Manager already approved the SFH gap.)" : ""}
              </p>
            </div>

            {needsPrepChecks && (
              <MandatedChecksList
                items={prepCheckItems}
                ticked={prepTicked}
                onTickedChange={(next) => {
                  setPrepTicked(next);
                  setFormError(null);
                }}
                heading={`${preparer?.fullName ?? "Preparer"} — prep checklist`}
                paramKey={MEAL_PREP_CHECKS_PARAM_KEY}
                emptyTrustVerb="open"
                itemHint="I checked this myself — my PIN below seals it."
              />
            )}

            <PinEntryTrigger
              className="w-full"
              label={
                !formReadyForPin
                  ? "Tick checklist first, then your PIN"
                  : pending
                    ? "Opening…"
                    : `${preparer?.fullName ?? "Preparer"} — your PIN to attest & open`
              }
              verified={pending}
              verifiedLabel={pending ? "Opening…" : "Attested"}
              length={4}
              title="Preparer attestation"
              description={`${preparer?.fullName ?? "Preparer"}: you completed these prep checks. Enter your PIN to seal.`}
              disabled={!formReadyForPin || pending}
              onVerify={async (pin) => {
                await verifyNamedStaffPin(preparerId, pin);
              }}
              onSuccess={(pin) => {
                const payload = buildPayload(pin);
                if (payload) onConfirm(payload);
              }}
            />
          </div>
        )}

        {/* Guest: Manager ticks + justifies + Manager PIN */}
        {needsPreparer && preparerPick === "guest" && (
          <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                Manager on Duty — guest override
              </p>
              <p className="text-xs text-muted-foreground">
                You are attesting that prep steps were done for the guest
                preparer. Your Manager PIN seals it.
              </p>
            </div>

            {needsPrepChecks && (
              <MandatedChecksList
                items={prepCheckItems}
                ticked={prepTicked}
                onTickedChange={(next) => {
                  setPrepTicked(next);
                  setFormError(null);
                }}
                heading="Prep checklist (Manager verified)"
                paramKey={MEAL_PREP_CHECKS_PARAM_KEY}
                emptyTrustVerb="open"
                itemHint="I verified this with the guest preparer — my Manager PIN seals it."
              />
            )}

            <PinEntryTrigger
              className="w-full"
              label={
                !formReadyForPin
                  ? "Complete guest details & checklist first"
                  : pending
                    ? "Opening…"
                    : "Manager PIN — attest & open"
              }
              verified={pending}
              verifiedLabel={pending ? "Opening…" : "Attested"}
              length={4}
              title="Manager guest-preparer override"
              description="Confirm you verified prep steps for the guest preparer, then enter your Manager / Coordinator PIN."
              disabled={!formReadyForPin || pending || !managerId}
              onVerify={async (pin) => {
                await verifyManagerPin(managerId!, pin);
              }}
              onSuccess={(pin) => {
                const payload = buildPayload(pin);
                if (payload) onConfirm(payload);
              }}
            />
          </div>
        )}

        <div className="pt-1">
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Close
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
