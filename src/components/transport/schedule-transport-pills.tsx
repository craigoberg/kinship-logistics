/**
 * Day Centre / staff / carer default IN/OUT — Self first, then Admin bus runs.
 * Canonical: UI-STYLE-GUIDE “Day Centre schedule transport (Self + runs)”.
 */
import { cn } from "@/lib/utils";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import type { LookupParameter } from "@/lib/data-store";
import type { BusRunBadge } from "@/hooks/use-supabase-data";

export const SELF_TRANSPORT_CODE = "TRN-SELF";
const SELF_PILL_COLOR = "#64748b";

export function isSelfTransportCode(code: string): boolean {
  const v = code.trim().toLowerCase();
  return v.includes("self") || v.includes("private") || v.includes("family");
}

export function isAssignedBusRun(code: string, runs: LookupParameter[]): boolean {
  return runs.some((r) => r.code === code);
}

export function ScheduleTransportPills({
  value,
  busRuns,
  busRunMap,
  invalid,
  onSelect,
}: {
  value: string;
  busRuns: LookupParameter[];
  busRunMap: Map<string, BusRunBadge>;
  invalid: boolean;
  onSelect: (code: string) => void;
}) {
  const selfSelected = isSelfTransportCode(value);
  return (
    <div className={cn("flex flex-wrap gap-2 rounded-md p-1", requiredFieldOutline(invalid))}>
      <button
        type="button"
        onClick={() => onSelect(SELF_TRANSPORT_CODE)}
        style={
          selfSelected
            ? { backgroundColor: SELF_PILL_COLOR, borderColor: SELF_PILL_COLOR }
            : { borderColor: SELF_PILL_COLOR, color: SELF_PILL_COLOR }
        }
        className={`rounded-full border-2 px-3 py-1 text-xs font-semibold transition ${
          selfSelected ? "text-white" : "bg-card hover:opacity-80"
        }`}
      >
        Self
      </button>
      {busRuns.map((run) => {
        const selected = value === run.code;
        const badge = busRunMap.get(run.code);
        const color = badge?.color ?? "#7c3aed";
        return (
          <button
            key={run.code}
            type="button"
            onClick={() => onSelect(run.code)}
            style={
              selected
                ? { backgroundColor: color, borderColor: color }
                : { borderColor: color, color }
            }
            className={`rounded-full border-2 px-3 py-1 text-xs font-semibold transition ${
              selected ? "text-white" : "bg-card hover:opacity-80"
            }`}
          >
            {run.displayName}
          </button>
        );
      })}
    </div>
  );
}

export function TransportCodeBadge({
  code,
  runMap,
}: {
  code: string;
  runMap: Map<string, { label: string; color: string }>;
}) {
  const run = runMap.get(code);
  if (run) {
    return (
      <span
        className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-bold text-white"
        style={{ backgroundColor: run.color }}
      >
        {run.label}
      </span>
    );
  }
  if (isSelfTransportCode(code)) {
    return <span className="text-muted-foreground">Self</span>;
  }
  return <span className="text-muted-foreground">{code || "—"}</span>;
}
