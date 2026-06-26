import { useEffect, useState } from "react";
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
