import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Search, CalendarRange, ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { cn, formatDate, parseIsoDateLocal, toIsoDateString } from "@/lib/utils";
import { useEvents, useLookupParameters } from "@/hooks/use-supabase-data";
import type { EventManifest } from "@/lib/data-store";
import { CreateEventModal } from "@/components/events/create-event-modal";
import { ManageEventModal } from "@/components/events/manage-event-modal";

export const Route = createFileRoute("/events")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Events — Yada Connect" },
      {
        name: "description",
        content: "Event manifest, roster bookings, and per-event P&L for the Yada operations team.",
      },
    ],
  }),
  component: EventsPage,
});

const EVENT_STATUSES = ["Planning", "Confirmed", "Open", "Closed"] as const;
type EventStatus = (typeof EVENT_STATUSES)[number];

const DEFAULT_STATUS_FILTER = new Set<EventStatus>(["Planning", "Confirmed", "Open"]);

function kindLabel(k: string): string {
  return (
    {
      legacy: "Standard event",
      single_day_outing: "Single-day outing",
      multi_day_tour: "Multi-day tour",
    }[k] ?? k
  );
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "Planning":
      return "bg-blue-600 text-white";
    case "Confirmed":
      return "bg-indigo-600 text-white";
    case "Open":
      return "bg-emerald-600 text-white";
    case "Closed":
      return "bg-zinc-600 text-white";
    default:
      return "bg-slate-500 text-white";
  }
}

function eventOverlapsDateRange(
  e: EventManifest,
  fromIso: string,
  toIso: string,
): boolean {
  if (!fromIso && !toIso) return true;
  const start = e.startDate;
  const end = e.endDate ?? e.startDate;
  if (fromIso && end < fromIso) return false;
  if (toIso && start > toIso) return false;
  return true;
}

function eventSearchHaystack(e: EventManifest, typeLabel: string): string {
  return [
    e.title,
    e.venue,
    e.eventTypeCode,
    typeLabel,
    e.status,
    e.startDate,
    e.endDate ?? "",
    formatDate(e.startDate),
    e.endDate ? formatDate(e.endDate) : "",
    e.ticketPrice.toFixed(2),
    e.standardPrice.toFixed(2),
    e.description ?? "",
    e.reconciliationNotes ?? "",
    e.eventKind,
    kindLabel(e.eventKind),
    e.billingLocked ? "billing locked" : "",
    e.closedAt ? formatDate(e.closedAt) : "",
    e.id,
  ]
    .join(" ")
    .toLowerCase();
}

function EventsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<EventManifest | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<EventStatus>>(
    () => new Set(DEFAULT_STATUS_FILTER),
  );
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const { data: events = [], isLoading, error } = useEvents();
  const { data: types = [] } = useLookupParameters("event_types");
  const typeLabel = (code: string) => types.find((t) => t.code === code)?.displayName ?? code;

  const filtered = useMemo(() => {
    const n = query.trim().toLowerCase();
    return events
      .filter((e) => {
        const status = (e.status || "Planning") as EventStatus;
        if (!statusFilter.has(status)) return false;
        if (!eventOverlapsDateRange(e, dateFrom, dateTo)) return false;
        if (!n) return true;
        return eventSearchHaystack(e, typeLabel(e.eventTypeCode)).includes(n);
      })
      .sort((a, b) => {
        const byStart = a.startDate.localeCompare(b.startDate);
        if (byStart !== 0) return byStart;
        return a.title.localeCompare(b.title);
      });
  }, [events, query, statusFilter, dateFrom, dateTo, types]);

  const toggleStatus = (status: EventStatus) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const filtersActive =
    query.trim().length > 0 ||
    dateFrom.length > 0 ||
    dateTo.length > 0 ||
    statusFilter.size !== DEFAULT_STATUS_FILTER.size ||
    !EVENT_STATUSES.every((s) => statusFilter.has(s) === DEFAULT_STATUS_FILTER.has(s));

  const resetFilters = () => {
    setQuery("");
    setStatusFilter(new Set(DEFAULT_STATUS_FILTER));
    setDateFrom("");
    setDateTo("");
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight md:text-2xl">
            Event Management Dashboard
          </h2>
          <p className="text-sm text-muted-foreground">
            {isLoading
              ? "Loading manifest…"
              : `${filtered.length} of ${events.length} events shown`}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Create New Event
        </Button>
      </header>

      {/* Filters */}
      <div className="space-y-3 rounded-lg border border-border bg-card/40 p-4">
        <div className="relative w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, venue, type, status, dates, price, description…"
            className="h-9 pl-9"
          />
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Status
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {EVENT_STATUSES.map((s) => {
                const on = statusFilter.has(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleStatus(s)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide transition-opacity",
                      on ? statusBadgeClass(s) : "bg-muted text-muted-foreground opacity-60 hover:opacity-100",
                    )}
                    aria-pressed={on}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                From
              </Label>
              <DatePicker
                value={parseIsoDateLocal(dateFrom)}
                onChange={(d) => setDateFrom(d ? toIsoDateString(d) : "")}
                placeholder="Any date"
                className="h-9 w-[9.5rem]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                To
              </Label>
              <DatePicker
                value={parseIsoDateLocal(dateTo)}
                onChange={(d) => setDateTo(d ? toIsoDateString(d) : "")}
                placeholder="Any date"
                className="h-9 w-[9.5rem]"
              />
            </div>
          </div>

          {filtersActive && (
            <Button type="button" variant="ghost" size="sm" className="h-9 gap-1" onClick={resetFilters}>
              <X className="h-3.5 w-3.5" />
              Reset filters
            </Button>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Default: Planning, Confirmed, and Open — Closed hidden. Events overlap the date range when
          any day falls between From and To.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
          <div className="font-semibold">Could not load events.</div>
          <div className="mt-1 font-mono text-xs">{(error as Error).message}</div>
          <div className="mt-2 text-xs">
            If the table is missing, run{" "}
            <span className="font-mono">docs/sql/2026-06-17_event_management.sql</span> in the
            Supabase SQL editor.
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading events…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          <CalendarRange className="mx-auto mb-2 h-6 w-6" />
          {filtersActive
            ? "No events match the current filters."
            : "No events yet — create the first one."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Event title</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Venue</th>
                <th className="px-4 py-2 font-medium">Dates</th>
                <th className="px-4 py-2 text-right font-medium">Ticket price</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const status = e.status || "Planning";
                return (
                  <tr key={e.id} className="border-t border-border align-top">
                    <td className="px-4 py-2 font-semibold">{e.title}</td>
                    <td className="px-4 py-2">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                          statusBadgeClass(status),
                        )}
                      >
                        {status}
                      </span>
                      {e.billingLocked && (
                        <span className="ml-1 text-[10px] text-muted-foreground">· locked</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                        {typeLabel(e.eventTypeCode)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{e.venue}</td>
                    <td className="whitespace-nowrap px-4 py-2 font-mono tabular-nums">
                      {e.endDate && e.endDate !== e.startDate
                        ? `${formatDate(e.startDate)} → ${formatDate(e.endDate)}`
                        : formatDate(e.startDate)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right font-semibold tabular-nums text-white">
                      ${e.ticketPrice.toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        onClick={() => {
                          setSelected(e);
                          setManageOpen(true);
                        }}
                      >
                        Manage Event
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <CreateEventModal open={createOpen} onOpenChange={setCreateOpen} />
      <ManageEventModal event={selected} open={manageOpen} onOpenChange={setManageOpen} />
    </div>
  );
}
