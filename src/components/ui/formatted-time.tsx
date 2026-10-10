import { useEffect, useState } from "react";
import { formatDeferRemaining, formatOpenDuration } from "@/lib/governance/hub-review-started";
import { operationalNowMs } from "@/lib/operational-clock";
import {
  formatDateStandard,
  formatDateTimeStandard,
  formatTimeStandard,
} from "@/lib/operational-time";

/**
 * SSR-safe wrappers around the canonical date/time formatters in
 * `src/lib/operational-time.ts`. They render the project-standard placeholder
 * during SSR + first paint, then swap to the browser-local formatted string
 * after mount — avoiding hydration mismatches in table cells.
 */

type Input = string | Date | null | undefined;

function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

interface Props {
  value: Input;
  className?: string;
  placeholder?: string;
}

export function FormattedDate({ value, className, placeholder = "—" }: Props) {
  const mounted = useMounted();
  return (
    <span className={className} suppressHydrationWarning>
      {mounted ? formatDateStandard(value) : placeholder}
    </span>
  );
}

export function FormattedTime({ value, className, placeholder = "—" }: Props) {
  const mounted = useMounted();
  return (
    <span className={className} suppressHydrationWarning>
      {mounted ? formatTimeStandard(value) : placeholder}
    </span>
  );
}

export function FormattedDateTime({ value, className, placeholder = "—" }: Props) {
  const mounted = useMounted();
  return (
    <span className={className} suppressHydrationWarning>
      {mounted ? formatDateTimeStandard(value) : placeholder}
    </span>
  );
}

/** Standard date/time plus time left: `11-Jul-26 / 14:30 (2d 4h 15m)`. */
export function FormattedDeferredUntil({ value, className, placeholder = "—" }: Props) {
  const mounted = useMounted();
  const iso = value instanceof Date ? value.toISOString() : (value ?? "");
  const text =
    mounted && iso
      ? `${formatDateTimeStandard(value)} (${formatDeferRemaining(String(iso), operationalNowMs())})`
      : placeholder;
  return (
    <span className={className} suppressHydrationWarning>
      {text}
    </span>
  );
}

/**
 * Resolved stamp plus how long it was open, occurred through close:
 * `10-Oct-26 / 18:24 (9d 14h 22m)`.
 */
export function FormattedResolvedAt({
  resolved,
  openedAt,
  className,
  placeholder = "—",
}: {
  resolved: Input;
  openedAt: Input;
  className?: string;
  placeholder?: string;
}) {
  const mounted = useMounted();
  const resolvedIso = resolved instanceof Date ? resolved.toISOString() : (resolved ?? "");
  const openedIso = openedAt instanceof Date ? openedAt.toISOString() : (openedAt ?? "");
  const text =
    mounted && resolvedIso
      ? openedIso
        ? `${formatDateTimeStandard(resolved)} (${formatOpenDuration(String(openedIso), String(resolvedIso))})`
        : formatDateTimeStandard(resolved)
      : placeholder;
  return (
    <span className={className} suppressHydrationWarning>
      {text}
    </span>
  );
}
