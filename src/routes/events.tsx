import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Search, CalendarRange, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";
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

function EventsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<EventManifest | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [query, setQuery] = useState("");

  const { data: events = [], isLoading, error } = useEvents();
  const { data: types = [] } = useLookupParameters("event_types");
  const typeLabel = (code: string) => types.find((t) => t.code === code)?.displayName ?? code;

  const filtered = useMemo(() => {
    const n = query.trim().toLowerCase();
    if (!n) return events;
    return events.filter((e) =>
      [
        e.title,
        e.venue,
        typeLabel(e.eventTypeCode),
        formatDate(e.startDate),
        e.endDate ? formatDate(e.endDate) : "",
        e.ticketPrice.toFixed(2),
      ]
        .join(" ")
        .toLowerCase()
        .includes(n),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, query, types]);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight md:text-2xl">
            Event Management Dashboard
          </h2>
          <p className="text-sm text-muted-foreground">
            {isLoading ? "Loading manifest…" : `${events.length} events on the manifest.`}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Create New Event
        </Button>
      </header>

      <div className="relative w-full sm:max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title, venue, type, date, price…"
          className="h-9 pl-9"
        />
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
          {query ? `No events match "${query}".` : "No events yet — create the first one."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Event title</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Venue</th>
                <th className="px-4 py-2 font-medium">Dates</th>
                <th className="px-4 py-2 text-right font-medium">Ticket price</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-t border-border align-top">
                  <td className="px-4 py-2 font-semibold">{e.title}</td>
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
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateEventModal open={createOpen} onOpenChange={setCreateOpen} />
      <ManageEventModal event={selected} open={manageOpen} onOpenChange={setManageOpen} />
    </div>
  );
}
