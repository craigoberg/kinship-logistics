import { forwardRef, useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  meetsMinLength,
  requiredFieldCounterClass,
  requiredFieldOutline,
  requiredFieldRemainingHint,
} from "@/lib/ui/required-field";

/**
 * Canonical single-line input with GUARDRAILS §4.3 validation styling.
 * Use for evidence references, short mandatory text fields, etc.
 */
export interface CharacterCountedInputProps
  extends Omit<React.ComponentProps<typeof Input>, "onChange" | "value"> {
  label: string;
  value: string;
  onValueChange: (next: string) => void;
  minChars?: number;
  maxChars?: number;
  required?: boolean;
  hint?: string;
  /** Counter format: "minimum" → `6/6 minimum`; "standard" → `6 / 6 min`. */
  counterMode?: "minimum" | "standard";
}

export const CharacterCountedInput = forwardRef<
  HTMLInputElement,
  CharacterCountedInputProps
>(function CharacterCountedInput(
  {
    label,
    value,
    onValueChange,
    minChars = 6,
    maxChars = 200,
    required = true,
    hint,
    counterMode = "minimum",
    className,
    id: idProp,
    ...rest
  },
  ref,
) {
  const reactId = useId();
  const id = idProp ?? `cci-${reactId}`;
  const trimmedLen = value.trim().length;
  const len = value.length;
  const valid = meetsMinLength(value, minChars);
  const showRedOutline = required && !valid;
  const pct = Math.min(100, Math.round((trimmedLen / minChars) * 100));
  const remainingHint = required
    ? requiredFieldRemainingHint(trimmedLen, minChars)
    : null;

  const counterText =
    counterMode === "minimum"
      ? `${trimmedLen}/${minChars} minimum`
      : `${trimmedLen} / ${minChars} min`;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id} className="text-sm font-semibold">
          {label}
          {required && <span className="ml-1 text-destructive">*</span>}
        </Label>
        {hint && (
          <span className="text-[11px] text-muted-foreground">{hint}</span>
        )}
      </div>

      <div className="relative">
        <Input
          {...rest}
          id={id}
          ref={ref}
          value={value}
          maxLength={maxChars}
          onChange={(e) => onValueChange(e.target.value)}
          className={requiredFieldOutline(showRedOutline, cn("pb-5", className))}
          aria-invalid={showRedOutline || undefined}
          aria-describedby={`${id}-counter`}
        />

        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1 overflow-hidden rounded-b-md bg-muted/60"
          aria-hidden
        >
          <div
            className={cn(
              "h-full transition-[width] duration-150 ease-out",
              valid ? "bg-emerald-500" : "bg-blue-500/70",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        {required && (
          <>
            <span id={`${id}-counter`} className={requiredFieldCounterClass(valid)}>
              {counterText}
            </span>
            {remainingHint && (
              <span className="text-[11px] font-medium text-destructive">
                {remainingHint}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
});
