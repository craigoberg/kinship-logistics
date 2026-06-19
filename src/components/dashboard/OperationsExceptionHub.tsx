import { useState } from "react";
import { format } from "date-fns";
import {
  AlertOctagon,
  AlertTriangle,
  CalendarIcon,
  CheckCircle2,
  ShieldAlert,
  Truck,
  UserCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  useMedicationExceptions,
  DAY_ANOMALY_PLACEHOLDERS,
  VEHICLE_COMPLIANCE_PLACEHOLDERS,
  STAFF_CERT_PLACEHOLDERS,
  type PlaceholderRow,
} from "@/hooks/use-exception-feed";

type Tone = "critical" | "warning" | "info" | "clear";

interface SectionRow {
  key: string;
  title: string;
  detail: string;
}

const toneStyles: Record<Tone, { border: string; tint: string; badge: string; icon: string }> = {
  critical: {
    border: "border-l-destructive",
    tint: "bg-destructive/5",
    badge: "bg-destructive text-destructive-foreground",
    icon: "text-destructive",
  },
  warning: {
    border: "border-l-warning",
    tint: "bg-warning/5",
    badge: "bg-warning/15 text-warning border border-warning/30",
    icon: "text-warning",
  },
  info: {
    border: "border-l-amber-500",
    tint: "bg-amber-500/5",
    badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30",
    icon: "text-amber-600 dark:text-amber-400",
  },
  clear: {
    border: "border-l-green-600",
    tint: "bg-green-500/5",
    badge: "bg-green-600 text-white",
    icon: "text-green-600 dark:text-green-400",
  },
};

export function OperationsExceptionHub() {
  const { data: medExceptions = [], isLoading } = useMedicationExceptions();

  const criticalRows: SectionRow[] = medExceptions.map((m) => ({
    key: m.legId,
    title: `${m.participantName} · Leg ${m.legNumber}${m.eventTitle ? ` (${m.eventTitle})` : ""}`,
    detail: m.exceptionLabel,
  }));

  const toRows = (items: readonly PlaceholderRow[]): SectionRow[] =>
    items.map((r, idx) => ({ key: `${r.title}-${idx}`, title: r.title, detail: r.detail }));

  return (
    <Card className="space-y-4 p-5">
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
          Live
        </div>
      </header>

      <div className="space-y-3">
        <Section
          icon={AlertOctagon}
          tone="critical"
          title="Critical · On-Road"
          subtitle={isLoading ? "Checking…" : "Active medication handover exceptions"}
          rows={criticalRows}
        />
        <Section
          icon={AlertTriangle}
          tone="warning"
          title="Start/End-of-Day Anomalies & Incidents"
          rows={toRows(DAY_ANOMALY_PLACEHOLDERS)}
          isPreview
        />
        <Section
          icon={Truck}
          tone="info"
          title="Vehicle Compliance"
          rows={toRows(VEHICLE_COMPLIANCE_PLACEHOLDERS)}
          isPreview
        />
        <Section
          icon={UserCheck}
          tone="info"
          title="Staff Certifications"
          rows={toRows(STAFF_CERT_PLACEHOLDERS)}
          isPreview
        />
      </div>
    </Card>
  );
}

function Section({
  icon: Icon,
  tone,
  title,
  subtitle,
  rows,
  isPreview,
}: {
  icon: LucideIcon;
  tone: Tone;
  title: string;
  subtitle?: string;
  rows: SectionRow[];
  isPreview?: boolean;
}) {
  const isClear = rows.length === 0;
  const effectiveTone: Tone = isClear ? "clear" : tone;
  const s = toneStyles[effectiveTone];
  return (
    <section className={cn("rounded-md border-l-4 px-4 py-3", s.border, s.tint)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className={cn("h-4 w-4 shrink-0", s.icon)} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="truncate text-sm font-semibold">{title}</h4>
              {isPreview && (
                <span className="rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Preview
                </span>
              )}
            </div>
            {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {!isClear && (
          <Badge className={cn("shrink-0 tabular-nums", s.badge)} variant="outline">
            {rows.length}
          </Badge>
        )}
      </div>

      <ul className="mt-2 space-y-1.5">
        {isClear ? (
          <li className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            All clear
          </li>
        ) : (
          rows.map((r) =>
            isPreview ? <DeferRow key={r.key} row={r} /> : <PlainRow key={r.key} row={r} />,
          )
        )}
      </ul>
    </section>
  );
}

function PlainRow({ row }: { row: SectionRow }) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-sm bg-background/60 px-2 py-1.5 text-xs">
      <span className="min-w-0 truncate font-medium">{row.title}</span>
      <span className="min-w-0 flex-1 truncate text-right text-muted-foreground">{row.detail}</span>
    </li>
  );
}

function DeferRow({ row }: { row: SectionRow }) {
  const [date, setDate] = useState<Date | undefined>(undefined);
  return (
    <li>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex w-full items-start justify-between gap-3 rounded-sm bg-background/60 px-2 py-1.5 text-left text-xs transition hover:bg-background"
          >
            <span className="min-w-0 truncate font-medium">{row.title}</span>
            <span className="min-w-0 flex-1 truncate text-right text-muted-foreground">{row.detail}</span>
          </button>
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
    </li>
  );
}
