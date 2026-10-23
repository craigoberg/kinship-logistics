import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";

import { IssueRegisterCard, type IssueRegisterSeverity } from "@/components/issue-engine/issue-register-card";
import { listMaintenanceItems } from "@/lib/api/maintenance";
import { supabase } from "@/integrations/supabase/client";

/**
 * Open faults already logged for this bus, with the workaround.
 * Same card as the Day Centre issues register so a later driver does not log them again.
 */
export function VehicleKnownIssues({
  asset,
}: {
  asset: { id: string; name: string; regoPlate: string };
}) {
  const q = useQuery({
    queryKey: ["vehicle-known-issues", asset.id],
    queryFn: () => loadVehicleKnownIssues(asset),
    staleTime: 30_000,
  });

  if (q.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading known issues…
      </div>
    );
  }

  if (q.isError) {
    return (
      <p className="text-sm text-destructive">
        Could not load known issues: {(q.error as Error).message}
      </p>
    );
  }

  const rows = q.data ?? [];
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No open issues on file for this bus.</p>;
  }

  return (
    <div className="space-y-2 rounded-lg border-2 border-yellow-500/60 bg-yellow-500/10 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
        <div>
          <div className="text-sm font-bold text-yellow-800 dark:text-yellow-200">
            Known Issues ({rows.length})
          </div>
          <p className="text-xs text-muted-foreground">
            Already logged for this bus, with the workaround. Do not log these again.
          </p>
        </div>
      </div>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id}>
            <IssueRegisterCard issue={row} />
          </li>
        ))}
      </ul>
    </div>
  );
}

interface KnownRow {
  id: string;
  severity: IssueRegisterSeverity;
  occurredAt: string;
  loggedAt: string;
  description: string;
  workaroundPlan: string | null;
  sourceLabel: string;
}

function loadVehicleKnownIssues(asset: {
  id: string;
  name: string;
  regoPlate: string;
}): Promise<KnownRow[]> {
  return Promise.all([loadIncidents(asset.id), loadMaintenance(asset)]).then(([incidents, maintenance]) => {
    const seen = new Set(incidents.map((row) => fingerprint(row.description)));
    const extra = maintenance.filter((row) => !seen.has(fingerprint(row.description)));
    return [...incidents, ...extra].sort(bySeverityThenNewest);
  });
}

async function loadIncidents(assetId: string): Promise<KnownRow[]> {
  const { data, error } = await supabase
    .from("operational_incidents")
    .select("id, severity, description, created_at, occurred_at")
    .eq("vehicle_id", assetId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const description = String(row.description ?? "");
    const split = splitWorkaround(description);
    const createdAt = String(row.created_at ?? "");
    return {
      id: `incident:${row.id}`,
      severity: incidentSeverity(row.severity as string | null),
      occurredAt: String(row.occurred_at ?? createdAt),
      loggedAt: createdAt,
      description: cleanDescription(split.description),
      workaroundPlan: split.workaround,
      sourceLabel: "Bus",
    };
  });
}

async function loadMaintenance(asset: {
  name: string;
  regoPlate: string;
}): Promise<KnownRow[]> {
  const items = await listMaintenanceItems();
  return items
    .filter(
      (item) =>
        item.status === "open" ||
        item.status === "in_progress" ||
        item.status === "deferred",
    )
    .filter((item) => mentionsVehicle(item.locationLabel, asset) || mentionsVehicle(item.title, asset))
    .map((item) => {
      const split = splitWorkaround(item.description || item.title);
      const workaround =
        split.workaround ||
        (item.status === "deferred" ? item.deferredReason : null) ||
        null;
      return {
        id: `maint:${item.id}`,
        severity: item.severity,
        occurredAt: item.occurredAt,
        loggedAt: item.createdAt,
        description: cleanDescription(split.description || item.title),
        workaroundPlan: workaround,
        sourceLabel: "Bus",
      };
    });
}

function mentionsVehicle(
  text: string | null | undefined,
  asset: { name: string; regoPlate: string },
): boolean {
  const hay = (text ?? "").toLowerCase();
  if (!hay) return false;
  const name = asset.name.trim().toLowerCase();
  const plate = asset.regoPlate.toLowerCase().replace(/\s+/g, "");
  const nameHit = name.length > 2 && hay.includes(name);
  const plateHit = plate.length >= 4 && hay.replace(/\s+/g, "").includes(plate);
  return nameHit || plateHit;
}

function splitWorkaround(text: string): { description: string; workaround: string | null } {
  const work = text.split(/\s+[—-]\s+Workaround:\s+/i);
  if (work.length >= 2) {
    const workaround = work.slice(1).join(" — Workaround: ").trim();
    return { description: work[0].trim(), workaround: workaround || null };
  }
  const consulted = text.split(/\s+[—-]\s+Consulted:\s+/i);
  if (consulted.length >= 2) {
    const workaround = consulted.slice(1).join(" — Consulted: ").trim();
    return { description: consulted[0].trim(), workaround: workaround || null };
  }
  return { description: text, workaround: null };
}

function cleanDescription(text: string): string {
  return text.replace(/\[(?:PRE-TRIP|VERBAL WORKAROUND)\]\s*/gi, "").trim();
}

function incidentSeverity(sev: string | null): IssueRegisterSeverity {
  if (sev === "sev1") return "red";
  if (sev === "sev2") return "yellow";
  if (sev === "sev3") return "green";
  return null;
}

function fingerprint(text: string): string {
  return cleanDescription(text).toLowerCase().replace(/\s+/g, " ").slice(0, 80);
}

function bySeverityThenNewest(a: KnownRow, b: KnownRow): number {
  const rank = (sev: IssueRegisterSeverity) => (sev === "red" ? 0 : sev === "yellow" ? 1 : sev === "green" ? 2 : 3);
  const bySev = rank(a.severity) - rank(b.severity);
  if (bySev !== 0) return bySev;
  return a.occurredAt < b.occurredAt ? 1 : -1;
}
