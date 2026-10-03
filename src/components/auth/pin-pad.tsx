import { useCallback, useEffect } from "react";
import { Delete } from "lucide-react";
import { cn } from "@/lib/utils";

export type PinLength = 4 | 6;

export interface PinPadProps {
  value: string;
  onChange: (next: string) => void;
  length?: PinLength;
  /**
   * Lengths that may be submitted. During the 4-digit to 6-digit move, a pad
   * asked for 4 digits accepts 4 or 6 and does not auto-submit at 4.
   */
  submitLengths?: number[];
  /** Called when `value` reaches `length` (auto-submit hook). */
  onComplete?: (pin: string) => void;
  disabled?: boolean;
  className?: string;
  /** Show explicit confirm key (default: auto-fire onComplete at length). */
  showConfirmKey?: boolean;
  confirmLabel?: string;
  /** Listen for 0–9 / Backspace / Enter on a physical keyboard (default true). */
  keyboardActive?: boolean;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/**
 * On-screen numeric PIN pad — touch + physical keyboard (no OS soft keyboard).
 * GUARDRAILS §2.3: canonical PIN capture UI for field devices.
 */
export function PinPad({
  value,
  onChange,
  length = 4,
  submitLengths,
  onComplete,
  disabled,
  className,
  showConfirmKey = false,
  confirmLabel = "OK",
  keyboardActive = true,
}: PinPadProps) {
  const flexible = !submitLengths && length === 4;
  const maxLength = flexible ? 6 : length;
  const accepts = submitLengths ?? (flexible ? [4, 6] : [length]);
  const confirmVisible = showConfirmKey || accepts.length > 1;

  const push = useCallback(
    (digit: string) => {
      if (disabled || value.length >= maxLength) return;
      const next = value + digit;
      onChange(next);
      if (!confirmVisible && next.length === maxLength) {
        onComplete?.(next);
        return;
      }
      if (confirmVisible && accepts.length > 1 && next.length === maxLength && accepts.includes(next.length)) {
        onComplete?.(next);
      }
    },
    [accepts, confirmVisible, disabled, maxLength, onChange, onComplete, value.length],
  );

  const backspace = useCallback(() => {
    if (disabled || value.length === 0) return;
    onChange(value.slice(0, -1));
  }, [disabled, onChange, value]);

  const confirm = useCallback(() => {
    if (disabled || !accepts.includes(value.length)) return;
    onComplete?.(value);
  }, [accepts, disabled, onComplete, value]);

  useEffect(() => {
    if (!keyboardActive || disabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        push(e.key);
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        backspace();
        return;
      }
      if (e.key === "Enter" && accepts.includes(value.length)) {
        e.preventDefault();
        confirm();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keyboardActive, disabled, push, backspace, confirm, value, accepts]);

  return (
    <div className={cn("select-none touch-manipulation", className)}>
      <div
        className="mb-4 flex justify-center gap-3"
        aria-label={`PIN entry, ${value.length} of ${maxLength} digits`}
        role="status"
      >
        {Array.from({ length: maxLength }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-3.5 w-3.5 rounded-full border-2 transition-colors",
              i < value.length
                ? "border-primary bg-primary"
                : "border-muted-foreground/40 bg-transparent",
            )}
          />
        ))}
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
        {confirmVisible ? (
          <button
            type="button"
            disabled={disabled || !accepts.includes(value.length)}
            onClick={confirm}
            className={cn(
              "flex h-14 items-center justify-center rounded-xl text-sm font-bold",
              "border border-primary bg-primary text-primary-foreground shadow-sm",
              "transition active:scale-95 disabled:opacity-50",
            )}
          >
            {confirmLabel}
          </button>
        ) : (
          <div className="h-14" aria-hidden />
        )}
      </div>
      {keyboardActive && (
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          Tap the pad or type digits on your keyboard
        </p>
      )}
    </div>
  );
}
