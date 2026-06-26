import * as React from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

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
  dateFormat = "PPP",
}: DatePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
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
          <CalendarIcon className="mr-2 h-4 w-4 text-slate-700" />
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
          initialFocus
          className="p-3 pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );
}
