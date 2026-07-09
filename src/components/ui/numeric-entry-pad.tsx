import { useCallback, useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Delete } from "lucide-react";
import { cn } from "@/lib/utils";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export interface NumericEntryPadProps {
  value: string;
  onChange: (next: string) => void;
  /** Step size for ▲/▼ buttons (default 0.5 km). */
  step?: number;
  allowDecimal?: boolean;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
  unit?: string;
  /** Label shown beside step buttons, e.g. "0.5 km". */
  stepLabel?: string;
  keyboardActive?: boolean;
}

/** Snap a numeric value to the nearest step increment. */
export function snapToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || step <= 0) return value;
  const snapped = Math.round(value / step) * step;
  const decimals = step % 1 === 0 ? 0 : String(step).split(".")[1]?.length ?? 1;
  return Number(snapped.toFixed(decimals));
}

export function parseNumericEntry(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "." || trimmed === "-") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function clampValue(n: number, min?: number, max?: number): number {
  let out = n;
  if (min != null) out = Math.max(min, out);
  if (max != null) out = Math.min(max, out);
  return out;
}

function formatSteppedValue(n: number, allowDecimal: boolean, step: number): string {
  if (!allowDecimal) return String(Math.round(n));
  const decimals = step % 1 === 0 ? 0 : String(step).split(".")[1]?.length ?? 1;
  return String(Number(n.toFixed(decimals)));
}

function sanitizeTypedValue(raw: string, allowDecimal: boolean): string {
  let s = raw.replace(/[^\d.]/g, "");
  if (!allowDecimal) return s.replace(/\./g, "");
  const firstDot = s.indexOf(".");
  if (firstDot === -1) return s;
  const head = s.slice(0, firstDot + 1);
  const tail = s.slice(firstDot + 1).replace(/\./g, "");
  return head + tail;
}

/**
 * Touch-first numeric entry — large display, ▲/▼ steppers, on-screen keypad.
 * Sibling to PinPad; not used for PIN auth (GUARDRAILS §2.3).
 */
export function NumericEntryPad({
  value,
  onChange,
  step = 0.5,
  allowDecimal = true,
  min,
  max,
  disabled,
  className,
  unit = "km",
  stepLabel,
  keyboardActive = true,
}: NumericEntryPadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const stepText = stepLabel ?? (allowDecimal ? `${step} ${unit}` : `1 ${unit}`);

  const applyStep = useCallback(
    (direction: 1 | -1) => {
      if (disabled) return;
      const base = parseNumericEntry(value) ?? min ?? 0;
      let next = base + direction * step;
      next = clampValue(next, min, max);
      if (allowDecimal) next = snapToStep(next, step);
      else next = Math.round(next);
      onChange(formatSteppedValue(next, allowDecimal, step));
    },
    [allowDecimal, disabled, max, min, onChange, step, value],
  );

  const push = useCallback(
    (key: string) => {
      if (disabled) return;
      if (key === "." && !allowDecimal) return;
      if (key === "." && value.includes(".")) return;
      onChange(sanitizeTypedValue(value + key, allowDecimal));
    },
    [allowDecimal, disabled, onChange, value],
  );

  const backspace = useCallback(() => {
    if (disabled || value.length === 0) return;
    onChange(value.slice(0, -1));
  }, [disabled, onChange, value]);

  useEffect(() => {
    if (!keyboardActive || disabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const isOurInput = e.target === inputRef.current;
      if (!isOurInput && (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (/^[0-9]$/.test(e.key)) {
        if (!isOurInput) {
          e.preventDefault();
          push(e.key);
        }
        return;
      }
      if (e.key === "." && allowDecimal) {
        if (!isOurInput) {
          e.preventDefault();
          push(".");
        }
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        applyStep(1);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        applyStep(-1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [allowDecimal, applyStep, disabled, keyboardActive, push]);

  useEffect(() => {
    if (disabled) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [disabled]);

  return (
    <div className={cn("select-none touch-manipulation", className)}>
      <div className="relative mb-3">
        <input
          ref={inputRef}
          type="text"
          inputMode={allowDecimal ? "decimal" : "numeric"}
          enterKeyHint="done"
          autoComplete="off"
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(sanitizeTypedValue(e.target.value, allowDecimal))}
          className={cn(
            "h-16 w-full rounded-xl border-2 border-border bg-muted/30 px-4 pr-14",
            "text-center text-3xl font-semibold tabular-nums tracking-tight",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            "disabled:opacity-50",
          )}
          aria-label={`Numeric value in ${unit}`}
        />
        {unit && (
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
            {unit}
          </span>
        )}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => applyStep(1)}
          aria-label={`Increase by ${stepText}`}
          className={cn(
            "flex min-h-14 items-center justify-center gap-1 rounded-xl border-2 border-border bg-card shadow-sm",
            "text-base font-semibold transition active:scale-95 hover:bg-muted disabled:opacity-50",
          )}
        >
          <ChevronUp className="h-6 w-6 shrink-0" />
          <span className="text-xs font-medium text-muted-foreground">+{stepText}</span>
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => applyStep(-1)}
          aria-label={`Decrease by ${stepText}`}
          className={cn(
            "flex min-h-14 items-center justify-center gap-1 rounded-xl border-2 border-border bg-card shadow-sm",
            "text-base font-semibold transition active:scale-95 hover:bg-muted disabled:opacity-50",
          )}
        >
          <ChevronDown className="h-6 w-6 shrink-0" />
          <span className="text-xs font-medium text-muted-foreground">−{stepText}</span>
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            disabled={disabled}
            onClick={() => push(k)}
            className={cn(
              "flex h-14 items-center justify-center rounded-xl text-2xl font-semibold tabular-nums",
              "border border-border bg-card shadow-sm transition active:scale-95",
              "hover:bg-muted disabled:opacity-50",
            )}
          >
            {k}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled || value.length === 0}
          onClick={backspace}
          aria-label="Delete last digit"
          className={cn(
            "flex h-14 items-center justify-center rounded-xl border border-border bg-card shadow-sm",
            "transition active:scale-95 hover:bg-muted disabled:opacity-50",
          )}
        >
          <Delete className="h-6 w-6 text-muted-foreground" />
        </button>
        {allowDecimal ? (
          <button
            type="button"
            disabled={disabled || value.includes(".")}
            onClick={() => push(".")}
            className={cn(
              "flex h-14 items-center justify-center rounded-xl text-2xl font-semibold",
              "border border-border bg-card shadow-sm transition active:scale-95",
              "hover:bg-muted disabled:opacity-50",
            )}
          >
            .
          </button>
        ) : (
          <div className="h-14" aria-hidden />
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={() => push("0")}
          className={cn(
            "flex h-14 items-center justify-center rounded-xl text-2xl font-semibold tabular-nums",
            "border border-border bg-card shadow-sm transition active:scale-95",
            "hover:bg-muted disabled:opacity-50",
          )}
        >
          0
        </button>
      </div>

      {keyboardActive && (
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          Type, use ▲/▼, or tap the pad · arrow keys adjust by {stepText}
        </p>
      )}
    </div>
  );
}
