import type { ReactNode } from "react";
import { useCanUseDevTools } from "@/lib/dev-tools-access";

interface Props {
  children: ReactNode;
  /** Optional small "TEST" chip rendered above children for visibility. */
  label?: boolean;
}

/**
 * Wrap any UI that should only appear for Craig on a DEV/TEST build.
 * Renders nothing on published deployments and for every other signed-in person.
 */
export function TestOnly({ children, label = false }: Props) {
  const allowed = useCanUseDevTools();
  if (!allowed) return null;
  if (!label) return <>{children}</>;
  return (
    <div className="inline-flex flex-col items-start gap-1">
      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">
        Test
      </span>
      {children}
    </div>
  );
}
