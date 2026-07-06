import { useMemo, useState, useEffect } from "react";
import { AlertTriangle, CalendarDays, FileText, Map, Users, Wallet, Settings2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn, formatDate, todayLocalIso } from "@/lib/utils";
import { inferEventKind, listEventDaySessions } from "@/lib/api/event-outing";
import { useEvents, useLookupParameters } from "@/hooks/use-supabase-data";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type { EventManifest } from "@/lib/data-store";
import { LogAnomalyModal } from "@/components/site-day/log-anomaly-modal";
import { RosterTab } from "./roster-tab";
import { EventFinanceTab } from "./event-finance-tab";
import { EventDetailsTab } from "./event-details-tab";
import { ItineraryTab } from "./itinerary-tab";
import { DaySessionsTab } from "./day-sessions-tab";
import { EventStatusPanel } from "./event-status-panel";
import { TripReportTab } from "./trip-report-tab";

interface Props {
  /** Snapshot from list/calendar click — merged with live query cache while open. */
  event: EventManifest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type TabKey = "roster" | "finance" | "details" | "itinerary" | "days" | "report";

export function ManageEventModal({ event: eventSnapshot, open, onOpenChange }: Props) {
  const [tab, setTab] = useState<TabKey>("roster");
  const [incidentOpen, setIncidentOpen] = useState(false);
  const { data: events = [] } = useEvents();
  const { data: types = [] } = useLookupParameters("event_types");

  const event = useMemo(() => {
    if (!eventSnapshot) return null;
    return events.find((e) => e.id === eventSnapshot.id) ?? eventSnapshot;
  }, [events, eventSnapshot]);

  const scopeKind = event
    ? inferEventKind({
        startDate: event.startDate,
        endDate: event.endDate ?? event.startDate,
        eventTypeCode: event.eventTypeCode,
        eventTypeDisplayName:
          types.find((t) => t.code === event.eventTypeCode)?.displayName ?? event.eventTypeCode,
        primaryVenueId: event.primaryVenueId,
        storedEventKind: event.eventKind,
      })
    : "legacy";

  const isOuting = scopeKind !== "legacy";

  const { data: daySessions = [] } = useQuery({
    queryKey: ["event-day-sessions", event?.id ?? ""],
    queryFn: () => listEventDaySessions(event!.id),
    enabled: !!event && isOuting && open,
    staleTime: 30_000,
  });

  const incidentSession = useMemo(() => {
    if (!event || daySessions.length === 0) return null;
    const today = todayLocalIso();
    return (
      daySessions.find((s) => s.session_date === today) ??
      daySessions.find((s) => s.session_date === event.startDate) ??
      daySessions[0] ??
      null
    );
  }, [daySessions, event]);

  useEffect(() => {
    if (!open || !event) return;
    localStorage.setItem("yada.activeEventId", event.id);
    return () => {
      localStorage.removeItem("yada.activeEventId");
    };
  }, [open, event?.id]);

  const TABS: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }> = useMemo(() => [
    { key: "roster", label: "Roster", icon: Users },
    ...(isOuting ? [
      { key: "itinerary" as TabKey, label: "Itinerary", icon: Map },
      { key: "days" as TabKey, label: "Trip days", icon: CalendarDays },
      { key: "report" as TabKey, label: "Trip Report", icon: FileText },
    ] : []),
    { key: "finance", label: "Finance & P&L", icon: Wallet },
    { key: "details", label: "Details & Config", icon: Settings2 },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [isOuting]);

  if (!event) return null;
  const typeLabel = types.find((t) => t.code === event.eventTypeCode)?.displayName ?? event.eventTypeCode;
  const dateLabel =
    event.endDate && event.endDate !== event.startDate
      ? `${formatDate(event.startDate)} → ${formatDate(event.endDate)}`
      : formatDate(event.startDate);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden border-border bg-card p-0">
        <div className="border-b border-border bg-card px-6 pt-5 pb-3">
          <div className="flex items-start justify-between gap-3 pr-8">
            <DialogHeader className="min-w-0 flex-1 space-y-1 text-left">
              <DialogTitle className="text-xl">{event.title}</DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-primary/15 px-2 py-0.5 font-semibold uppercase tracking-wide text-primary">
                {typeLabel}
              </span>
              {isOuting && (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-semibold uppercase tracking-wide text-amber-600">
                  {scopeKind === "multi_day_tour" ? "Multi-day tour" : "Single-day outing"}
                </span>
              )}
              <span className="text-muted-foreground">{event.venue}</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-mono tabular-nums text-muted-foreground">{dateLabel}</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-semibold tabular-nums text-white">
                ${event.ticketPrice.toFixed(2)}
              </span>
            </DialogDescription>
            </DialogHeader>

            {isOuting && (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  if (!incidentSession) {
                    toast.message("Seed trip days first — open the Trip days tab.");
                    setTab("days");
                    return;
                  }
                  setIncidentOpen(true);
                }}
                className={cn(
                  "shrink-0 gap-1.5 rounded-full border-2 border-red-500/80 bg-red-600/90 px-3 py-2",
                  "text-[11px] font-bold uppercase tracking-wide text-white shadow-lg shadow-red-900/30",
                  "hover:bg-red-600 md:text-xs",
                )}
              >
                <AlertTriangle className="h-4 w-4" />
                Incident / Fault
              </Button>
            )}
          </div>

          {/* Status lifecycle panel */}
          <div className="mt-3">
            <EventStatusPanel
              event={event}
              onStatusChanged={() => {
                // ManageEventModal doesn't hold local event state —
                // the react-query cache bust in promoteEventStatus handles the refresh.
              }}
            />
          </div>

          {/* Horizontal scrollable tabs */}
          <div className="-mx-6 mt-4 overflow-x-auto px-6">
            <div className="flex min-w-max items-center gap-2 border-b border-border pb-0">
              {TABS.map((t) => {
                const active = tab === t.key;
                const Icon = t.icon;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-t-md px-4 py-2 text-sm font-semibold transition-colors",
                      active
                        ? "bg-tab-active text-tab-active-foreground"
                        : "bg-transparent text-muted-foreground hover:text-foreground",
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon className="h-4 w-4" />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="max-h-[65vh] overflow-y-auto px-6 py-5">
          {tab === "roster" ? (
            <RosterTab event={event} eventKind={scopeKind} />
          ) : tab === "itinerary" ? (
            <ItineraryTab event={event} />
          ) : tab === "days" ? (
            <DaySessionsTab event={event} />
          ) : tab === "report" ? (
            <TripReportTab event={event} />
          ) : tab === "finance" ? (
            <EventFinanceTab event={event} />
          ) : (
            <EventDetailsTab
              event={event}
              onSuccess={() => {
                setTab("days");
              }}
              onClose={() => onOpenChange(false)}
            />
          )}
        </div>

        {/* Footer for read-only tabs — Details tab renders its own [Close][Save] footer */}
        {tab !== "details" && (
          <DialogFooter className="border-t border-border px-6 py-3">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        )}
      </DialogContent>

      {isOuting && incidentSession && (
        <LogAnomalyModal
          open={incidentOpen}
          onOpenChange={setIncidentOpen}
          context={{
            kind: "event-day",
            eventId: event.id,
            eventDaySessionId: incidentSession.id,
          }}
        />
      )}
    </Dialog>
  );
}
