import { useState } from "react";
import { format } from "date-fns";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertOctagon,
  AlertTriangle,
  CalendarIcon,
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
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { rerouteParticipantForDate } from "@/lib/data-store";
import {
  useMedicationExceptions,
  useMedicationScheduleExceptions,
  useStartEndDayAnomalies,
  VEHICLE_COMPLIANCE_PLACEHOLDERS,
  STAFF_CERT_PLACEHOLDERS,
  ASSET_LIABILITY_PLACEHOLDERS,
  type PlaceholderRow,
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

export function OperationsExceptionHub() {
  const { data: medExceptions = [], isLoading } = useMedicationExceptions();
  const { data: medScheduleRows } = useMedicationScheduleExceptions();
  const { data: dayAnomalyRows } = useStartEndDayAnomalies();

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


  const toRows = (items: readonly PlaceholderRow[], prefix: string): BucketRow[] =>
    items.map((r, idx) => ({
      key: `${prefix}-${idx}`,
      title: r.title,
      detail: r.detail,
      severity: r.severity,
    }));

  const buckets: Bucket[] = [
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
    {
      id: "vehicle",
      anchorId: "exception-section-vehicle",
      label: "Vehicle Compliance",
      icon: Truck,
      isLive: false,
      rows: toRows(VEHICLE_COMPLIANCE_PLACEHOLDERS, "veh"),
    },
    {
      id: "staff",
      anchorId: "exception-section-staff",
      label: "Staff Certifications",
      icon: UserCheck,
      isLive: false,
      rows: toRows(STAFF_CERT_PLACEHOLDERS, "staff"),
    },
    {
      id: "asset",
      anchorId: "exception-section-asset",
      label: "Asset & Liability Insurance",
      icon: ShieldCheck,
      isLive: false,
      rows: toRows(ASSET_LIABILITY_PLACEHOLDERS, "asset"),
    },
  ];

  const drillBuckets = buckets.filter((b) => b.rows.length > 0);

  const handleTileClick = (b: Bucket) => {
    if (b.rows.length === 0) return;
    document.getElementById(b.anchorId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <Card className="space-y-5 p-5">
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {buckets.map((b) => (
          <StatusTile key={b.id} bucket={b} onClick={() => handleTileClick(b)} />
        ))}
      </div>

      {drillBuckets.length > 0 && (
        <div className="space-y-4">
          {drillBuckets.map((b) => (
            <DrillTable key={b.id} bucket={b} />
          ))}
        </div>
      )}
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
        "relative flex min-h-32 flex-col justify-between rounded-lg p-4 text-left shadow-sm transition",
        tone,
        interactive
          ? "cursor-pointer hover:brightness-110 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-foreground/40"
          : "cursor-default",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Icon className="h-5 w-5 shrink-0 opacity-90" />
        {!isClear && (
          <span className="rounded-md bg-black/20 px-2 py-0.5 text-xs font-bold tabular-nums">
            {count}
          </span>
        )}
        {isClear && <CheckCircle2 className="h-5 w-5 shrink-0 opacity-90" />}
      </div>
      <div className="mt-3">
        <div className="text-sm font-semibold leading-tight">{label}</div>
        <div className="mt-1 text-[11px] uppercase tracking-wide opacity-80">
          {isLive ? "Live" : "Preview"}
        </div>
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
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
          <CalendarIcon className="mr-1 h-3.5 w-3.5" />
          Defer
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-3">
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarIcon className="h-3.5 w-3.5" />
          Defer item until action date arrives.
        </div>
        <Calendar
          mode="single"
          selected={date}
          onSelect={setDate}
          initialFocus
          className={cn("p-2 pointer-events-auto")}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {date ? format(date, "PPP") : "No date selected"}
          </span>
          <Button size="sm" disabled>
            Defer (coming soon)
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
