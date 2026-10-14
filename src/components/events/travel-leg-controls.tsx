import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  choiceFromOverrideText,
  StopAddressChoices,
} from "@/components/address/stop-address-picker";
import { personAddressQueryKey } from "@/components/address/person-address-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  listPersonAddresses,
  loadHomeAddress,
  type AddressOwner,
} from "@/lib/api/person-addresses";
import type { AlightMode, PickupJoin } from "@/lib/passenger-stops";
import { cn } from "@/lib/utils";

function PointPills<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ id: T; label: string; disabled?: boolean }>;
  disabled: boolean;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="whitespace-nowrap text-[11px] text-muted-foreground">{label}</span>
      <div className="inline-flex flex-wrap rounded-md border border-border bg-muted/40 p-0.5">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={disabled || option.disabled}
            aria-pressed={value === option.id}
            onClick={() => onChange(option.id)}
            className={cn(
              "h-7 rounded px-2 text-xs font-medium",
              value === option.id
                ? "bg-info text-info-foreground"
                : "text-muted-foreground hover:text-foreground",
              option.disabled && "opacity-40",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TripAddressField({
  label,
  address,
  placeholder,
  owner,
  disabled,
  onAddress,
}: {
  label: string;
  address: string;
  placeholder: string;
  owner: AddressOwner | null;
  disabled: boolean;
  onAddress: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [draft, setDraft] = useState(address);
  useEffect(() => setDraft(address), [address]);
  const places = useQuery({
    queryKey: owner ? personAddressQueryKey(owner) : ["person-addresses", "none"],
    queryFn: () => listPersonAddresses(owner!),
    enabled: !!owner?.id,
  });
  const home = useQuery({
    queryKey: ["home-address", owner?.kind ?? "none", owner?.id ?? ""],
    queryFn: () => loadHomeAddress(owner!),
    enabled: !!owner?.id,
  });
  if (!owner) {
    return (
      <Input
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={label}
        className={cn("h-7 min-w-[14rem] text-xs", !draft.trim() && "border-warning")}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft.trim() !== address.trim()) onAddress(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    );
  }
  const text = address.trim();
  const activeChoice = text
    ? choiceFromOverrideText({
        override: text,
        home: home.data ?? null,
        places: places.data ?? [],
      })
    : { mode: "custom" as const, text: "" };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && activeChoice.mode === "custom") setCustom(activeChoice.text);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          className={cn(
            "h-7 min-w-[14rem] max-w-[18rem] truncate rounded-md border bg-background px-2 text-left text-xs",
            text ? "text-foreground" : "border-warning text-muted-foreground",
          )}
        >
          {text || placeholder}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="z-[80] w-80 p-3">
        <StopAddressChoices
          owner={owner}
          activeChoice={activeChoice}
          allowCustom
          customText={custom}
          onCustomText={setCustom}
          customTitle="One-off address"
          customHint="This trip only. It is not added to the person’s places."
          customAction="Use this address"
          onChoose={(choice) => {
            if (choice.mode === "home") onAddress((home.data ?? "").trim());
            else if (choice.mode === "saved") {
              const place = (places.data ?? []).find((p) => p.id === choice.addressId);
              onAddress(place?.address ?? "");
            } else onAddress(choice.text);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function ModePair({
  label,
  value,
  disabled,
  address,
  hideAddress,
  addressPlaceholder,
  addressOwner,
  onChange,
  onAddress,
}: {
  label: string;
  value: "bus" | "self";
  disabled: boolean;
  address: string;
  hideAddress?: boolean;
  addressPlaceholder?: string;
  addressOwner: AddressOwner | null;
  onChange: (mode: "bus" | "self") => void;
  onAddress: (next: string) => void;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="whitespace-nowrap text-[11px] text-muted-foreground">{label}</span>
        <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5">
          {(["bus", "self"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={disabled}
              aria-pressed={value === mode}
              onClick={() => onChange(mode)}
              className={cn(
                "h-7 min-w-[3rem] rounded px-2 text-xs font-medium",
                value === mode
                  ? "bg-info text-info-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {mode === "bus" ? "Bus" : "Self"}
            </button>
          ))}
        </div>
      </div>
      {value === "bus" && !hideAddress && (
        <TripAddressField
          label={`${label} address`}
          address={address}
          placeholder={addressPlaceholder ?? "Bus address"}
          owner={addressOwner}
          disabled={disabled}
          onAddress={onAddress}
        />
      )}
    </div>
  );
}

function JoinAddress({
  label,
  address,
  disabled,
  placeholder,
  owner,
  onAddress,
}: {
  label: string;
  address: string;
  disabled: boolean;
  placeholder: string;
  owner: AddressOwner | null;
  onAddress: (next: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <TripAddressField
        label={label}
        address={address}
        placeholder={placeholder}
        owner={owner}
        disabled={disabled}
        onAddress={onAddress}
      />
    </div>
  );
}

/** Where they join the trip, then how they travel that leg. */
export function TravelLegControls({
  outbound,
  ret,
  disabled,
  meetingAddress,
  homeAddress,
  onMeet,
  onHome,
  onMeetingAddress,
  onHomeAddress,
  pickupJoin = null,
  alightMode = null,
  onPickupJoin,
  onAlightMode,
  addressOwner = null,
}: {
  outbound: "bus" | "self";
  ret: "bus" | "self";
  disabled?: boolean;
  meetingAddress: string;
  homeAddress: string;
  onMeet: (mode: "bus" | "self") => void;
  onHome: (mode: "bus" | "self") => void;
  onMeetingAddress: (next: string) => void;
  onHomeAddress: (next: string) => void;
  /** Null is the older home-door pickup. */
  pickupJoin?: string | null;
  alightMode?: string | null;
  onPickupJoin?: (mode: PickupJoin) => void;
  onAlightMode?: (mode: AlightMode) => void;
  /** Home and saved places for this person. Null keeps a plain typed field. */
  addressOwner?: AddressOwner | null;
}) {
  const joinsOnTrip = pickupJoin === "address";
  const leavesEarly = alightMode === "address" || alightMode === "same";
  const drivenHome = !leavesEarly && ret === "bus" && alightMode !== "departure_point";
  const setLeave = (mode: AlightMode) => {
    if (onAlightMode) onAlightMode(mode);
    else if (mode === "home") onHome("bus");
    else if (mode === "departure_point") onHome("self");
  };
  return (
    <>
      <div className="flex shrink-0 flex-col gap-1">
        {onPickupJoin && (
          <PointPills
            label="Joins trip"
            value={joinsOnTrip ? "address" : "meeting_point"}
            disabled={!!disabled}
            options={[
              { id: "meeting_point", label: "At meeting point" },
              { id: "address", label: "On trip" },
            ]}
            onChange={onPickupJoin}
          />
        )}
        {joinsOnTrip ? (
          <JoinAddress
            label="Where they join"
            address={meetingAddress}
            disabled={!!disabled}
            placeholder="Address they make their own way to"
            owner={addressOwner}
            onAddress={onMeetingAddress}
          />
        ) : (
          <ModePair
            label="To meeting point"
            value={outbound}
            disabled={!!disabled}
            address={meetingAddress}
            hideAddress={outbound !== "bus"}
            addressPlaceholder="Home address"
            addressOwner={addressOwner}
            onChange={onMeet}
            onAddress={onMeetingAddress}
          />
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        {onAlightMode && (
          <PointPills
            label="Leaves trip"
            value={leavesEarly ? "address" : "departure_point"}
            disabled={!!disabled}
            options={[
              { id: "departure_point", label: "At departure point" },
              { id: "address", label: "Before departure" },
            ]}
            onChange={setLeave}
          />
        )}
        {leavesEarly ? (
          <JoinAddress
            label="Where they leave"
            address={homeAddress}
            disabled={!!disabled}
            placeholder="Address the bus drops them"
            owner={addressOwner}
            onAddress={onHomeAddress}
          />
        ) : (
          <ModePair
            label="Home from departure"
            value={drivenHome ? "bus" : "self"}
            disabled={!!disabled}
            address={homeAddress}
            hideAddress={!drivenHome}
            addressPlaceholder="Home address"
            addressOwner={addressOwner}
            onChange={(mode) => setLeave(mode === "bus" ? "home" : "departure_point")}
            onAddress={onHomeAddress}
          />
        )}
      </div>
    </>
  );
}
