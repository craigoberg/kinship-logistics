import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function ModePair({
  label,
  value,
  disabled,
  address,
  onChange,
  onAddress,
}: {
  label: string;
  value: "bus" | "self";
  disabled: boolean;
  address: string;
  onChange: (mode: "bus" | "self") => void;
  onAddress: (next: string) => void;
}) {
  const [draft, setDraft] = useState(address);
  useEffect(() => setDraft(address), [address]);

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
      {value === "bus" && (
        <Input
          value={draft}
          disabled={disabled}
          placeholder="Bus address"
          aria-label={`${label} address`}
          className={cn("h-7 min-w-[14rem] text-xs", !draft.trim() && "border-warning")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft.trim() !== address.trim()) onAddress(draft);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      )}
    </div>
  );
}

/** Office Bus / Self for the meeting point and the trip home. Address only when that leg is Bus. */
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
}) {
  return (
    <>
      <ModePair
        label="To meeting point"
        value={outbound}
        disabled={!!disabled}
        address={meetingAddress}
        onChange={onMeet}
        onAddress={onMeetingAddress}
      />
      <ModePair
        label="Departure to home"
        value={ret}
        disabled={!!disabled}
        address={homeAddress}
        onChange={onHome}
        onAddress={onHomeAddress}
      />
    </>
  );
}
