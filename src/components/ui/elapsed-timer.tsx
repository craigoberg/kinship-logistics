import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Live HH:MM:SS counter for escalation / issue lifecycle.
 *
 * - `since`  : ISO timestamp the counter ticks from (null → renders nothing).
 * - `until`  : optional ISO timestamp. When set, the counter freezes at the
 *              elapsed span between `since` and `until` (used for closed
 *              summaries).
 *
 * SSR-safe: emits `--:--:--` until the first client mount so server HTML
 * matches client HTML (mirrors <ClientTime>).
 */
export interface ElapsedTimerProps {
  since: string | null | undefined;
  until?: string | null | undefined;
  label?: string;
  className?: string;
}

function parseIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

export function ElapsedTimer({ since, until, label, className }: ElapsedTimerProps) {
  const sinceMs = parseIso(since);
  const untilMs = parseIso(until);
  const frozen = untilMs != null;

  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (sinceMs == null) return;
    if (frozen) {
      setNow(untilMs!);
      return;
    }
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [sinceMs, frozen, untilMs]);

  if (sinceMs == null) return null;

  const display =
    now == null ? "--:--:--" : formatElapsed(now - sinceMs);

  return (
    <span
      className={cn("inline-flex items-baseline gap-1.5 tabular-nums", className)}
      suppressHydrationWarning
    >
      {label && (
        <span className="text-[10px] font-semibold uppercase tracking-wide opacity-75">
          {label}
        </span>
      )}
      <span className="font-mono text-sm font-bold">{display}</span>
    </span>
  );
}
