import { CheckCircle2, ClipboardCheck, Info } from "lucide-react";
import { useState } from "react";
import { useMandatedChecks } from "@/hooks/use-system-parameters";

interface Props {
  ticked?: Set<number>;
  onTickedChange?: (next: Set<number>) => void;
  /** Override checklist labels (e.g. close checks). Default = Open mandated list. */
  items?: string[];
  /** Section heading above the tick list. */
  heading?: string;
  /** Parameter key shown in empty-state Admin hint. */
  paramKey?: string;
  /** Verb in empty-state copy: "open" | "close". */
  emptyTrustVerb?: "open" | "close";
  /**
   * Subtext under each Confirm row.
   * Default = Open Centre fabric wording (Manager-approved workaround).
   */
  itemHint?: string;
}

/**
 * Visual checklist of mandated compliance items.
 * Each item is a big tappable button that toggles between grey (unchecked)
 * and bright green (confirmed) — styled like an oversized status pill.
 *
 * Default source: `site_management.mandated_compliance_checks` (Open).
 * Pass `items` for Close (`site_management.mandated_close_checks`).
 */
export function MandatedChecksList({
  ticked,
  onTickedChange,
  items: itemsOverride,
  heading = "Confirm site is ready to open",
  paramKey = "site_management.mandated_compliance_checks",
  emptyTrustVerb = "open",
  itemHint = "Checked and OK, or a Manager-approved workaround is in place.",
}: Props = {}) {
  const openItems = useMandatedChecks();
  const items = itemsOverride ?? openItems;
  const [internal, setInternal] = useState<Set<number>>(new Set());
  const controlled = !!ticked && !!onTickedChange;
  const value = controlled ? ticked! : internal;

  if (items.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          No mandated compliance checks configured — high-trust 1-tap{" "}
          {emptyTrustVerb} is enabled. A Manager can add items in
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px]">
            {paramKey}
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
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <ClipboardCheck className="h-3.5 w-3.5" />
        {heading}
      </div>
      <ul className="space-y-3">
        {items.map((label, i) => {
          const on = value.has(i);
          return (
            <li key={`${i}-${label}`}>
              <button
                type="button"
                onClick={() => toggle(i)}
                className={`flex w-full items-center gap-3 rounded-lg px-4 py-4 text-left transition-all active:scale-[0.98] sm:py-5 ${
                  on
                    ? "bg-green-500 text-white shadow-sm"
                    : "bg-muted/70 text-foreground border border-border/60"
                }`}
              >
                <CheckCircle2
                  className={`h-6 w-6 shrink-0 ${
                    on ? "text-white" : "text-muted-foreground"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-base leading-snug">
                    Confirm: {label}
                  </div>
                  <div
                    className={`text-sm leading-snug ${
                      on ? "text-white/80" : "text-muted-foreground"
                    }`}
                  >
                    {itemHint}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
