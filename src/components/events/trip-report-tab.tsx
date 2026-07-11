/**
 * TripReportTab — aggregate read model for an outing event (§12.8 / Phase 4)
 *
 * Displays:
 *   • Event header + status
 *   • Venue itinerary (per-day ordered stops)
 *   • Day sessions: manager, phase, bus/curfew/morning accountability counts
 *   • Roster summary table
 *   • Finance P&L
 *
 * Intended to be printable via window.print() — all sections are visible.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bus,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  Info,
  Loader2,
  MapPin,
  Moon,
  Phone,
  Printer,
  RefreshCw,
  ShieldAlert,
  Sunrise,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildTripReport, type TripReport, type TripReportDaySession, type TripReportIssue } from "@/lib/api/event-lifecycle";
import { cn } from "@/lib/utils";
import type { EventManifest } from "@/lib/data-store";
import { EventTransportBadge } from "./event-transport-badge";

interface Props {
  event: EventManifest;
}

const reportKey = (eventId: string) => ["trip-report", eventId] as const;

function fmtMoney(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${abs})` : abs;
}

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-AU", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}

function phaseBadge(phase: string): React.ReactNode {
  if (phase === "closed_orderly") return <Badge className="bg-emerald-600 text-white text-[10px]">Closed — orderly</Badge>;
  if (phase === "closed_incident") return <Badge className="bg-destructive text-destructive-foreground text-[10px]">Closed — incident</Badge>;
  if (phase === "planning") return <Badge variant="secondary" className="text-[10px]">Planning</Badge>;
  return <Badge className="bg-yellow-500 text-black text-[10px]">{phase}</Badge>;
}

export function TripReportTab({ event }: Props) {
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: report, isLoading, error, refetch } = useQuery({
    queryKey: [...reportKey(event.id), refreshKey],
    queryFn: () => buildTripReport(event.id),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive-foreground">
        <XCircle className="mr-2 inline h-4 w-4" />
        {(error as Error)?.message ?? "Could not load trip report."}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Print styles — injected once per render */}
      <style>{`
        @media print {
          /* Hide chrome around the report */
          [data-trip-report-actions] { display: none !important; }
          /* Expand all sections — no collapsed borders */
          .rounded-lg { border-radius: 0 !important; }
          /* Page break before each section */
          [data-trip-report-section] { page-break-inside: avoid; }
          /* Remove shadows */
          * { box-shadow: none !important; }
          /* Ensure full-width */
          body { width: 100% !important; margin: 0; }
        }
      `}</style>

      {/* Actions (hidden on print) */}
      <div className="flex items-center justify-between print:hidden" data-trip-report-actions>
        <p className="text-xs text-muted-foreground">
          Generated {new Date(report.generatedAt).toLocaleString("en-AU")}.
          Outbound and return reflect event-floor operations when recorded.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { setRefreshKey((p) => p + 1); }}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="mr-1.5 h-3.5 w-3.5" /> Print
          </Button>
        </div>
      </div>

      {/* ── Event header ── */}
      <Section icon={<FileText className="h-4 w-4" />} title="Event summary">
        <div className="grid gap-2 sm:grid-cols-2 text-sm">
          <Field label="Title">{report.title}</Field>
          <Field label="Kind">{kindLabel(report.eventKind)}</Field>
          <Field label="Status"><StatusBadge status={report.status} /></Field>
          <Field label="Primary venue">{report.primaryVenueName ?? "—"}</Field>
          <Field label="Start date">{fmtDate(report.startDate)}</Field>
          <Field label="End date">{report.endDate ? fmtDate(report.endDate) : "Single day"}</Field>
        </div>
        {/* Accountability overview pills */}
        <div className="mt-3 flex flex-wrap gap-2">
          <Pill
            value={report.accountabilitySummary.allSessionsClosed}
            trueLabel="All days closed" falseLabel="Days still open"
          />
          {report.accountabilitySummary.totalRedIssues > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-2.5 py-1 text-[11px] font-semibold text-destructive">
              <AlertTriangle className="h-3 w-3" />
              {report.accountabilitySummary.totalRedIssues} RED
            </span>
          )}
          {report.accountabilitySummary.totalYellowIssues > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-yellow-500/10 px-2.5 py-1 text-[11px] font-semibold text-yellow-700">
              <AlertTriangle className="h-3 w-3" />
              {report.accountabilitySummary.totalYellowIssues} YELLOW
            </span>
          )}
          {report.accountabilitySummary.totalGreenIssues > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
              <Info className="h-3 w-3" />
              {report.accountabilitySummary.totalGreenIssues} GREEN
            </span>
          )}
          {report.accountabilitySummary.totalRedIssues === 0 &&
            report.accountabilitySummary.totalYellowIssues === 0 &&
            report.accountabilitySummary.totalGreenIssues === 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
              <CheckCircle2 className="h-3 w-3" /> No RYGE issues logged
            </span>
          )}
        </div>
      </Section>

      {/* ── Venue itinerary ── */}
      {report.venueStops.length > 0 && (
        <Section icon={<MapPin className="h-4 w-4" />} title="Venue itinerary">
          <VenueItinerary stops={report.venueStops} />
        </Section>
      )}

      {/* ── Day sessions ── */}
      {report.daySessions.length > 0 && (
        <Section icon={<CalendarDays className="h-4 w-4" />} title="Day sessions">
          <div className="divide-y rounded-lg border">
            {report.daySessions.map((d) => (
              <DaySessionBlock key={d.sessionDate} day={d} />
            ))}
          </div>
        </Section>
      )}

      {/* ── Roster ── */}
      <Section icon={<Users className="h-4 w-4" />} title={`Roster (${report.rosterSummary.total})`}>
        <div className="mb-3 flex flex-wrap gap-3 text-sm">
          <span className="font-medium">{report.rosterSummary.confirmed} confirmed</span>
          <span className="text-muted-foreground">{report.rosterSummary.cancelled} cancelled</span>
        </div>
        <RosterTable roster={report.roster} />
      </Section>

      {/* ── Finance ── */}
      <Section icon={<Wallet className="h-4 w-4" />} title="Finance P&L">
        <div className="grid gap-3 sm:grid-cols-3">
          <FinanceCard label="Ticket revenue" value={`$${fmtMoney(report.finance.ticketRevenue)}`} />
          <FinanceCard label="Vendor expenses" value={`$${fmtMoney(report.finance.vendorExpenses)}`} tone="expense" />
          <FinanceCard
            label="Net P&L"
            value={`${report.finance.netPnl < 0 ? "−" : ""}$${fmtMoney(Math.abs(report.finance.netPnl))}`}
            tone={report.finance.netPnl >= 0 ? "positive" : "negative"}
            emphasis
          />
        </div>
      </Section>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card" data-trip-report-section>
      <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2.5">
        <span className="text-primary">{icon}</span>
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium">{children}</div>
    </div>
  );
}

function Pill({ value, trueLabel, falseLabel }: { value: boolean; trueLabel: string; falseLabel: string }) {
  return value ? (
    <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
      <CheckCircle2 className="h-3 w-3" />{trueLabel}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
      <Clock className="h-3 w-3" />{falseLabel}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    Planning: "bg-slate-500",
    Confirmed: "bg-blue-600",
    Open: "bg-emerald-600",
    Closed: "bg-zinc-600",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white ${colors[status] ?? "bg-slate-500"}`}>
      {status}
    </span>
  );
}

function kindLabel(k: string): string {
  return { legacy: "Standard event", single_day_outing: "Single-day outing", multi_day_tour: "Multi-day tour" }[k] ?? k;
}

function VenueItinerary({ stops }: { stops: TripReport["venueStops"] }) {
  const byDay: Record<string, typeof stops> = {};
  stops.forEach((s) => { (byDay[s.sessionDate] ??= []).push(s); });

  return (
    <div className="space-y-3">
      {Object.entries(byDay).map(([date, dayStops]) => (
        <div key={date}>
          <div className="mb-1 text-xs font-semibold text-muted-foreground">{fmtDate(date)}</div>
          <div className="flex flex-wrap items-center gap-1">
            {dayStops.map((s, idx) => (
              <div key={s.stopOrder} className="flex items-center gap-1">
                <span className="inline-flex items-center gap-1 rounded border bg-background px-2 py-0.5 text-[11px]">
                  <MapPin className="h-3 w-3 text-primary" />
                  {s.labelOverride ?? s.venueName ?? "Unknown"}
                  {s.venueType && <span className="text-muted-foreground">{s.venueType}</span>}
                </span>
                {idx < dayStops.length - 1 && <span className="text-muted-foreground">→</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DaySessionBlock({ day }: { day: TripReportDaySession }) {
  const hasCurfew = day.curfewTotal > 0;
  const hasMorning = day.morningTotal > 0;
  const hasBus = day.busManifestTotal > 0;
  const hasIssues = day.issues.length > 0;

  return (
    <div className="px-4 py-3 space-y-3">
      {/* Day header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-sm">{fmtDate(day.sessionDate)}</span>
        {phaseBadge(day.phase)}
        {day.managerName && (
          <span className="text-xs text-muted-foreground">Trip leader: {day.managerName}</span>
        )}
      </div>

      {/* Accountability counts */}
      {(hasBus || hasCurfew || hasMorning) && (
        <div className="flex flex-wrap gap-4 text-[11px]">
          {hasBus && (
            <span className="flex items-center gap-1">
              <Bus className="h-3 w-3 text-blue-500" />
              Bus: {day.busManifestOnBus}/{day.busManifestTotal} on bus
              {day.busManifestNotTravelling > 0 && ` · ${day.busManifestNotTravelling} not travelling`}
            </span>
          )}
          {hasCurfew && (
            <span className="flex items-center gap-1">
              <Moon className="h-3 w-3" />
              Curfew {day.curfewTime ?? ""}: {day.curfewAccounted}/{day.curfewTotal} accounted
              {day.curfewRed > 0 && <span className="font-bold text-destructive ml-1">· {day.curfewRed} RED</span>}
              {day.curfewYellow > 0 && <span className="font-semibold text-yellow-700 ml-1">· {day.curfewYellow} YELLOW</span>}
            </span>
          )}
          {hasMorning && (
            <span className="flex items-center gap-1">
              <Sunrise className="h-3 w-3" />
              Morning {day.morningRollTime ?? ""}: {day.morningAccounted}/{day.morningTotal} accounted
              {day.morningRed > 0 && <span className="font-bold text-destructive ml-1">· {day.morningRed} RED</span>}
              {day.morningYellow > 0 && <span className="font-semibold text-yellow-700 ml-1">· {day.morningYellow} YELLOW</span>}
            </span>
          )}
        </div>
      )}

      {/* RYGE Issues Register for this day */}
      {hasIssues && (
        <div className="rounded-md border">
          <div className="flex items-center gap-1.5 border-b bg-muted/30 px-3 py-1.5">
            <ShieldAlert className="h-3.5 w-3.5 text-primary" />
            <span className="text-[11px] font-semibold uppercase tracking-wide">Issues logged this day</span>
          </div>
          <div className="divide-y">
            {day.issues.map((issue) => (
              <ReportIssueRow key={issue.id} issue={issue} />
            ))}
          </div>
        </div>
      )}

      {!hasIssues && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-emerald-600" /> No issues logged for this day.
        </p>
      )}
    </div>
  );
}

const REPORT_SEV_BAR: Record<string, string> = {
  red: "border-l-4 border-l-destructive",
  yellow: "border-l-4 border-l-yellow-400",
  green: "border-l-4 border-l-emerald-500",
};

function ReportIssueRow({ issue }: { issue: TripReportIssue }) {
  const isResolved = issue.status !== "open";
  const sevLabel = issue.severity.toUpperCase();
  const bar = REPORT_SEV_BAR[issue.severity] ?? "";

  return (
    <div className={cn("px-3 py-2 text-xs", bar, isResolved && "opacity-60")}>
      <div className="flex items-start gap-2">
        {issue.isVerbalWorkaround ? (
          <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
        ) : issue.severity === "green" ? (
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
        ) : (
          <AlertTriangle className={cn(
            "mt-0.5 h-3.5 w-3.5 shrink-0",
            issue.severity === "red" ? "text-destructive" : "text-yellow-600",
          )} />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-medium">{issue.issueDescription}</p>
          {issue.workaroundPlan && (
            <p className="mt-0.5 text-muted-foreground">Workaround: {issue.workaroundPlan}</p>
          )}
          <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
            <span>{new Date(issue.createdAt).toLocaleString("en-AU")}</span>
            <span className="font-semibold uppercase">{sevLabel}</span>
            {issue.isVerbalWorkaround && (
              <span className="font-semibold text-amber-700">Verbal workaround — Hub close-out by manager</span>
            )}
            {isResolved && (
              <span className="font-semibold text-emerald-600">
                Resolved {issue.resolvedAt ? new Date(issue.resolvedAt).toLocaleString("en-AU") : ""}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RosterTable({ roster }: { roster: TripReport["roster"] }) {
  if (!roster.length) return <p className="text-sm text-muted-foreground">No bookings.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr className="border-b">
            <th className="pb-1 pr-4">Participant</th>
            <th className="pb-1 pr-4">Status</th>
            <th className="pb-1 pr-4">Outbound</th>
            <th className="pb-1 pr-4">Return</th>
            <th className="pb-1 pr-4 text-right">Amount paid</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {roster.map((r, idx) => (
            <tr key={idx} className={r.bookingStatus === "Cancelled" ? "opacity-50" : ""}>
              <td className="py-1.5 pr-4 font-medium">{r.participantName}</td>
              <td className="py-1.5 pr-4 text-muted-foreground">{r.bookingStatus}</td>
              <td className="py-1.5 pr-4">
                <TransportCell
                  actual={r.outboundTransportMode}
                  planned={r.plannedOutboundTransportMode}
                />
              </td>
              <td className="py-1.5 pr-4">
                <TransportCell
                  actual={r.returnTransportMode}
                  planned={r.plannedReturnTransportMode}
                />
              </td>
              <td className="py-1.5 text-right tabular-nums">
                ${(r.amountPaid ?? 0).toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TransportCell({ actual, planned }: { actual: string; planned: string }) {
  const changed = actual !== planned;
  return (
    <div className="flex flex-col gap-0.5">
      <EventTransportBadge mode={actual} />
      {changed && (
        <span className="text-[9px] text-muted-foreground line-through">
          Planned {planned === "self" ? "Self" : "Bus"}
        </span>
      )}
    </div>
  );
}

function FinanceCard({ label, value, tone, emphasis }: { label: string; value: string; tone?: "expense" | "positive" | "negative"; emphasis?: boolean }) {
  const textColor = tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-destructive" : tone === "expense" ? "text-warning" : "";
  return (
    <div className={`rounded-lg border p-3 ${emphasis ? "border-primary/30 bg-primary/5" : ""}`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${textColor}`}>{value}</div>
    </div>
  );
}
