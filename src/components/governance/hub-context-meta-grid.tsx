import type { ReactNode } from "react";

export interface HubContextMetaRow {
  label: string;
  value: ReactNode;
}

/** Consistent Who / Where / When block for Governance Hub manage dialogs. */
export function HubContextMetaGrid({ rows }: { rows: HubContextMetaRow[] }) {
  const visible = rows.filter((r) => r.value != null && r.value !== "");
  if (visible.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {visible.map((row) => (
        <div key={row.label} className="contents">
          <span className="font-medium text-foreground/70">{row.label}</span>
          <span>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Compact label/value rows for Hub list cards. */
export function HubListMetaRows({ rows }: { rows: HubContextMetaRow[] }) {
  const visible = rows.filter((r) => r.value != null && r.value !== "");
  if (visible.length === 0) return null;

  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] leading-snug">
      {visible.map((row) => (
        <div key={row.label} className="contents">
          <span className="font-medium text-foreground/60">{row.label}</span>
          <span className="text-muted-foreground">{row.value}</span>
        </div>
      ))}
    </div>
  );
}
