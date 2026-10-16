"use client";

import * as React from "react";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import {
  DayButton,
  DayPicker,
  getDefaultClassNames,
  useDayPicker,
  type DropdownProps,
} from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { getOperationalNow } from "@/lib/operational-clock";

/** Years before the operational year when a picker does not set `startMonth`. */
const DEFAULT_PAST_YEARS = 120;
/** Years after the operational year when a picker does not set `endMonth`. */
const DEFAULT_FUTURE_YEARS = 30;

function monthIndex(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

function usesMonthYearDropdowns(layout: string | undefined): boolean {
  return (
    layout === "dropdown" ||
    layout === "dropdown-months" ||
    layout === "dropdown-years"
  );
}

function CaptionStepButton({
  label,
  disabled,
  direction,
  onClick,
}: {
  label: string;
  disabled: boolean;
  direction: "left" | "right";
  onClick: () => void;
}) {
  const Icon = direction === "left" ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className={cn(
        buttonVariants({ variant: "ghost" }),
        "h-8 w-7 shrink-0 p-0",
      )}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!disabled) onClick();
      }}
    >
      <Icon className="size-4" />
    </button>
  );
}

/** Month dropdown with ‹ › that move one month, inside the calendar caption. */
function CalendarMonthSpinner(props: DropdownProps) {
  const { components, goToMonth, previousMonth, nextMonth } = useDayPicker();
  return (
    <span className="inline-flex items-center">
      <CaptionStepButton
        label="Previous month"
        direction="left"
        disabled={!previousMonth}
        onClick={() => {
          if (previousMonth) goToMonth(previousMonth);
        }}
      />
      <components.Dropdown {...props} />
      <CaptionStepButton
        label="Next month"
        direction="right"
        disabled={!nextMonth}
        onClick={() => {
          if (nextMonth) goToMonth(nextMonth);
        }}
      />
    </span>
  );
}

/** Year dropdown with ‹ › that move one year, inside the calendar caption. */
function CalendarYearSpinner(props: DropdownProps) {
  const { components, goToMonth, months, dayPickerProps } = useDayPicker();
  const current = months[0]?.date;
  const start = dayPickerProps.startMonth;
  const end = dayPickerProps.endMonth;

  const previousYear = current
    ? new Date(current.getFullYear() - 1, current.getMonth(), 1)
    : undefined;
  const nextYear = current
    ? new Date(current.getFullYear() + 1, current.getMonth(), 1)
    : undefined;

  const canPrevious =
    !!previousYear &&
    (start ? monthIndex(previousYear) >= monthIndex(start) : true);
  const canNext =
    !!nextYear && (end ? monthIndex(nextYear) <= monthIndex(end) : true);

  return (
    <span className="inline-flex items-center">
      <CaptionStepButton
        label="Previous year"
        direction="left"
        disabled={!canPrevious}
        onClick={() => {
          if (previousYear && canPrevious) goToMonth(previousYear);
        }}
      />
      <components.Dropdown {...props} />
      <CaptionStepButton
        label="Next year"
        direction="right"
        disabled={!canNext}
        onClick={() => {
          if (nextYear && canNext) goToMonth(nextYear);
        }}
      />
    </span>
  );
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "dropdown",
  buttonVariant = "ghost",
  formatters,
  components,
  startMonth,
  endMonth,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const defaultClassNames = getDefaultClassNames();
  const dropdownCaption = usesMonthYearDropdowns(captionLayout);
  const anchorYear = getOperationalNow().getFullYear();
  const resolvedStart =
    startMonth ??
    (dropdownCaption ? new Date(anchorYear - DEFAULT_PAST_YEARS, 0, 1) : undefined);
  const resolvedEnd =
    endMonth ??
    (dropdownCaption
      ? new Date(anchorYear + DEFAULT_FUTURE_YEARS, 11, 1)
      : undefined);

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "bg-background group/calendar p-3 [--cell-size:2rem] [[data-slot=card-content]_&]:bg-transparent [[data-slot=popover-content]_&]:bg-transparent",
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className,
      )}
      captionLayout={captionLayout}
      startMonth={resolvedStart}
      endMonth={resolvedEnd}
      hideNavigation={dropdownCaption}
      formatters={{
        formatMonthDropdown: (date) => date.toLocaleString("default", { month: "short" }),
        ...formatters,
      }}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn("relative flex flex-col gap-4 md:flex-row", defaultClassNames.months),
        month: cn("flex w-full flex-col gap-4", defaultClassNames.month),
        nav: cn(
          "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
          defaultClassNames.nav,
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          "h-(--cell-size) w-(--cell-size) select-none p-0 aria-disabled:opacity-50",
          defaultClassNames.button_previous,
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "h-(--cell-size) w-(--cell-size) select-none p-0 aria-disabled:opacity-50",
          defaultClassNames.button_next,
        ),
        month_caption: cn(
          "flex h-auto w-full items-center justify-center px-0",
          defaultClassNames.month_caption,
        ),
        dropdowns: cn(
          "flex h-auto w-full flex-wrap items-center justify-center gap-x-1 gap-y-0.5 text-sm font-medium",
          defaultClassNames.dropdowns,
        ),
        dropdown_root: cn(
          "has-focus:border-ring border-input shadow-xs has-focus:ring-ring/50 has-focus:ring-[3px] relative rounded-md border",
          defaultClassNames.dropdown_root,
        ),
        dropdown: cn("bg-popover absolute inset-0 opacity-0", defaultClassNames.dropdown),
        caption_label: cn(
          "select-none font-medium",
          captionLayout === "label"
            ? "text-sm"
            : "[&>svg]:text-muted-foreground flex h-8 items-center gap-1 rounded-md pl-2 pr-1 text-sm [&>svg]:size-3.5",
          defaultClassNames.caption_label,
        ),
        table: "w-full border-collapse",
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          "text-muted-foreground flex-1 select-none rounded-md text-[0.8rem] font-normal",
          defaultClassNames.weekday,
        ),
        week: cn("mt-2 flex w-full", defaultClassNames.week),
        week_number_header: cn("w-(--cell-size) select-none", defaultClassNames.week_number_header),
        week_number: cn(
          "text-muted-foreground select-none text-[0.8rem]",
          defaultClassNames.week_number,
        ),
        day: cn(
          "group/day relative aspect-square h-full w-full select-none p-0 text-center [&:first-child[data-selected=true]_button]:rounded-l-md [&:last-child[data-selected=true]_button]:rounded-r-md",
          defaultClassNames.day,
        ),
        range_start: cn("bg-accent rounded-l-md", defaultClassNames.range_start),
        range_middle: cn("rounded-none", defaultClassNames.range_middle),
        range_end: cn("bg-accent rounded-r-md", defaultClassNames.range_end),
        today: cn(
          "bg-accent text-accent-foreground rounded-md data-[selected=true]:rounded-none",
          defaultClassNames.today,
        ),
        outside: cn(
          "text-muted-foreground aria-selected:text-muted-foreground",
          defaultClassNames.outside,
        ),
        disabled: cn("text-muted-foreground opacity-50", defaultClassNames.disabled),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => {
          return <div data-slot="calendar" ref={rootRef} className={cn(className)} {...props} />;
        },
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") {
            return <ChevronLeftIcon className={cn("size-4", className)} {...props} />;
          }

          if (orientation === "right") {
            return <ChevronRightIcon className={cn("size-4", className)} {...props} />;
          }

          return <ChevronDownIcon className={cn("size-4", className)} {...props} />;
        },
        DayButton: CalendarDayButton,
        MonthsDropdown: CalendarMonthSpinner,
        YearsDropdown: CalendarYearSpinner,
        WeekNumber: ({ children, ...props }) => {
          return (
            <td {...props}>
              <div className="flex size-(--cell-size) items-center justify-center text-center">
                {children}
              </div>
            </td>
          );
        },
        ...components,
      }}
      {...props}
    />
  );
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const defaultClassNames = getDefaultClassNames();

  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString()}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        "data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground data-[range-middle=true]:bg-accent data-[range-middle=true]:text-accent-foreground data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-ring/50 flex aspect-square h-auto w-full min-w-(--cell-size) flex-col gap-1 font-normal leading-none data-[range-end=true]:rounded-md data-[range-middle=true]:rounded-none data-[range-start=true]:rounded-md group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:ring-[3px] [&>span]:text-xs [&>span]:opacity-70",
        defaultClassNames.day,
        className,
      )}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };
