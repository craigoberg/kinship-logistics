import { useEffect, useState } from "react";
import { formatDate, formatDateTime, formatTime } from "@/lib/utils";

/**
 * Browser-local time display for SSR-safe React trees.
 *
 * Storage stays UTC ISO. Display uses GUARDRAILS §5.3 canonical formats
 * (local timezone via Date getters — not UTC slice). On the server / first
 * client paint we emit a stable placeholder so SSR HTML matches CSR HTML.
 *
 * Never render raw `toISOString()` strings to users.
 */
export type ClientTimeOptions = Intl.DateTimeFormatOptions;

const DEFAULT_OPTIONS: ClientTimeOptions = {};

function safeDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Map Intl-style options to §5.3 formatters (date only, time only, or both). */
function formatWithOptions(d: Date, options: ClientTimeOptions): string {
  const keys = Object.keys(options);
  const timeOnly =
    keys.length > 0 &&
    keys.every((k) => k === "hour" || k === "minute" || k === "second");
  const dateOnly =
    keys.length > 0 &&
    keys.every(
      (k) =>
        k === "year" ||
        k === "month" ||
        k === "day" ||
        k === "dateStyle" ||
        k === "weekday",
    ) &&
    !("hour" in options) &&
    !("minute" in options) &&
    !("timeStyle" in options);

  if (timeOnly) return formatTime(d);
  if (dateOnly) return formatDate(d);
  return formatDateTime(d);
}

/**
 * Hook returning a browser-local formatted date string, or `null` until
 * after the first client paint (so callers can render a stable placeholder
 * during SSR).
 */
export function useClientFormattedDate(
  iso: string | null | undefined,
  options: ClientTimeOptions = DEFAULT_OPTIONS,
): string | null {
  const [formatted, setFormatted] = useState<string | null>(null);
  const optionsKey = JSON.stringify(options);
  useEffect(() => {
    const d = safeDate(iso);
    if (!d) {
      setFormatted(null);
      return;
    }
    setFormatted(formatWithOptions(d, options));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso, optionsKey]);
  return formatted;
}

export interface ClientTimeProps {
  iso: string | null | undefined;
  options?: ClientTimeOptions;
  /** Placeholder shown during SSR and first paint. Default: "—". */
  placeholder?: string;
  /** Optional className passthrough so callers can style the span. */
  className?: string;
}

/**
 * SSR-safe timestamp renderer. Default output: `dd-Mmm-yy / hh:mm` (§5.3).
 */
export function ClientTime({
  iso,
  options = DEFAULT_OPTIONS,
  placeholder = "—",
  className,
}: ClientTimeProps) {
  const formatted = useClientFormattedDate(iso, options);
  return (
    <span className={className} suppressHydrationWarning>
      {formatted ?? placeholder}
    </span>
  );
}
