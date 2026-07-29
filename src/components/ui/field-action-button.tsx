import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Large full-width CTA button for field-route screens (manifest, events, day centre).
 *
 * Touch-friendly: default height h-14 (~56px), rounded-xl, full-width.
 * Use `size="sm"` (h-12) for secondary field CTAs or nested actions.
 * Use `pulse` on the active "Depart" step to draw driver attention.
 *
 * Style guide: docs/architecture/UI-STYLE-GUIDE.md — "Field route CTA" (Defined).
 */

export type FieldActionVariant =
  | "primary"      // Blue  — start, initialise, navigate
  | "success"      // Green — confirm, complete, arrive, all-aboard
  | "caution"      // Amber — depart (draws attention without panic)
  | "destructive"  // Red   — close run, escalate, no-show
  | "secondary";   // Muted — back, change vehicle, cancel secondary

const VARIANT_CLASSES: Record<FieldActionVariant, string> = {
  primary:     "bg-blue-600  text-white  hover:bg-blue-700  active:bg-blue-800",
  success:     "bg-green-600 text-white  hover:bg-green-700 active:bg-green-800",
  caution:     "bg-yellow-400 text-black hover:bg-yellow-500 active:bg-yellow-600",
  destructive: "bg-red-600   text-white  hover:bg-red-700   active:bg-red-800",
  secondary:   "bg-muted     text-muted-foreground hover:bg-muted/80",
};

const SIZE_CLASSES = {
  default: "h-14 text-base font-bold",
  sm:      "h-12 text-sm  font-semibold",
};

interface FieldActionButtonProps {
  variant?: FieldActionVariant;
  size?: "default" | "sm";
  pulse?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  type?: "button" | "submit";
}

export function FieldActionButton({
  variant = "primary",
  size = "default",
  pulse = false,
  disabled = false,
  onClick,
  children,
  className,
  type = "button",
}: FieldActionButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "w-full rounded-xl transition",
        "touch-manipulation select-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        pulse && "animate-pulse",
        className,
      )}
    >
      {children}
    </button>
  );
}
