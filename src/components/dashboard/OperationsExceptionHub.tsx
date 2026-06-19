import { useState } from "react";
import { format } from "date-fns";
import {
  AlertOctagon,
  AlertTriangle,
  CalendarIcon,
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  Truck,
  UserCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  useMedicationExceptions,
  DAY_ANOMALY_PLACEHOLDERS,
  VEHICLE_COMPLIANCE_PLACEHOLDERS,
  STAFF_CERT_PLACEHOLDERS,
  ASSET_LIABILITY_PLACEHOLDERS,
  type PlaceholderRow,
  type Severity,
} from "@/hooks/use-exception-feed";

interface BucketRow {
  key: string;
  title: string;
  detail: string;
  severity: Severity;
}

interface Bucket {
  id: string;
  label: string;
  icon: LucideIcon;
  isLive: boolean;
  rows: BucketRow[];
}

export function OperationsExceptionHub() {
  const { data: medExceptions = [], isLoading } = useMedicationExceptions();

  const liveRows: BucketRow[] = medExceptions.map((m) => ({
    key: m.legId,
    title: `${m.participantName} · Leg ${m.legNumber}${m.eventTitle ? ` (${m.eventTitle})` : ""}`,
    detail: m.exceptionLabel,
    severity: m.severity,
  }));

  const toRows = (items: readonly PlaceholderRow[], prefix: string): BucketRow[] =>
    items.map((r, idx) => ({
      key: `${prefix}-${idx}`,
      title: r.title,
      detail: r.detail,
      severity: r.severity,
    }));


  const buckets: Bucket[] = [
    { id: "on-road", label: "On-Road Issues", icon: AlertOctagon, isLive: true, rows: liveRows },
    {
      id: "day-anomaly",
      label: "Start/End Day Anomaly",
      icon: AlertTriangle,
      isLive: false,
      rows: toRows(DAY_ANOMALY_PLACEHOLDERS, "day"),
    },
    {
      id: "vehicle",
      label: "Vehicle Compliance",
      icon: Truck,
      isLive: false,
      rows: toRows(VEHICLE_COMPLIANCE_PLACEHOLDERS, "veh"),
    },
    {
      id: "staff",
      label: "Staff Certifications",
      icon: UserCheck,
      isLive: false,
      rows: toRows(STAFF_CERT_PLACEHOLDERS, "staff"),
    },
    {
      id: "asset",
      label: "Asset & Liability Insurance",
      icon: ShieldCheck,
      isLive: false,
      rows: toRows(ASSET_LIABILITY_PLACEHOLDERS, "asset"),
    },
  ];

  const drillBuckets = buckets.filter((b) => b.rows.length > 0);

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {buckets.map((b) => (
          <StatusTile key={b.id} bucket={b} />
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

function tileToneClass(count: number, isLive: boolean): string {
  if (count === 0) return "bg-green-600 text-white";
  if (count <= 2) return "bg-yellow-500 text-black";
  return cn("bg-destructive text-destructive-foreground", isLive && "animate-pulse");
}

function StatusTile({ bucket }: { bucket: Bucket }) {
  const { label, icon: Icon, rows, isLive } = bucket;
  const count = rows.length;
  const isClear = count === 0;
  const tone = tileToneClass(count, isLive);

  return (
    <div
      className={cn(
        "relative flex min-h-32 flex-col justify-between rounded-lg p-4 shadow-sm transition",
        tone,
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
    </div>
  );
}

function DrillTable({ bucket }: { bucket: Bucket }) {
  const { label, icon: Icon, rows, isLive } = bucket;
  return (
    <section className="rounded-md border border-border bg-background/40">
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
            <tr key={r.key} className="border-t border-border/60">
              <td className="px-3 py-2 font-medium">{r.title}</td>
              <td className="px-3 py-2 text-muted-foreground">{r.detail}</td>
              <td className="px-3 py-2 text-right">
                {isLive ? (
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
