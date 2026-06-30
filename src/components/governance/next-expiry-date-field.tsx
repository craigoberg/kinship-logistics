import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import {
  EXPIRY_PRESET_OPTIONS,
  computePresetExpiry,
  defaultNextExpiry,
  detectExpiryPreset,
  parseExpiryBase,
  parseISODateLocal,
  startOfDay,
  toISODate,
  type ExpiryPreset,
} from "@/lib/governance/next-expiry";

interface NextExpiryDateFieldProps {
  /** Last expiry or renewal date — preset offsets are calculated from this. */
  baseDate: string | Date | null | undefined;
  value: Date | undefined;
  onChange: (value: Date | undefined) => void;
  /** When set, dates on or before this are invalid. */
  minDate?: Date;
  label?: string;
  helper?: string;
  /** When true (default), changing resetKey/base seeds value to last expiry + 1 year. */
  applyDefaultFromBase?: boolean;
  resetKey?: string;
  id?: string;
}

export function NextExpiryDateField({
  baseDate,
  value,
  onChange,
  minDate,
  label = "Next expiry / renewal date",
  helper,
  applyDefaultFromBase = true,
  resetKey,
  id = "next-expiry-date",
}: NextExpiryDateFieldProps) {
  const base = useMemo(() => parseExpiryBase(baseDate), [baseDate]);
  const [preset, setPreset] = useState<ExpiryPreset>("1y");

  useEffect(() => {
    if (!applyDefaultFromBase) {
      if (value) setPreset(detectExpiryPreset(base, value));
      return;
    }
    const next = defaultNextExpiry(base);
    onChange(next);
    setPreset("1y");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey ?? toISODate(base), applyDefaultFromBase]);

  useEffect(() => {
    if (value) setPreset(detectExpiryPreset(base, value));
  }, [base, value]);

  const handlePresetChange = (p: string) => {
    const next = p as ExpiryPreset;
    if (next === "custom") return;
    setPreset(next);
    onChange(computePresetExpiry(base, next));
  };

  const handleDateChange = (d: Date | undefined) => {
    onChange(d);
    if (d) setPreset(detectExpiryPreset(base, d));
  };

  const min = minDate ? startOfDay(minDate) : undefined;
  const invalid =
    !!value &&
    !!min &&
    startOfDay(value).getTime() <= min.getTime();

  const defaultHelper = `From last expiry ${format(base, "dd/MM/yyyy")}: choose a preset or edit the date.`;

  return (
    <div className="space-y-2">
      {label ? (
        <Label htmlFor={id} className="text-sm font-semibold">
          {label}
        </Label>
      ) : null}
      <RadioGroup
        value={preset === "custom" ? "" : preset}
        onValueChange={handlePresetChange}
        className="flex flex-wrap gap-2"
      >
        {EXPIRY_PRESET_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            htmlFor={`${id}-${opt.value}`}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs",
              preset === opt.value
                ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30"
                : "border-border",
            )}
          >
            <RadioGroupItem id={`${id}-${opt.value}`} value={opt.value} />
            {opt.label}
          </label>
        ))}
      </RadioGroup>
      <DatePicker
        id={id}
        value={value}
        onChange={handleDateChange}
        placeholder="Select date"
        dateFormat="dd/MM/yyyy"
        className={requiredFieldOutline(invalid, "h-9 text-sm")}
        disabledDates={min ? (d) => startOfDay(d).getTime() <= min.getTime() : undefined}
      />
      <span className="text-[11px] text-muted-foreground">{helper ?? defaultHelper}</span>
      {invalid && min && (
        <span className="text-[11px] font-medium text-destructive">
          Must be after {format(min, "dd/MM/yyyy")}.
        </span>
      )}
    </div>
  );
}

interface NextExpiryDateFieldIsoProps {
  baseDate: string | null | undefined;
  value: string;
  onChange: (iso: string) => void;
  minDate?: string;
  label?: string;
  helper?: string;
  resetKey?: string;
  applyDefaultFromBase?: boolean;
  id?: string;
}

/** ISO `yyyy-mm-dd` wrapper — used in generic resolve / registry edit. */
export function NextExpiryDateFieldIso({
  baseDate,
  value,
  onChange,
  minDate,
  label,
  helper,
  resetKey,
  applyDefaultFromBase,
  id,
}: NextExpiryDateFieldIsoProps) {
  const dateValue = parseISODateLocal(value) ?? undefined;
  const min = parseISODateLocal(minDate ?? null) ?? undefined;

  return (
    <NextExpiryDateField
      baseDate={baseDate}
      value={dateValue}
      onChange={(d) => onChange(d ? toISODate(d) : "")}
      minDate={min}
      label={label}
      helper={helper}
      resetKey={resetKey}
      applyDefaultFromBase={applyDefaultFromBase}
      id={id}
    />
  );
}
