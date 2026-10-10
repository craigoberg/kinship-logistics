import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn, formatDate } from "@/lib/utils";
import {
  CENTRE_HOURS_QUERY_KEY,
  listCentreHours,
  dayCodeFromSydneyIndex,
  isKnownDayCode,
  type CentreHourRow,
  type DayCode,
} from "@/lib/api/centre-hours";
import { LOOKUP_CATEGORIES, listEvents, type EventManifest } from "@/lib/data-store";
import { useLookupParameters } from "@/hooks/use-supabase-data";
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
] as const;

function fmtRange(d: Date): string {
  return formatDate(d.toISOString().slice(0, 10));
}

function fmtTime(t: string): string {
  // "HH:MM" stored clock string → display as-is (already 24h)
  return t.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CalCell {
  date: Date;
  iso: string;
  isToday: boolean;
  isPast: boolean;
  /** From Lookups → Operating days — this weekday is a scheduled operating day. */
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

// ---------------------------------------------------------------------------
// Solid-fill chip colour tokens  (Style A — Google Calendar convention)
// White text on fully-opaque coloured bar; past days handled via cell opacity.
// ---------------------------------------------------------------------------

// Centre chip variants
const CENTRE_LIVE_CLS   = "bg-emerald-500 text-white hover:bg-emerald-600";
const CENTRE_FUTURE_CLS = "bg-indigo-500  text-white hover:bg-indigo-600";
const CENTRE_PAST_CLS   = "bg-slate-500   text-white/80";

// Event chip variants — distinct hue family from Centre
const EVENT_STATUS_CLS: Record<string, string> = {
  Planning:  "bg-amber-500  text-white hover:bg-amber-600",
  Confirmed: "bg-sky-500    text-white hover:bg-sky-600",
  Open:      "bg-teal-500   text-white hover:bg-teal-600",
};

// ---------------------------------------------------------------------------
// Grid builder — 5-week rolling window anchored to today
// ---------------------------------------------------------------------------

function buildRollingGrid(
  today: Date,
  centreMap: Map<DayCode, CentreHourRow>,
  operatingCodes: Set<string>,
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
        isCentreScheduled: operatingCodes.has(dayCode),
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

// Shared pill style — solid fill, white text, rounded bar
const PILL     = "block w-full truncate rounded px-1.5 text-[8px] leading-[15px] font-semibold text-left transition-colors";
const PILL_BTN = PILL + " cursor-pointer";

function centreCls(cell: CalCell): string {
  if (cell.isLiveOpen) return CENTRE_LIVE_CLS;
  if (!cell.isPast)    return CENTRE_FUTURE_CLS;
  return CENTRE_PAST_CLS;
}

function centreLabel(cell: CalCell): string {
  if (cell.isLiveOpen) return "● Live";
  if (!cell.isPast)    return "Centre";
  return "Centre ✓";
}

function DayCell({ cell, onEventClick }: DayCellProps) {
  const hours = cell.centreHours
    ? `${fmtTime(cell.centreHours.openTime)}–${fmtTime(cell.centreHours.closeTime)}`
    : null;

  return (
    // date row (18px) + up to 2 chip rows (15px each) + gaps + padding ≈ 64px
    <div
      className={cn(
        "relative h-[64px] overflow-hidden border-r border-b border-border/30 p-1",
        cell.isPast && !cell.isToday && "opacity-50",
      )}
    >
      {/* Row 1: date number + Centre chip */}
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

        {cell.isCentreScheduled && (
          <button
            type="button"
            className={cn(PILL_BTN, "min-w-0 flex-1", centreCls(cell))}
            title={
              cell.isLiveOpen
                ? `Centre is open${hours ? ` · ${hours}` : ""}`
                : !cell.isPast
                ? `Centre scheduled${hours ? ` · ${hours}` : ""} — not yet open`
                : "Centre closed for the day"
            }
          >
            {centreLabel(cell)}
            {cell.isLiveOpen && hours && (
              <span className="ml-1 opacity-80 font-normal">{hours}</span>
            )}
          </button>
        )}
      </div>

      {/* Rows 2–3: event chips */}
      <div className="mt-0.5 space-y-px">
        {cell.events.slice(0, 2).map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => onEventClick(e)}
            className={cn(
              PILL_BTN,
              EVENT_STATUS_CLS[e.status] ??
                "bg-slate-500 text-white hover:bg-slate-600",
            )}
            title={`${e.title} · ${e.status}`}
          >
            {e.title}
          </button>
        ))}
        {cell.events.length > 2 && (
          <span className="block pl-1 text-[8px] leading-[14px] text-muted-foreground">
            +{cell.events.length - 2} more
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

  const { data: operatingDays = [] } = useLookupParameters(LOOKUP_CATEGORIES.operatingDay);
  const centreHoursQ = useQuery({
    queryKey: CENTRE_HOURS_QUERY_KEY,
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

  const operatingCodes = useMemo(() => {
    const s = new Set<string>();
    for (const d of operatingDays) {
      const code = d.code.trim().toUpperCase();
      if (isKnownDayCode(code)) s.add(code);
    }
    return s;
  }, [operatingDays]);

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
    () => buildRollingGrid(today, centreMap, operatingCodes, activeEvents, liveOpenDate),
    [today, centreMap, operatingCodes, activeEvents, liveOpenDate],
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
            {fmtRange(rangeStart)} – {fmtRange(rangeEnd)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-semibold", CENTRE_LIVE_CLS)}>● Live</span>
            <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-semibold", CENTRE_FUTURE_CLS)}>Centre</span>
            <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-semibold", EVENT_STATUS_CLS.Open)}>Event open</span>
            <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-semibold", EVENT_STATUS_CLS.Confirmed)}>Confirmed</span>
            <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-semibold", EVENT_STATUS_CLS.Planning)}>Planning</span>
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
