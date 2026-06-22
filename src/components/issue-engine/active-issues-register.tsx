import { useMemo } from "react";
import { AlertTriangle, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClientTime } from "@/components/ui/client-time";
import { cn } from "@/lib/utils";
import { useUnifiedIssues } from "@/hooks/use-unified-issues";
import type { UnifiedIssue } from "@/lib/api/unified-issues";

/**
 * Section 9 — Unified Active Issues Register.
 *
 * Mounted at the top of any operator workflow (driver pre-trip, day-centre
 * walkthrough, manager dashboard) so the operator sees inherited / open
 * exceptions before logging anything new.
 *
 *  - `vehicleInfo`  : filter escalations whose `vehicle_info` substring matches
 *                     (e.g. "Bus 4 · ABC123"). Day-centre / renewal items are
 *                     filtered out when this prop is provided.
 *  - `onDuplicateKeys` : the parent can read the resolved keys via the
 *                     `duplicateSignatures` helper export and pass them into
 *                     LogAnomalyModal to block duplicate reports.
 */
interface Props {
  /** Restrict to issues that mention this vehicle (sub-string match on vehicle_info). */
  vehicleInfo?: string;
  /** Optional title override. */
  title?: string;
  /** Hide the register completely when nothing is open. Default: render empty state. */
  hideWhenEmpty?: boolean;
}

export function ActiveIssuesRegister({
  vehicleInfo,
  title = "Active Issues Register",
  hideWhenEmpty = false,
}: Props) {
  const q = useUnifiedIssues();

  const filtered = useMemo<UnifiedIssue[]>(() => {
    const all = q.data ?? [];
    if (!vehicleInfo) return all;
    const needle = vehicleInfo.toLowerCase();
    return all.filter((i) => {
      // Vehicle-scoped: escalations whose vehicle_info matches, plus incidents
      // whose description mentions the vehicle. Day-centre + renewal items
      // are not vehicle-specific so they fall away in vehicle mode.
      if (i.source === "escalation") {
        const raw = i.raw as { vehicle_info?: string | null } | null;
        return (raw?.vehicle_info ?? "").toLowerCase().includes(needle);
      }
      if (i.source === "incident") {
        return i.description.toLowerCase().includes(needle);
      }
      return false;
    });
  }, [q.data, vehicleInfo]);

  const hasWorkaround = (i: UnifiedIssue): boolean => {
    const raw = i.raw as Record<string, unknown> | null;
    const wp = (raw?.workaround_plan as string | null) ?? null;
    const wa = (raw?.workaround_accepted_at as string | null) ?? null;
    return Boolean((wp && wp.trim().length > 0) || wa);
  };

  if (q.isLoading) {
    return (
      <Card className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking active issues…
      </Card>
    );
  }

  if (filtered.length === 0) {
    if (hideWhenEmpty) return null;
    return (
      <Card className="border-emerald-600/40 bg-emerald-600/5 p-3">
        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
          <ShieldCheck className="h-4 w-4" />
          <span className="text-xs font-semibold">
            {vehicleInfo
              ? `No open issues on file for ${vehicleInfo}.`
              : "No open issues on the register."}
          </span>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-xs font-extrabold uppercase tracking-wide">
            {title}
          </span>
        </div>
        <Badge variant="secondary">{filtered.length} open</Badge>
      </div>

      <ul className="mt-2 space-y-2">
        {filtered.map((i) => {
          const workaround = hasWorkaround(i);
          return (
            <li
              key={i.key}
              className={cn(
                "rounded-md border p-2 text-xs",
                i.severity === "red"
                  ? "border-red-600/50 bg-red-600/5"
                  : i.severity === "yellow"
                    ? "border-yellow-500/50 bg-yellow-500/10"
                    : "border-border bg-background",
              )}
            >
              <div className="flex items-start gap-2">
                {i.severity === "red" ? (
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold leading-snug">{i.title}</div>
                  {i.description && i.description !== i.title && (
                    <div className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">
                      {i.description}
                    </div>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                    <Badge variant="outline" className="font-mono">
                      {i.sourceLabel}
                    </Badge>
                    <span>·</span>
                    <ClientTime iso={i.createdAt} />
                    {workaround && (
                      <Badge className="bg-amber-500 text-black">
                        Workaround in force
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/**
 * Build a stable set of signatures so callers can suppress duplicate logging
 * (e.g. don't let a driver re-report a fault already listed above).
 *
 * Signature is a lower-cased, whitespace-collapsed slice of the issue title +
 * description. Match in the consumer with `signatures.has(candidate)`.
 */
export function buildDuplicateSignatures(issues: UnifiedIssue[]): Set<string> {
  const out = new Set<string>();
  for (const i of issues) {
    const text = `${i.title} ${i.description}`.toLowerCase().replace(/\s+/g, " ").trim();
    if (text.length >= 6) out.add(text);
  }
  return out;
}
