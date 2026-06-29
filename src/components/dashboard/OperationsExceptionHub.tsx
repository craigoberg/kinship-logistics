import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { WallCalendar } from "./rolling-month-calendar";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Pill,
  ShieldAlert,
  ShieldCheck,
  Split,
  Stethoscope,
  Truck,
  UserCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";


import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { cn } from "@/lib/utils";
import { rerouteParticipantForDate } from "@/lib/data-store";
import { ResolveDispatcher } from "./dispatch-resolve-modal";
import type { ComplianceAsset } from "@/lib/api/compliance-assets";
import {
  useMedicationExceptions,
  useMedicationScheduleExceptions,
  useStartEndDayAnomalies,
  useComplianceCategories,
  type ComplianceExceptionRow,
  type Severity,
} from "@/hooks/use-exception-feed";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function SplitManifestAction({ participantId, participantName }: { participantId: string; participantName: string }) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => rerouteParticipantForDate(participantId, todayStr()),
    onSuccess: (res) => {
      toast.success(`${participantName} rerouted`, {
        description: `${res.bookingsUpdated} booking(s) flagged · ${res.legsRemoved} active leg(s) removed.`,
      });
      qc.invalidateQueries({ queryKey: ["start-end-day-anomalies"] });
      qc.invalidateQueries({ queryKey: ["today-manifest-summary"] });
      qc.invalidateQueries({ queryKey: ["transport_trips", "active"] });
    },
    onError: (e: Error) =>
      toast.error("Could not reroute passenger", { description: e.message }),
  });
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs"
      onClick={() => mut.mutate()}
      disabled={mut.isPending}
    >
      <Split className="mr-1 h-3.5 w-3.5" />
      {mut.isPending ? "Rerouting…" : "Split Manifest / Arrange Alt Transport"}
    </Button>
  );
}

interface BucketRow {
  key: string;
  title: string;
  detail: string;
  severity: Severity;
  action?: React.ReactNode;
}

interface Bucket {
  id: string;
  anchorId: string;
  label: string;
  icon: LucideIcon;
  isLive: boolean;
  rows: BucketRow[];
}

const CATEGORY_PRESENTATION: Record<string, { label: string; icon: LucideIcon }> = {
  VEHICLE: { label: "Vehicle Compliance", icon: Truck },
  STAFF: { label: "Staff Certifications", icon: UserCheck },
  INSURANCE: { label: "Asset & Liability Insurance", icon: ShieldCheck },
  EQUIPMENT: { label: "Equipment & Audits", icon: ShieldAlert },
  FACILITY: { label: "Facility & Lease", icon: ShieldCheck },
};

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/[\s_-]+/)
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join(" ");
}



export function OperationsExceptionHub() {
  const qc = useQueryClient();
  const { data: medExceptions = [], isLoading } = useMedicationExceptions();
  const { data: medScheduleRows } = useMedicationScheduleExceptions();
  const { data: dayAnomalyRows } = useStartEndDayAnomalies();
  const { data: categories } = useComplianceCategories();

  const [activeAsset, setActiveAsset] = useState<ComplianceAsset | null>(null);

  const liveRows: BucketRow[] = medExceptions.map((m) => ({
    key: m.legId,
    title: `${m.participantName} · Leg ${m.legNumber}${m.eventTitle ? ` (${m.eventTitle})` : ""}`,
    detail: m.exceptionLabel,
    severity: m.severity,
  }));

  const medScheduleBucketRows: BucketRow[] = medScheduleRows.map((r) => ({
    key: r.key,
    title: r.title,
    detail: r.detail,
    severity: r.severity,
    action: (
      <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
        <Link to="/participants" aria-label={`Manage medicals for ${r.participantName}`}>
          <Stethoscope className="mr-1 h-3.5 w-3.5" />
          Manage Medicals
        </Link>
      </Button>
    ),
  }));


  // Operational tiles (live signals — not driven by the registry).
  const operationalBuckets: Bucket[] = [
    {
      id: "medication",
      anchorId: "exception-section-medication",
      label: "Medication Schedules",
      icon: Pill,
      isLive: true,
      rows: medScheduleBucketRows,
    },
    {
      id: "on-road",
      anchorId: "exception-section-onroad",
      label: "On-Road Issues",
      icon: AlertOctagon,
      isLive: true,
      rows: liveRows,
    },
    {
      id: "day-anomaly",
      anchorId: "exception-section-day-anomaly",
      label: "Start/End Day Anomaly",
      icon: AlertTriangle,
      isLive: true,
      rows: dayAnomalyRows.map((r) => ({
        key: r.key,
        title: r.title,
        detail: r.detail,
        severity: r.severity,
        action:
          r.kind === "hoist" && r.participantId && r.participantName ? (
            <SplitManifestAction
              participantId={r.participantId}
              participantName={r.participantName}
            />
          ) : undefined,
      })),
    },
  ];

  // Registry-driven tiles — one bucket per unique category present in
  // compliance_assets (status = active).
  //
  // GUARDRAILS §5.1: Adding a new category to the DB automatically lights up
  // a new tile here with no code change required. Green categories (all assets
  // within threshold) render an "all-clear" tile. Yellow/red categories show
  // a count badge and scroll to their drill table.
  const registryBuckets: Bucket[] = categories.map(({ category, exceptionRows }) => {
    const pres = CATEGORY_PRESENTATION[category] ?? {
      label: titleCase(category),
      icon: ShieldCheck,
    };
    return {
      id: `compliance-${category.toLowerCase()}`,
      anchorId: `exception-section-compliance-${category.toLowerCase()}`,
      label: pres.label,
      icon: pres.icon,
      isLive: true,
      rows: exceptionRows.map((r) => ({
        key: r.key,
        title: r.title,
        detail: r.detail,
        severity: r.severity,
        action: (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => setActiveAsset(r.asset)}
          >
            <ShieldCheck className="mr-1 h-3.5 w-3.5" />
            Resolve
          </Button>
        ),
      })),
    };
  });

  const buckets: Bucket[] = [...operationalBuckets, ...registryBuckets];


  const drillBuckets = buckets.filter((b) => b.rows.length > 0);

  const handleTileClick = (b: Bucket) => {
    if (b.rows.length === 0) return;
    document.getElementById(b.anchorId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <Card className="space-y-3 p-3">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-destructive" />
          <h3 className="text-base font-semibold">Operations Exception Hub</h3>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
          </span>
          {isLoading ? "Checking…" : "Live"}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {buckets.map((b) => (
          <StatusTile key={b.id} bucket={b} onClick={() => handleTileClick(b)} />
        ))}
      </div>

      <WallCalendar />

      {drillBuckets.length > 0 && (
        <div className="space-y-4">
          {drillBuckets.map((b) => (
            <DrillTable key={b.id} bucket={b} />
          ))}
        </div>
      )}

      <ResolveDispatcher
        asset={activeAsset}
        onClose={() => setActiveAsset(null)}
        onResolved={() => {
          qc.invalidateQueries({ queryKey: ["compliance-assets"] });
          qc.invalidateQueries({ queryKey: ["fleet"] });
          qc.invalidateQueries({ queryKey: ["staff-registry", "all"] });
        }}
      />
    </Card>
  );
}

function worstSeverity(rows: BucketRow[]): Severity | null {
  if (rows.some((r) => r.severity === "critical")) return "critical";
  if (rows.some((r) => r.severity === "warning")) return "warning";
  if (rows.length > 0) return "info";
  return null;
}

function tileToneClass(rows: BucketRow[], isLive: boolean): string {
  switch (worstSeverity(rows)) {
    case null:
      return "bg-green-600 text-white";
    case "info":
      return "bg-amber-500 text-black";
    case "warning":
      return "bg-yellow-500 text-black";
    case "critical":
      return cn("bg-destructive text-destructive-foreground", isLive && "animate-pulse");
  }
}

function StatusTile({ bucket, onClick }: { bucket: Bucket; onClick: () => void }) {
  const { label, icon: Icon, rows, isLive } = bucket;
  const count = rows.length;
  const isClear = count === 0;
  const tone = tileToneClass(rows, isLive);
  const interactive = !isClear;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      aria-label={
        interactive
          ? `${label}: ${count} ${count === 1 ? "item" : "items"} — scroll to details`
          : `${label}: all clear`
      }
      className={cn(
        "relative flex min-h-16 flex-col justify-between rounded-lg p-2.5 text-left shadow-sm transition",
        tone,
        interactive
          ? "cursor-pointer hover:brightness-110 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-foreground/40"
          : "cursor-default",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <Icon className="h-4 w-4 shrink-0 opacity-90" />
        {!isClear && (
          <span className="rounded-md bg-black/20 px-1.5 py-0.5 text-xs font-bold tabular-nums">
            {count}
          </span>
        )}
        {isClear && <CheckCircle2 className="h-4 w-4 shrink-0 opacity-90" />}
      </div>
      <div className="mt-2">
        <div className="text-xs font-semibold leading-snug">{label}</div>
      </div>
    </button>
  );
}

const rowAccent: Record<Severity, string> = {
  critical: "border-l-4 border-l-destructive bg-destructive/5",
  warning: "border-l-4 border-l-yellow-500 bg-yellow-500/5",
  info: "border-l-4 border-l-amber-500 bg-amber-500/5",
};

const severityChip: Record<Severity, string> = {
  critical: "bg-destructive/15 text-destructive border border-destructive/30",
  warning: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border border-yellow-500/30",
  info: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30",
};

const severityLabel: Record<Severity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

function DrillTable({ bucket }: { bucket: Bucket }) {
  const { label, icon: Icon, rows, isLive, anchorId } = bucket;
  return (
    <section id={anchorId} className="scroll-mt-20 rounded-md border border-border bg-background/40">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-semibold">{label}</h4>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {rows.length} {rows.length === 1 ? "item" : "items"}
        </span>
      </header>
      <table className="w-full text-xs">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Item</th>
            <th className="px-3 py-2 font-medium">Detail</th>
            <th className="px-3 py-2 text-right font-medium">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={cn("border-t border-border/60", rowAccent[r.severity])}>
              <td className="px-3 py-2 font-medium">
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      severityChip[r.severity],
                    )}
                  >
                    {severityLabel[r.severity]}
                  </span>
                  <span>{r.title}</span>
                </span>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{r.detail}</td>
              <td className="px-3 py-2 text-right">
                {r.action ? (
                  r.action
                ) : isLive ? (
                  <span className="text-[11px] text-muted-foreground">Triaged on manifest</span>
                ) : (
                  <DeferAction />
                )}
              </td>

            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function DeferAction() {
  const [date, setDate] = useState<Date | undefined>(undefined);
  return (
    <div className="flex items-center gap-2">
      <DatePicker
        value={date}
        onChange={setDate}
        placeholder="Defer until…"
        className="h-7 w-auto px-2 text-xs"
      />
      <Button size="sm" disabled>
        Defer (coming soon)
      </Button>
    </div>
  );
}
