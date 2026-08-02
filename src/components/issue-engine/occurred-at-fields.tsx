/**
 * Occurred at — EditableDateField + HalfHourTimeField (BL-106).
 * Same composition as Hub NextActionDateTimeField (safe inside Dialog).
 * Logged-at remains system created_at on the row.
 */
import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { EditableDateField } from "@/components/ui/editable-date-field";
import { HalfHourTimeField } from "@/components/ui/half-hour-time-field";
import {
  formatDeferDateText,
  parseDeferDateText,
} from "@/lib/governance/defer-date-text";
import { padClockTime } from "@/lib/tour-roll-call";
import {
  type OccurredAtParts,
  isOccurredAtPartsValid,
  pickerDateToYmd,
  ymdToPickerDate,
} from "@/lib/ui/occurred-at";
import { cn } from "@/lib/utils";

interface Props {
  value: OccurredAtParts;
  onChange: (next: OccurredAtParts) => void;
  disabled?: boolean;
  showInvalid?: boolean;
  className?: string;
}

function ymdToDateText(ymd: string): string {
  const d = ymdToPickerDate(ymd);
  return d ? formatDeferDateText(d) : "";
}

export function OccurredAtFields({
  value,
  onChange,
  disabled,
  showInvalid = true,
  className,
}: Props) {
  const date = value?.date ?? "";
  const time = value?.time ?? "";
  const [dateText, setDateText] = useState(() => ymdToDateText(date));

  useEffect(() => {
    setDateText(ymdToDateText(date));
  }, [date]);

  const valid = isOccurredAtPartsValid({ date, time });

  const emitDateText = (text: string) => {
    setDateText(text);
    const parsed = parseDeferDateText(text);
    if (parsed) {
      onChange({ date: pickerDateToYmd(parsed), time });
      return;
    }
    if (!text.trim()) {
      onChange({ date: "", time });
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="space-y-1">
        <Label>Occurred at</Label>
        <p className="text-xs text-muted-foreground">
          When it happened — may be earlier than when you file. Logged time is
          recorded automatically.
        </p>
      </div>
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 w-full flex-1 space-y-1 sm:min-w-[10rem]">
          <Label className="text-xs text-muted-foreground">Date</Label>
          <EditableDateField
            value={dateText}
            onChange={emitDateText}
            disabled={disabled}
          />
        </div>
        <div className="w-full space-y-1 sm:w-28">
          <Label className="text-xs text-muted-foreground">Time (24h)</Label>
          <HalfHourTimeField
            value={time}
            onChange={(nextTime) =>
              onChange({ date, time: padClockTime(nextTime) })
            }
            disabled={disabled}
          />
        </div>
      </div>
      {showInvalid && !valid && (
        <p className="text-xs font-medium text-destructive">
          Enter when it occurred (date + time). Future times are not allowed.
        </p>
      )}
    </div>
  );
}
