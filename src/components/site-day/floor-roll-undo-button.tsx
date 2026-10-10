import { RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Shared Undo on a floor attendance row (clients, support, event check-in).
 */
export function FloorRollUndoButton({
  kind,
  personName,
  disabled,
  onClick,
}: {
  kind: "check_in" | "check_out";
  personName: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const label = kind === "check_out" ? "Undo check-out" : "Undo check-in";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-md px-2",
        "border border-slate-300 bg-white text-slate-900 shadow-sm",
        "hover:bg-slate-100 active:scale-[0.98] touch-manipulation",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
      title={label}
      aria-label={`${label} for ${personName}`}
    >
      <RotateCcw className="h-3.5 w-3.5" />
      <span className="text-[9px] font-medium uppercase leading-none text-slate-500">Undo</span>
    </button>
  );
}
