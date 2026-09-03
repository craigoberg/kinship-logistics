/**
 * Day Centre End of Day Report — who came in, meals, checkout, issues.
 * Calendar defaults to operational (SIM) today; historical days are read-only.
 */
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  LogIn,
  LogOut,
  Printer,
  RefreshCw,
  UserPlus,
  UtensilsCrossed,
} from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import { Button } from "@/components/ui/button";
import { ClientTime } from "@/components/ui/client-time";
import {
  buildDayCentreEndOfDayReport,
  SESSION_PHASE_LABELS,
  type DayCentreEndOfDayReport,
  type EndOfDayAttendanceRow,
  type EndOfDayMealBlock,
} from "@/lib/api/site-day-end-of-day-report";
import { useOperationalTodayIso } from "@/lib/operational-clock";
import {
  parseIsoDateLocal,
  toIsoDateString,
  formatDateWithWeekday,
  REGIONAL_DATE_WITH_WEEKDAY_FORMAT,
  cn,
} from "@/lib/utils";
import { RYGE_SEVERITY_CHIPS } from "@/lib/ui/ryge-severity-chips";
import type { SiteIssue } from "@/lib/api/site-issues";
import { useAuthReady } from "@/hooks/use-auth-ready";
import { getActiveUserProfile } from "@/lib/data-store";

const reportKey = (date: string) => ["day-centre-end-of-day-report", date] as const;

const RYGE_MAP = new Map(RYGE_SEVERITY_CHIPS.map((c) => [c.value, c]));

const TIME_OPTS = { hour: "2-digit" as const, minute: "2-digit" as const };

export function DayCentreEndOfDayReport() {
  const operationalToday = useOperationalTodayIso();
  const { user, isReady } = useAuthReady();
  const isSignedIn = !!user || !!getActiveUserProfile();
  /** Null = follow operational (SIM) today. A picked date is kept unless it is in the future. */
  const [pickedIso, setPickedIso] = useState<string | null>(null);
  const selectedIso =
    pickedIso && pickedIso <= operationalToday ? pickedIso : operationalToday;

  const q = useQuery({
    queryKey: reportKey(selectedIso),
    queryFn: () => buildDayCentreEndOfDayReport(selectedIso),
    enabled: isReady && isSignedIn,
    staleTime: 15_000,
  });

  const isToday = selectedIso === operationalToday;
  const todayDate = parseIsoDateLocal(operationalToday);
  const startMonth = new Date((todayDate?.getFullYear() ?? 2025) - 1, 0);
  const endMonth = todayDate;

  if (isReady && !isSignedIn) return null;

  return (
    <section id="day-centre-end-of-day-report" className="space-y-4">
      <style>{`
        @media print {
          [data-eod-report-actions] { display: none !important; }
          [data-eod-report-section] { page-break-inside: avoid; }
          * { box-shadow: none !important; }
        }
      `}</style>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <ClipboardList className="h-5 w-5 text-primary" />
            End of Day Report
          </h2>
          <p className="text-xs text-muted-foreground">
            {isToday
              ? "Live snapshot for today (SIM calendar). Refresh after floor taps."
              : `Historical day · ${formatDateWithWeekday(selectedIso)}`}
          </p>
        </div>
        <div
          className="flex flex-wrap items-end gap-2 print:hidden"
          data-eod-report-actions
        >
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Day
            </label>
            <DatePicker
              value={parseIsoDateLocal(selectedIso)}
              onChange={(d) => {
                if (!d) return;
                const next = toIsoDateString(d);
                if (next > operationalToday) return;
                setPickedIso(next === operationalToday ? null : next);
              }}
              dateFormat={REGIONAL_DATE_WITH_WEEKDAY_FORMAT}
              captionLayout="dropdown"
              startMonth={startMonth}
              endMonth={endMonth}
              defaultMonth={parseIsoDateLocal(selectedIso)}
              disabledDates={(d) => toIsoDateString(d) > operationalToday}
              className="h-11 w-[16.5rem] text-sm"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={isToday}
            onClick={() => setPickedIso(null)}
          >
            Today
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => void q.refetch()}
            disabled={q.isFetching}
          >
            {q.isFetching ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => window.print()}
          >
            <Printer className="mr-1.5 h-3.5 w-3.5" />
            Print
          </Button>
        </div>
      </div>

      {q.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading report…
        </div>
      ) : q.isError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {(q.error as Error).message || "Could not load the End of Day Report."}
        </div>
      ) : q.data ? (
        <ReportBody report={q.data} isToday={isToday} />
      ) : null}
    </section>
  );
}

function ReportBody({
  report,
  isToday,
}: {
  report: DayCentreEndOfDayReport;
  isToday: boolean;
}) {
  if (!report.session) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
        No Day Centre session was recorded on {formatDateWithWeekday(report.sessionDate)}.
      </div>
    );
  }

  const phase = report.session.phase;
  const inProgress = phase === "active_day" || phase === "open_pending";

  return (
    <div className="space-y-4">
      {inProgress && isToday ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-950 dark:text-amber-100">
          Day still in progress — this is a live snapshot, not a closed-day
          record.
        </p>
      ) : null}

      <Section icon={<ClipboardList className="h-4 w-4" />} title="Session">
        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          <Field label="Date">{formatDateWithWeekday(report.sessionDate)}</Field>
          <Field label="Status">
            <PhaseBadge phase={phase} />
          </Field>
          <Field label="Opened">
            {report.session.openDeclaredAt ? (
              <>
                <ClientTime iso={report.session.openDeclaredAt} options={TIME_OPTS} />
                {report.openedByName ? ` · ${report.openedByName}` : ""}
              </>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Closed">
            {report.session.closeDeclaredAt ? (
              <>
                <ClientTime iso={report.session.closeDeclaredAt} options={TIME_OPTS} />
                {report.closedByName ? ` · ${report.closedByName}` : ""}
              </>
            ) : (
              "—"
            )}
          </Field>
        </div>
        {report.session.closeLeaderNotes ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Close notes: “{report.session.closeLeaderNotes}”
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <StatPill label="Expected" value={report.counts.expected} />
          <StatPill label="Came in" value={report.counts.arrived} tone="success" />
          <StatPill label="Absent" value={report.counts.absent} />
          <StatPill label="Went home" value={report.counts.checkedOut} tone="success" />
          {report.counts.stillOnSite > 0 ? (
            <StatPill label="Still on site" value={report.counts.stillOnSite} tone="warn" />
          ) : null}
          {report.counts.stillExpected > 0 ? (
            <StatPill label="Not yet arrived" value={report.counts.stillExpected} tone="warn" />
          ) : null}
          {report.counts.issuesRed > 0 ? (
            <StatPill label="RED" value={report.counts.issuesRed} tone="danger" />
          ) : null}
          {report.counts.issuesYellow > 0 ? (
            <StatPill label="YELLOW" value={report.counts.issuesYellow} tone="warn" />
          ) : null}
        </div>
      </Section>

      <Section
        icon={<LogIn className="h-4 w-4" />}
        title={`Who came in (${report.arrived.length})`}
      >
        {report.arrived.length === 0 ? (
          <Empty>Nobody checked in on this day.</Empty>
        ) : (
          <PersonList
            rows={report.arrived}
            howKey="arrivalHow"
            timeKey="checkedInAt"
            howLabel="How"
          />
        )}
        {report.absent.length > 0 ? (
          <div className="mt-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Absent ({report.absent.length})
            </h4>
            <PersonList rows={report.absent} howKey="arrivalHow" timeKey="checkedInAt" howLabel="Planned" />
          </div>
        ) : null}
        {report.stillExpected.length > 0 ? (
          <div className="mt-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Not yet arrived ({report.stillExpected.length})
            </h4>
            <PersonList
              rows={report.stillExpected}
              howKey="arrivalHow"
              timeKey="checkedInAt"
              howLabel="Planned"
            />
          </div>
        ) : null}
      </Section>

      <Section icon={<UtensilsCrossed className="h-4 w-4" />} title="Meals">
        {report.meals.length === 0 ? (
          <Empty>No meals recorded this day.</Empty>
        ) : (
          <div className="space-y-5">
            {report.meals.map((meal) => (
              <MealBlock key={meal.activityId} meal={meal} />
            ))}
          </div>
        )}
      </Section>

      <Section
        icon={<LogOut className="h-4 w-4" />}
        title={`Went home (${report.checkedOut.length})`}
      >
        {report.checkedOut.length === 0 ? (
          <Empty>Nobody has checked out yet.</Empty>
        ) : (
          <PersonList
            rows={report.checkedOut}
            howKey="departureHow"
            timeKey="checkedOutAt"
            howLabel="How"
          />
        )}
        {report.stillOnSite.length > 0 ? (
          <div className="mt-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
              Still on site ({report.stillOnSite.length})
            </h4>
            <PersonList
              rows={report.stillOnSite}
              howKey="arrivalHow"
              timeKey="checkedInAt"
              howLabel="Arrived"
            />
          </div>
        ) : null}
      </Section>

      {report.support.length > 0 ? (
        <Section
          icon={<UserPlus className="h-4 w-4" />}
          title={`Support present (${report.counts.supportPresent})`}
        >
          <div className="divide-y rounded-lg border">
            {report.support.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium">{s.displayName}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {s.roleLabel} · {s.arrivalHow}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {s.checkedInAt ? (
                    <>
                      In <ClientTime iso={s.checkedInAt} options={TIME_OPTS} />
                    </>
                  ) : (
                    s.status
                  )}
                  {s.checkedOutAt ? (
                    <>
                      {" · "}Left <ClientTime iso={s.checkedOutAt} options={TIME_OPTS} />
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {report.visitors.length > 0 ? (
        <Section
          icon={<UserPlus className="h-4 w-4" />}
          title={`Visitors (${report.visitors.length})`}
        >
          <div className="divide-y rounded-lg border">
            {report.visitors.map((v) => (
              <div
                key={v.id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium">{v.displayName}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{v.kindLabel}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  In <ClientTime iso={v.arrivedAt} options={TIME_OPTS} />
                  {v.leftAt ? (
                    <>
                      {" · "}Left <ClientTime iso={v.leftAt} options={TIME_OPTS} />
                    </>
                  ) : (
                    " · still present"
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <Section
        icon={<AlertTriangle className="h-4 w-4" />}
        title={`Issues (${report.issues.length})`}
      >
        {report.issues.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            No Day Centre issues raised this day.
          </div>
        ) : (
          <div className="space-y-2">
            {report.issues.map((issue) => (
              <IssueRow key={issue.id} issue={issue} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function MealBlock({ meal }: { meal: EndOfDayMealBlock }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h4 className="text-sm font-semibold">{meal.slotLabel}</h4>
        {meal.sourceLabel ? (
          <span className="text-xs text-muted-foreground">{meal.sourceLabel}</span>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {meal.phase === "completed"
            ? "Completed"
            : meal.phase === "active"
              ? "Open"
              : "Not opened"}
          {meal.openedAt ? (
            <>
              {" · "}Opened <ClientTime iso={meal.openedAt} options={TIME_OPTS} />
            </>
          ) : null}
          {meal.closedAt ? (
            <>
              {" · "}Done <ClientTime iso={meal.closedAt} options={TIME_OPTS} />
            </>
          ) : null}
        </span>
      </div>
      {meal.menuNotes ? (
        <p className="mb-2 text-xs text-muted-foreground">Menu: {meal.menuNotes}</p>
      ) : null}
      {meal.variations.length === 0 ? (
        <Empty>No serve roll recorded yet.</Empty>
      ) : (
        <div className="space-y-3">
          {meal.variations.map((v) => (
            <div key={v.status}>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {v.label} ({v.count})
              </div>
              <div className="divide-y rounded-lg border">
                {v.people.map((p) => (
                  <div
                    key={p.participantId}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.updatedAt && p.status !== "expected" ? (
                        <ClientTime iso={p.updatedAt} options={TIME_OPTS} />
                      ) : null}
                      {p.notes ? ` · ${p.notes}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PersonList({
  rows,
  howKey,
  timeKey,
  howLabel,
}: {
  rows: EndOfDayAttendanceRow[];
  howKey: "arrivalHow" | "departureHow";
  timeKey: "checkedInAt" | "checkedOutAt";
  howLabel: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="hidden grid-cols-[1fr_8rem_4.5rem] gap-2 border-b bg-muted/30 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
        <span>Name</span>
        <span>{howLabel}</span>
        <span>When</span>
      </div>
      <div className="divide-y">
        {rows.map((r) => {
          const how = r[howKey] ?? "—";
          const when = r[timeKey];
          return (
            <div
              key={r.participantId}
              className="grid grid-cols-1 gap-0.5 px-3 py-2 text-sm sm:grid-cols-[1fr_8rem_4.5rem] sm:items-baseline sm:gap-2"
            >
              <span className="font-medium">{r.name}</span>
              <span className="text-xs text-muted-foreground sm:text-sm">{how}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {when ? <ClientTime iso={when} options={TIME_OPTS} /> : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IssueRow({ issue }: { issue: SiteIssue }) {
  const chip = RYGE_MAP.get(issue.severity);
  const isResolved = issue.status === "resolved";
  return (
    <div
      className={cn(
        "rounded-lg border p-3 text-sm",
        issue.severity === "red" && "border-red-600/40",
        issue.severity === "yellow" && "border-yellow-500/40",
        isResolved && "opacity-80",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
            chip?.activeClass ?? "bg-slate-600 text-white",
          )}
        >
          {issue.severity}
        </span>
        <span className="text-[11px] capitalize text-muted-foreground">
          {issue.status.replaceAll("_", " ")}
        </span>
        <ClientTime
          iso={issue.occurredAt}
          options={TIME_OPTS}
          className="ml-auto text-[11px] text-muted-foreground"
        />
      </div>
      <p className="mt-1.5 font-medium leading-snug">{issue.issueDescription}</p>
      {issue.workaroundPlan ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Workaround: {issue.workaroundPlan}
        </p>
      ) : null}
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card" data-eod-report-section>
      <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2.5">
        <span className="text-primary">{icon}</span>
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function PhaseBadge({ phase }: { phase: string }) {
  const label =
    SESSION_PHASE_LABELS[phase as keyof typeof SESSION_PHASE_LABELS] ?? phase;
  const cls =
    phase === "closed_orderly"
      ? "bg-emerald-600 text-white"
      : phase === "closed_no_go"
        ? "bg-destructive text-destructive-foreground"
        : phase === "active_day"
          ? "bg-info text-info-foreground"
          : "bg-secondary text-secondary-foreground";
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide", cls)}>
      {label}
    </span>
  );
}

function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "warn" | "danger";
}) {
  const cls =
    tone === "success"
      ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
      : tone === "warn"
        ? "bg-amber-500/10 text-amber-900 dark:text-amber-200"
        : tone === "danger"
          ? "bg-destructive/10 text-destructive"
          : "bg-muted text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-semibold", cls)}>
      {label} {value}
    </span>
  );
}
