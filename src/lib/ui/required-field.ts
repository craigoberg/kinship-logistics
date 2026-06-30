import { cn } from "@/lib/utils";

/** Thick red outline for empty/invalid required inputs (GUARDRAILS §4.3). */
export function requiredFieldOutline(invalid: boolean, className?: string) {
  return cn(
    invalid && "border-2 border-destructive focus-visible:ring-destructive",
    className,
  );
}

/** Live X/Y counter — red while below min, emerald when compliant. */
export function requiredFieldCounterClass(valid: boolean) {
  return cn(
    "text-[11px] font-mono tabular-nums",
    valid ? "text-emerald-600" : "font-semibold text-destructive",
  );
}

export function requiredFieldRemainingHint(
  trimmedLen: number,
  minChars: number,
): string | null {
  if (trimmedLen >= minChars) return null;
  const remaining = minChars - trimmedLen;
  return `${remaining} more character${remaining === 1 ? "" : "s"} required.`;
}

export function meetsMinLength(value: string, minChars: number): boolean {
  return value.trim().length >= minChars;
}
