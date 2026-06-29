import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  listCentreHours,
  dayCodeFromSydneyIndex,
  type CentreHourRow,
  type DayCode,
} from "@/lib/api/centre-hours";
import { listEvents, type EventManifest } from "@/lib/data-store";
import { ManageEventModal } from "@/components/events/manage-event-modal";
import { useSiteSession } from "@/hooks/use-site-session";

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function localToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** Returns the Monday of the week containing `date`. */
function mondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d;
}

const SHORT_MONTH = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function fmtRange(d: Date): string {
  return `${d.getDate()} ${SHORT_MONTH[d.getMonth()]}`;
}

function fmtTime(t: string): string {
  // "HH:MM" → "9am" / "3pm"
  const [hStr, mStr] = t.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${mStr}${ampm}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CalCell {
  date: Date;
  iso: string;
  isToday: boolean;
  isPast: boolean;
  /** From centre_operating_hours — this day-of-week is a scheduled operating day. */
  isCentreScheduled: boolean;
  centreHours: CentreHourRow | undefined;
  /** True only when the site_day_session for this date has phase === 'active_day'. */
  isLiveOpen: boolean;
  /** Mon–Fri */
  isWeekday: boolean;
  events: EventManifest[];
  isFirstOfMonth: boolean;
}

type CalRow = CalCell[];

const ROW_LABELS = ["Last", "This", "", "", ""];

// Status-based button colour for event chips
const EVENT_STATUS_CLS: Record<string, string> = {
  Planning:
    "bg-amber-400/20 text-amber-800 dark:text-amber-300 border border-amber-400/40 hover:bg-amber-400/30",
  Confirmed:
    "bg-blue-500/20 text-blue-800 dark:text-blue-300 border border-blue-400/40 hover:bg-blue-500/30",
  Open:
    "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-400/40 hover:bg-emerald-500/30",
};

// Centre button — green when open, blue when closed (weekdays only)
const CENTRE_OPEN_CLS =
  "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-400/40 hover:bg-emerald-500/30";
const CENTRE_CLOSED_CLS =
  "bg-blue-500/20 text-blue-800 dark:text-blue-300 border border-blue-400/40 hover:bg-blue-500/30";

// ---------------------------------------------------------------------------
// Grid builder — 5-week rolling window anchored to today
// ---------------------------------------------------------------------------

function buildRollingGrid(
  today: Date,
  centreMap: Map<DayCode, CentreHourRow>,
  events: EventManifest[],
  /** ISO date of the day whose session is currently active_day, or null. */
  liveOpenDate: string | null,
): CalRow[] {
  const todayIso = toIso(today);
  const gridStart = addDays(mondayOf(today), -7); // last Monday
  const rows: CalRow[] = [];
  let current = new Date(gridStart);

  for (let row = 0; row < 5; row++) {
    const week: CalCell[] = [];
    for (let col = 0; col < 7; col++) {
      const iso = toIso(current);
      const dayCode = dayCodeFromSydneyIndex(current.getDay());
      const centreHours = centreMap.get(dayCode);
      const dow = current.getDay(); // 0=Sun
      const isWeekday = dow >= 1 && dow <= 5;
      const dayEvents = events.filter((e) => {
        const end = e.endDate ?? e.startDate;
        return e.startDate <= iso && end >= iso;
      });
      week.push({
        date: new Date(current),
        iso,
        isToday: iso === todayIso,
        isPast: current < today,
        isCentreScheduled: centreHours !== undefined,
        centreHours,
        isLiveOpen: liveOpenDate === iso,
        isWeekday,
        events: dayEvents,
        isFirstOfMonth: current.getDate() === 1,
      });
      current = addDays(current, 1);
    }
    rows.push(week);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Day cell
// ---------------------------------------------------------------------------

interface DayCellProps {
  cell: CalCell;
  onEventClick: (e: EventManifest) => void;
}

// Shared pill button style
const PILL = "truncate rounded px-1 text-[8px] leading-[13px] font-semibold text-left transition-colors cursor-pointer";

function DayCell({ cell, onEventClick }: DayCellProps) {
  return (
    // height: date row (18px) + up to 2 event rows (13px each) + gaps + padding = ~58px
    <div
      className={cn(
        "relative h-[58px] overflow-hidden border-r border-b border-border/30 p-1",
        cell.isPast && !cell.isToday && "opacity-55",
      )}
    >
      {/* Row 1: date number + Centre button side-by-side */}
      <div className="flex items-center gap-1">
        <span
          className={cn(
            "inline-flex h-[16px] min-w-[16px] shrink-0 items-center justify-center rounded-full px-0.5 text-[10px] font-semibold tabular-nums",
            cell.isToday
              ? "bg-primary text-primary-foreground"
              : cell.isPast
              ? "text-muted-foreground"
              : "text-foreground",
          )}
        >
          {cell.isFirstOfMonth
            ? `1 ${SHORT_MONTH[cell.date.getMonth()]}`
            : cell.date.getDate()}
        </span>

        {cell.isWeekday && (
          <button
            type="button"
            className={cn(PILL, "min-w-0 flex-1", cell.isLiveOpen ? CENTRE_OPEN_CLS : CENTRE_CLOSED_CLS)}
            title={
              cell.isLiveOpen
                ? `Centre is open${cell.centreHours ? ` · ${fmtTime(cell.centreHours.openTime)}–${fmtTime(cell.centreHours.closeTime)}` : ""}`
                : cell.isCentreScheduled
                ? "Centre scheduled — not yet opened"
                : "Centre closed"
            }
          >
            Centre
            {cell.isLiveOpen && cell.centreHours && (
              <span className="ml-0.5 opacity-70">
                {fmtTime(cell.centreHours.openTime)}–{fmtTime(cell.centreHours.closeTime)}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Rows 2–3: event buttons */}
      <div className="mt-0.5 space-y-px">
        {cell.events.slice(0, 2).map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => onEventClick(e)}
            className={cn(
              PILL, "w-full",
              EVENT_STATUS_CLS[e.status] ??
                "bg-muted text-foreground border border-border hover:bg-accent",
            )}
            title={`${e.title} (${e.status})`}
          >
            {e.title}
          </button>
        ))}
        {cell.events.length > 2 && (
          <span className="block pl-0.5 text-[8px] leading-[13px] text-muted-foreground">
            +{cell.events.length - 2}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exported component — no outer Card (embedded inside OperationsExceptionHub)
// ---------------------------------------------------------------------------

export function WallCalendar() {
  const today = useMemo(() => localToday(), []);

  const [selectedEvent, setSelectedEvent] = useState<EventManifest | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const centreHoursQ = useQuery({
    queryKey: ["centre-hours"],
    queryFn: listCentreHours,
    staleTime: 300_000,
  });

  const eventsQ = useQuery({
    queryKey: ["events"],
    queryFn: listEvents,
    staleTime: 60_000,
  });

  const sessionQ = useSiteSession();

  // Map DayCode → CentreHourRow for O(1) lookup
  const centreMap = useMemo<Map<DayCode, CentreHourRow>>(() => {
    const m = new Map<DayCode, CentreHourRow>();
    for (const r of centreHoursQ.data ?? []) m.set(r.dayOfWeek, r);
    return m;
  }, [centreHoursQ.data]);

  // Include ALL non-Closed events (Planning, Confirmed, Open) so nothing is missed
  const activeEvents = useMemo<EventManifest[]>(
    () => (eventsQ.data ?? []).filter((e) => e.status !== "Closed"),
    [eventsQ.data],
  );

  // GREEN only when the day centre session is currently active_day
  const liveOpenDate = useMemo<string | null>(() => {
    const s = sessionQ.data;
    return s?.phase === "active_day" ? s.sessionDate : null;
  }, [sessionQ.data]);

  const weeks = useMemo(
    () => buildRollingGrid(today, centreMap, activeEvents, liveOpenDate),
    [today, centreMap, activeEvents, liveOpenDate],
  );

  const handleEventClick = (e: EventManifest) => {
    setSelectedEvent(e);
    setModalOpen(true);
  };

  const rangeStart = weeks[0][0].date;
  const rangeEnd = weeks[4][6].date;

  return (
    <>
      <div className="overflow-hidden rounded-md border border-border">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-1.5">
          <span className="text-xs font-semibold">
            {fmtRange(rangeStart)} – {fmtRange(rangeEnd)}{" "}
            {rangeEnd.getFullYear()}
          </span>
          <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-semibold", CENTRE_OPEN_CLS)}>
              Centre live
            </span>
            <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-semibold", CENTRE_CLOSED_CLS)}>
              Centre closed
            </span>
            <span className="rounded border border-amber-400/40 bg-amber-400/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800 dark:text-amber-300">
              Event
            </span>
          </span>
        </div>

        {/* Column headers — 8 cols: row-label + 7 days */}
        <div
          className="grid border-b border-border bg-muted/20"
          style={{ gridTemplateColumns: "28px repeat(7, 1fr)" }}
        >
          <div /> {/* spacer */}
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div
              key={d}
              className="py-1 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Calendar rows */}
        <div style={{ borderLeft: "1px solid hsl(var(--border) / 0.3)" }}>
          {weeks.map((week, ri) => (
            <div
              key={week[0].iso}
              className="grid"
              style={{ gridTemplateColumns: "28px repeat(7, 1fr)" }}
            >
              {/* Row label */}
              <div
                className={cn(
                  "flex items-start justify-center pt-1.5 text-[9px] font-bold uppercase tracking-wide border-r border-b border-border/30",
                  ri === 0 && "text-muted-foreground/60",
                  ri === 1 && "text-primary",
                  ri > 1 && "text-transparent",
                )}
              >
                {ROW_LABELS[ri]}
              </div>

              {/* Day cells */}
              {week.map((cell) => (
                <DayCell key={cell.iso} cell={cell} onEventClick={handleEventClick} />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Event management modal */}
      <ManageEventModal
        event={selectedEvent}
        open={modalOpen}
        onOpenChange={setModalOpen}
      />
    </>
  );
}
