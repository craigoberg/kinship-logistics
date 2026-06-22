import { CheckCircle2, ClipboardCheck, Info } from "lucide-react";
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
 * Each item is presented as a positive confirmation: the user is
 * affirming they walked it, AND that it is OK (or a Manager-approved
 * workaround is in place — logged separately via Log Anomalies).
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
        <ClipboardCheck className="h-3.5 w-3.5" />
        Confirm site is ready to open
      </div>
      <ul className="space-y-2">
        {items.map((label, i) => {
          const on = value.has(i);
          return (
            <li
              key={`${i}-${label}`}
              className={`flex items-start gap-3 rounded-md border px-3 py-3 text-sm transition-colors ${
                on
                  ? "border-green-500/50 bg-green-500/10"
                  : "border-border/60 bg-card/40"
              }`}
            >
              <Checkbox
                id={`mc-${i}`}
                checked={on}
                onCheckedChange={() => toggle(i)}
                className="mt-0.5 h-5 w-5"
              />
              <label
                htmlFor={`mc-${i}`}
                className="flex-1 cursor-pointer space-y-0.5 leading-snug"
              >
                <div className="font-medium text-foreground">
                  Confirm: {label}
                </div>
                <div className="text-xs text-muted-foreground">
                  Checked and OK, or a Manager-approved workaround is in place.
                </div>
              </label>
              {on && (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
