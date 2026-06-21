import { CheckCircle2, ClipboardList, Info } from "lucide-react";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { useMandatedChecks } from "@/hooks/use-system-parameters";

/**
 * Visual checklist of mandated compliance items pulled from
 * `system_parameters.site_management.mandated_compliance_checks`.
 * Local-state checkboxes — these are reminders to the Check Leader, not
 * gating data captured on submit.
 */
export function MandatedChecksList() {
  const items = useMandatedChecks();
  const [ticked, setTicked] = useState<Set<number>>(new Set());

  if (items.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          No mandated compliance checks configured. A Manager can edit
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px]">
            site_management.mandated_compliance_checks
          </code>
          in Admin → System Parameters.
        </div>
      </div>
    );
  }

  const toggle = (i: number) => {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <ClipboardList className="h-3.5 w-3.5" />
        Mandated Compliance Checks
      </div>
      <ul className="space-y-1.5">
        {items.map((label, i) => {
          const on = ticked.has(i);
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
