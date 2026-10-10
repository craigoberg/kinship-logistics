/**
 * Tap list of Home + named places. Optional one-off text for this trip only.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { CharacterCountedInput } from "@/components/ui/character-counted-input";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import {
  listPersonAddresses,
  loadHomeAddress,
  type AddressOwner,
  type StopAddressChoice,
} from "@/lib/api/person-addresses";
import { personAddressQueryKey } from "@/components/address/person-address-list";

export function StopAddressChoices({
  owner,
  activeChoice,
  standingAddressId,
  showStanding = false,
  allowCustom,
  customText,
  onCustomText,
  onChoose,
  disabled,
}: {
  owner: AddressOwner;
  activeChoice: StopAddressChoice;
  standingAddressId?: string | null;
  /** Mark the weekday plan. Null standing id means Home is the plan. */
  showStanding?: boolean;
  allowCustom?: boolean;
  customText?: string;
  onCustomText?: (value: string) => void;
  onChoose: (choice: StopAddressChoice) => void;
  disabled?: boolean;
}) {
  const places = useQuery({
    queryKey: personAddressQueryKey(owner),
    queryFn: () => listPersonAddresses(owner),
    enabled: !!owner.id,
  });
  const home = useQuery({
    queryKey: ["home-address", owner.kind, owner.id],
    queryFn: () => loadHomeAddress(owner),
    enabled: !!owner.id,
  });
  const homeText = home.data ?? null;
  const customOk = (customText ?? "").trim().length >= 6;

  return (
    <div className="space-y-2">
      <MobileFieldButton
        title="Home"
        subtitle={homeText || "No home address on file"}
        active={activeChoice.mode === "home"}
        disabled={disabled || !homeText}
        badgeWhenIdle={showStanding && !standingAddressId ? "Run plan" : undefined}
        onClick={() => onChoose({ mode: "home" })}
      />
      {(places.data ?? []).map((place) => (
        <MobileFieldButton
          key={place.id}
          title={place.label}
          subtitle={place.address}
          active={activeChoice.mode === "saved" && activeChoice.addressId === place.id}
          disabled={disabled}
          badgeWhenIdle={showStanding && standingAddressId === place.id ? "Run plan" : undefined}
          onClick={() => onChoose({ mode: "saved", addressId: place.id })}
        />
      ))}
      {places.isLoading && (
        <p className="text-xs text-muted-foreground">Loading places…</p>
      )}
      {allowCustom && (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <CharacterCountedInput
            label="Other address today"
            value={customText ?? ""}
            onValueChange={(v) => onCustomText?.(v)}
            minChars={6}
            maxChars={160}
            required={false}
            hint="This run only. It is not added to the person’s places."
          />
          {(customText ?? "").trim().length > 0 && !customOk && (
            <p className="text-sm text-destructive">Missing: Address</p>
          )}
          <Button
            type="button"
            disabled={disabled || !customOk}
            onClick={() => onChoose({ mode: "custom", text: (customText ?? "").trim() })}
          >
            Use this address today
          </Button>
        </div>
      )}
    </div>
  );
}

export function StopAddressSheet({
  open,
  onOpenChange,
  title,
  description,
  owner,
  activeChoice,
  standingAddressId,
  showStanding,
  allowCustom,
  busy,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  owner: AddressOwner;
  activeChoice: StopAddressChoice;
  standingAddressId?: string | null;
  showStanding?: boolean;
  allowCustom?: boolean;
  busy?: boolean;
  onChoose: (choice: StopAddressChoice) => void;
}) {
  const [custom, setCustom] = useState("");
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
    >
      <StopAddressChoices
        owner={owner}
        activeChoice={activeChoice}
        standingAddressId={standingAddressId}
        showStanding={showStanding}
        allowCustom={allowCustom}
        customText={custom}
        onCustomText={setCustom}
        disabled={busy}
        onChoose={onChoose}
      />
    </BottomSheet>
  );
}

/** Event forms store a text snapshot. Home writes the street so it does not fall through to an older pickup string. */
export function choiceFromOverrideText(input: {
  override: string;
  home: string | null;
  places: { id: string; address: string }[];
}): StopAddressChoice {
  const text = input.override.trim();
  if (!text) return { mode: "home" };
  const home = (input.home ?? "").trim();
  if (home && text === home) return { mode: "home" };
  const place = input.places.find((p) => p.address.trim() === text);
  if (place) return { mode: "saved", addressId: place.id };
  return { mode: "custom", text };
}
