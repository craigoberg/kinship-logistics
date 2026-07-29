/**
 * SSR-safe operational "today" caption.
 *
 * Event Deliver (and other lazy routes) can hydrate *after* the root unlocks
 * SIM TIME from localStorage. Rendering formatDate(todayLocalIso()) directly
 * then mismatches the server HTML (e.g. 17-Jul vs 18-Jul).
 *
 * Show a stable placeholder until mount, then the real operational date.
 */
import { useEffect, useState } from "react";
import { useOperationalTodayIso } from "@/lib/operational-clock";
import { formatDate } from "@/lib/utils";

interface Props {
  /** Text after the date, e.g. "field execution interface" */
  suffix: string;
  className?: string;
}

export function OperationalTodayLabel({ suffix, className }: Props) {
  const today = useOperationalTodayIso();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const text = mounted ? `${formatDate(today)} — ${suffix}` : `— — ${suffix}`;

  return (
    <p className={className} suppressHydrationWarning>
      {text}
    </p>
  );
}
