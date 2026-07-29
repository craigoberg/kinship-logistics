import { useEffect, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { EditableDateField } from "@/components/ui/editable-date-field";
import { HalfHourTimeField } from "@/components/ui/half-hour-time-field";
import {
  combineDeferIso,
  splitDeferIso,
} from "@/lib/governance/default-defer-iso";
import {
  formatDeferDateText,
  parseDeferDateText,
} from "@/lib/governance/defer-date-text";
import { isHalfHourClockTime, padClockTime } from "@/lib/tour-roll-call";

interface Props {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onValidChange?: (valid: boolean) => void;
  disabled?: boolean;
}

function isDeferDraftValid(dateText: string, timeText: string): boolean {
  const date = parseDeferDateText(dateText);
  const time = padClockTime(timeText);
  return !!date && isHalfHourClockTime(time);
}

/**
 * Defer / next-action datetime — free-form date + 24h half-hour time.
 * Calendar and clock popups are helpers only. Value: `yyyy-mm-ddTHH:mm` (local).
 */
export function NextActionDateTimeField({
  id,
  value,
  onChange,
  onValidChange,
  disabled,
}: Props) {
  const [dateText, setDateText] = useState("");
  const [timeText, setTimeText] = useState("09:00");
  const skipSyncRef = useRef(false);

  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    const { date, time } = splitDeferIso(value);
    const nextDateText = formatDeferDateText(date);
    setDateText(nextDateText);
    setTimeText(padClockTime(time));
    onValidChange?.(isDeferDraftValid(nextDateText, time));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- validity tracks value sync only
  }, [value]);

  const emit = (nextDateText: string, nextTimeText: string) => {
    const normalizedTime = padClockTime(nextTimeText);
    setDateText(nextDateText);
    setTimeText(normalizedTime);
    const valid = isDeferDraftValid(nextDateText, normalizedTime);
    onValidChange?.(valid);
    if (valid) {
      skipSyncRef.current = true;
      const date = parseDeferDateText(nextDateText)!;
      onChange(combineDeferIso(date, normalizedTime));
    }
  };

  const showInvalid =
    (!!dateText.trim() && !parseDeferDateText(dateText)) ||
    (!!timeText.trim() && !isHalfHourClockTime(padClockTime(timeText))) ||
    (!!dateText.trim() && !!timeText.trim() && !isDeferDraftValid(dateText, timeText));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[10rem] flex-1 space-y-1">
          <Label htmlFor={id ? `${id}-date` : undefined} className="text-xs">
            Date
          </Label>
          <EditableDateField
            id={id ? `${id}-date` : undefined}
            value={dateText}
            onChange={(t) => emit(t, timeText)}
            disabled={disabled}
          />
        </div>
        <div className="w-28 space-y-1">
          <Label htmlFor={id ? `${id}-time` : undefined} className="text-xs">
            Time (24h)
          </Label>
          <HalfHourTimeField
            id={id ? `${id}-time` : undefined}
            value={timeText}
            onChange={(t) => emit(dateText, t)}
            disabled={disabled}
            halfHourOnly
          />
        </div>
      </div>
      {showInvalid && (
        <span className="text-xs text-destructive">
          Enter a valid date (dd-Mmm-yy) and 24-hour time on the half-hour (e.g. 09:00, 14:30).
        </span>
      )}
    </div>
  );
}
