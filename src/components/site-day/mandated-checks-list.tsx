import { CheckCircle2, ClipboardList, Info } from "lucide-react";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { useMandatedChecks } from "@/hooks/use-system-parameters";

interface Props {
  ticked?: Set<number>;
  onTickedChange?: (next: Set<number>) => void;
}

/**
 * Visual checklist of mandated compliance items pulled from
 * `system_parameters.site_management.mandated_compliance_checks`.
 * Supports controlled mode via {ticked, onTickedChange} so a parent can
 * gate a submit button on completion.
 */
export function MandatedChecksList({ ticked, onTickedChange }: Props = {}) {
  const items = useMandatedChecks();
  const [internal, setInternal] = useState<Set<number>>(new Set());
  const controlled = !!ticked && !!onTickedChange;
  const value = controlled ? ticked! : internal;

  if (items.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          No mandated compliance checks configured — high-trust 1-tap open is
          enabled. A Manager can add items in
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px]">
            site_management.mandated_compliance_checks
          </code>
          via Admin → System Parameters.
        </div>
      </div>
    );
  }

  const toggle = (i: number) => {
    const next = new Set(value);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    if (controlled) onTickedChange!(next);
    else setInternal(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <ClipboardList className="h-3.5 w-3.5" />
        Mandated Compliance Checks
      </div>
      <ul className="space-y-1.5">
        {items.map((label, i) => {
          const on = value.has(i);
          return (
            <li
              key={`${i}-${label}`}
              className="flex items-start gap-2.5 rounded-md border border-border/60 bg-card/40 px-3 py-2 text-sm"
            >
              <Checkbox
                id={`mc-${i}`}
                checked={on}
                onCheckedChange={() => toggle(i)}
                className="mt-0.5"
              />
              <label
                htmlFor={`mc-${i}`}
                className="flex-1 cursor-pointer leading-snug"
              >
                {label}
              </label>
              {on && (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
