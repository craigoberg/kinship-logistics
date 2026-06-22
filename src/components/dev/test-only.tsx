import type { ReactNode } from "react";
import { IS_TEST_BUILD } from "@/lib/test-mode";

interface Props {
  children: ReactNode;
  /** Optional small "TEST" chip rendered above children for visibility. */
  label?: boolean;
}

/**
 * Wrap any UI that should only appear in dev / Lovable preview builds and
 * never in a published build. Renders nothing on published deployments.
 */
export function TestOnly({ children, label = false }: Props) {
  if (!IS_TEST_BUILD) return null;
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
