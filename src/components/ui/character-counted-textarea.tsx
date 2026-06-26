import { forwardRef, useId } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Canonical primitive for MASTER_GUARDRAILS §4.2 (Textarea Validation &
 * Character Tracking) and §4.3 (Required Field Visual Identifiers).
 *
 *   - Renders an X / Y live character counter
 *   - Renders a solid-blue progress bar across the bottom edge of the input
 *   - When the field is required AND empty (or below min) it draws the
 *     mandated thick red border (no asterisk-only marking)
 *
 * Use this wherever an operator types an issue statement, fault description,
 * resolution note or escalation clearance text. The minimum character rule
 * (default 20) is enforced visually here; primary buttons MUST still gate on
 * the consumer's own `descriptionOk`/`workaroundOk` checks.
 */
export interface CharacterCountedTextareaProps
  extends Omit<React.ComponentProps<typeof Textarea>, "onChange" | "value"> {
  label: string;
  value: string;
  onValueChange: (next: string) => void;
  /** Min characters before the field is considered valid. Default 20. */
  minChars?: number;
  /** Max characters (used for the X / Y counter denominator). Default 500. */
  maxChars?: number;
  /** If true, the empty-state thick red outline is rendered. Default true. */
  required?: boolean;
  /** Sub-label shown under the field label. */
  hint?: string;
}

export const CharacterCountedTextarea = forwardRef<
  HTMLTextAreaElement,
  CharacterCountedTextareaProps
>(function CharacterCountedTextarea(
  {
    label,
    value,
    onValueChange,
    minChars = 20,
    maxChars = 500,
    required = true,
    hint,
    className,
    id: idProp,
    rows = 4,
    ...rest
  },
  ref,
) {
  const reactId = useId();
  const id = idProp ?? `cct-${reactId}`;
  const trimmedLen = value.trim().length;
  const len = value.length;
  const meetsMin = trimmedLen >= minChars;
  const showRedOutline = required && !meetsMin;
  const pct = Math.min(100, Math.round((trimmedLen / minChars) * 100));

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label
          htmlFor={id}
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {label}
          {required && <span className="ml-1 text-destructive">*</span>}
        </Label>
        {hint && (
          <span className="text-[11px] text-muted-foreground">{hint}</span>
        )}
      </div>

      <div className="relative">
        <Textarea
          {...rest}
          id={id}
          ref={ref}
          rows={rows}
          value={value}
          maxLength={maxChars}
          onChange={(e) => onValueChange(e.target.value)}
          className={cn(
            "pb-6 placeholder:text-slate-400 placeholder:italic",
            showRedOutline &&
              "border-2 border-destructive focus-visible:ring-destructive",
            className,
          )}
          aria-invalid={showRedOutline || undefined}
          aria-describedby={`${id}-counter`}
        />

        {/* Blue progress bar across the bottom edge (guardrail §4.2). */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1.5 overflow-hidden rounded-b-md bg-muted/60"
          aria-hidden
        >
          <div
            className={cn(
              "h-full transition-[width] duration-150 ease-out",
              meetsMin ? "bg-blue-500" : "bg-blue-500/70",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span
          id={`${id}-counter`}
          className={cn(
            "font-mono tabular-nums",
            meetsMin
              ? "text-muted-foreground"
              : "font-semibold text-destructive",
          )}
        >
          {trimmedLen} / {minChars} min · {len}/{maxChars}
        </span>
        {!meetsMin && required && (
          <span className="text-destructive">
            Need {Math.max(0, minChars - trimmedLen)} more character
            {minChars - trimmedLen === 1 ? "" : "s"}.
          </span>
        )}
      </div>
    </div>
  );
});
