/**
 * Embedded method chip inside a big touch row (UI Style Guide —
 * "Floor row embedded method override").
 * Tap opens the method picker; does not confirm check-in/out.
 */
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  /** e.g. "Method" under the chip */
  caption?: string;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
  "aria-label"?: string;
}

export function EmbeddedMethodButton({
  label,
  caption = "Method",
  disabled,
  className,
  onClick,
  "aria-label": ariaLabel,
}: Props) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel ?? `Change method, currently ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "inline-flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-md px-2",
        "border border-slate-300 bg-white text-slate-900 shadow-sm",
        "hover:bg-slate-100 active:scale-[0.98]",
        "disabled:opacity-50 disabled:pointer-events-none",
        "touch-manipulation",
        className,
      )}
    >
      <span className="text-xs font-bold uppercase leading-none tracking-wide">
        {label}
      </span>
      {caption ? (
        <span className="text-[9px] font-medium uppercase leading-none text-slate-500">
          {caption}
        </span>
      ) : null}
    </button>
  );
}
