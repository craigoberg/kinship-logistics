import * as React from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";

import { cn, REGIONAL_DATE_FORMAT } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type DatePickerCaptionLayout =
  | "label"
  | "dropdown"
  | "dropdown-months"
  | "dropdown-years";

export interface DatePickerProps {
  value?: Date;
  onChange: (date?: Date) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Optional react-day-picker disabled matcher passed through to <Calendar />. */
  disabledDates?: (date: Date) => boolean;
  /** Optional date format string (date-fns). Defaults to "PPP". */
  dateFormat?: string;
  /**
   * Caption navigation. Default `label` (‹ › months only).
   * Use `dropdown` for DOB / far-history dates so year and month jump without 70× clicks.
   */
  captionLayout?: DatePickerCaptionLayout;
  /** Earliest navigable month (pairs with `captionLayout="dropdown"`). */
  startMonth?: Date;
  /** Latest navigable month. */
  endMonth?: Date;
  /** Newest years first in the year dropdown (recommended for DOB). */
  reverseYears?: boolean;
  /** Initial month shown when opening with no `value`. */
  defaultMonth?: Date;
}

const DOB_YEAR_SPAN = 120;

/**
 * Canonical props for date-of-birth fields: month + year dropdowns,
 * newest years first, last 120 years through today (no future DOBs).
 */
export function getDobDatePickerProps(now = new Date()): Pick<
  DatePickerProps,
  | "captionLayout"
  | "reverseYears"
  | "startMonth"
  | "endMonth"
  | "defaultMonth"
  | "disabledDates"
> {
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  return {
    captionLayout: "dropdown",
    reverseYears: true,
    startMonth: new Date(now.getFullYear() - DOB_YEAR_SPAN, 0),
    endMonth: new Date(now.getFullYear(), now.getMonth()),
    // Open near a typical adult DOB so the year list isn't pinned on "today".
    defaultMonth: new Date(now.getFullYear() - 40, 0),
    disabledDates: (date) => date > endOfToday,
  };
}

/**
 * Canonical DatePicker primitive — the single source of truth for shadcn
 * Calendar selections across the app. Manages its own open/close state so
 * picking a day immediately closes the popover.
 */
export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  disabled,
  className,
  disabledDates,
  dateFormat = REGIONAL_DATE_FORMAT,
  captionLayout = "label",
  startMonth,
  endMonth,
  reverseYears,
  defaultMonth,
}: DatePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <Popover modal={false} open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
          {value ? (
            format(value, dateFormat)
          ) : (
            <span className="italic text-slate-400">{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(d) => {
            onChange(d);
            setIsOpen(false);
          }}
          disabled={disabledDates}
          captionLayout={captionLayout}
          startMonth={startMonth}
          endMonth={endMonth}
          reverseYears={reverseYears}
          defaultMonth={value ?? defaultMonth}
          initialFocus
          className="p-3 pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );
}
