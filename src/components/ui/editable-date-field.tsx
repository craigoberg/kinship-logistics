import { useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatDeferDateText,
  isValidDeferDateText,
  parseDeferDateText,
} from "@/lib/governance/defer-date-text";
import { cn } from "@/lib/utils";

interface Props {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

/**
 * `dd-Mmm-yy` text field — free-typed or picked from a calendar popup.
 */
export function EditableDateField({
  id,
  value,
  onChange,
  disabled,
  className,
  placeholder = "06-Jul-26",
}: Props) {
  const [open, setOpen] = useState(false);
  const invalid = !!value.trim() && !isValidDeferDateText(value);
  const selected = parseDeferDateText(value);

  const normalizeOnBlur = () => {
    const parsed = parseDeferDateText(value);
    if (parsed) {
      const canonical = formatDeferDateText(parsed);
      if (canonical !== value) onChange(canonical);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn("relative", className)}>
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={normalizeOnBlur}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            "h-9 pr-9 font-mono text-sm",
            invalid && "border-destructive",
          )}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled}
                className="absolute right-0 top-0 h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Open calendar"
              >
                <CalendarIcon className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Open calendar</TooltipContent>
        </Tooltip>
      </div>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => {
            onChange(d ? formatDeferDateText(d) : "");
            setOpen(false);
          }}
          initialFocus
          className="pointer-events-auto p-3"
        />
      </PopoverContent>
    </Popover>
  );
}
