import { useEffect, useState } from "react";

/**
 * Browser-local time display for SSR-safe React trees.
 *
 * Storage stays UTC ISO. Display is always in the browser's timezone via
 * `toLocaleString` (no explicit `timeZone` option). On the server / first
 * client paint we emit a stable placeholder so SSR HTML matches CSR HTML;
 * after mount we swap to the locale-formatted string.
 *
 * Project rule: never render `toISOString()` strings to users. Always use
 * <ClientTime> / useClientFormattedDate. See PROJECT_CONTEXT.md §10.
 */
export type ClientTimeOptions = Intl.DateTimeFormatOptions;

const DEFAULT_OPTIONS: ClientTimeOptions = {
  dateStyle: "short",
  timeStyle: "short",
};

function safeDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
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
  // Stringify options so changes re-format. Intl options are plain objects.
  const optionsKey = JSON.stringify(options);
  useEffect(() => {
    const d = safeDate(iso);
    if (!d) {
      setFormatted(null);
      return;
    }
    try {
      setFormatted(d.toLocaleString(undefined, options));
    } catch {
      setFormatted(d.toISOString());
    }
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
 * SSR-safe timestamp renderer. Emits `placeholder` until mounted, then the
 * browser-local formatted string. Wrap any user-visible date/time with this.
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
