import React, { useMemo, useState, useEffect } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  FileText,
  Map,
  Users,
  Wallet,
  Settings2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn, formatDate, todayLocalIso } from "@/lib/utils";
import { inferEventKind, listEventDaySessions } from "@/lib/api/event-outing";
import { useEvents, useLookupParameters } from "@/hooks/use-supabase-data";
import { useIsMobile } from "@/hooks/use-mobile";
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
  event: EventManifest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type TabKey = "roster" | "finance" | "details" | "itinerary" | "days" | "report";

export function ManageEventModal({ event: eventSnapshot, open, onOpenChange }: Props) {
  const [tab, setTab] = useState<TabKey>("roster");
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [headerExpanded, setHeaderExpanded] = useState(false);
  const { data: events = [] } = useEvents();
  const { data: types = [] } = useLookupParameters("event_types");
  const isMobile = useIsMobile();

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

  // Collapse expanded header whenever the modal closes / reopens
  useEffect(() => {
    if (!open) setHeaderExpanded(false);
  }, [open]);

  const TABS: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }> = useMemo(() => [
    { key: "roster", label: "Roster", icon: Users },
    ...(isOuting ? [
      { key: "itinerary" as TabKey, label: "Itinerary", icon: Map },
      { key: "days" as TabKey, label: "Trip Days", icon: CalendarDays },
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

  // ── Shared sub-renders ──────────────────────────────────────────────────

  const incidentButton = isOuting ? (
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
        "hover:bg-red-600",
      )}
    >
      <AlertTriangle className="h-4 w-4" />
      Incident / Fault
    </Button>
  ) : null;

  /** Mobile compact header — title, current status chip, promote button, expand toggle. */
  const mobileHeader = (
    <div className="px-4 pt-4 pb-3">
      {/* Row 1: title + incident button */}
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-lg font-bold leading-tight">{event.title}</h2>
        {incidentButton}
      </div>

      {/* Row 2: current status chip + expand toggle */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <EventStatusPanel
          event={event}
          mobileCompact
          onStatusChanged={() => {}}
        />
        <button
          type="button"
          onClick={() => setHeaderExpanded((x) => !x)}
          className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground"
          aria-expanded={headerExpanded}
          aria-label={headerExpanded ? "Hide event details" : "Show event details"}
        >
          {headerExpanded ? (
            <>Less <ChevronUp className="h-3.5 w-3.5" /></>
          ) : (
            <>Details <ChevronDown className="h-3.5 w-3.5" /></>
          )}
        </button>
      </div>

      {/* Expandable metadata */}
      {headerExpanded && (
        <div className="mt-3 space-y-2 rounded-xl border border-border bg-muted/30 p-3 text-xs">
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full bg-primary/15 px-2 py-0.5 font-semibold uppercase tracking-wide text-primary">
              {typeLabel}
            </span>
            {isOuting && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-semibold uppercase tracking-wide text-amber-600">
                {scopeKind === "multi_day_tour" ? "Multi-day tour" : "Single-day outing"}
              </span>
            )}
          </div>
          <div className="text-muted-foreground">
            {event.venue && <span>{event.venue} · </span>}
            <span className="tabular-nums">{dateLabel}</span>
            <span className="ml-2 font-semibold text-foreground">${event.ticketPrice.toFixed(2)}</span>
          </div>
          {/* Full status ladder in expanded view */}
          <EventStatusPanel
            event={event}
            mobileCompact={false}
            onStatusChanged={() => {}}
          />
        </div>
      )}
    </div>
  );

  /** Desktop full header — unchanged from original. */
  const desktopHeader = (
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
        {incidentButton}
      </div>

      <div className="mt-3">
        <EventStatusPanel event={event} onStatusChanged={() => {}} />
      </div>

      {/* Horizontally scrollable tabs */}
      <div className="-mx-6 mt-4 overflow-x-auto px-6">
        <div className="flex min-w-max items-center gap-1 border-b border-border pb-0">
          {TABS.map((t) => {
            const active = tab === t.key;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "inline-flex min-h-11 touch-manipulation items-center gap-2 rounded-t-md px-4 py-2.5 text-sm font-semibold transition-colors",
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
  );

  /** Mobile icon grid tabs — all tabs discoverable, no hidden overflow. */
  const mobileTabGrid = (
    <div className={cn(
      "grid border-b border-border",
      TABS.length <= 3 ? "grid-cols-3" : "grid-cols-3",
    )}>
      {TABS.map((t, idx) => {
        const active = tab === t.key;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "flex min-h-14 touch-manipulation flex-col items-center justify-center gap-1 border-r border-border px-1 py-2 text-[11px] font-semibold transition-colors last:border-r-0",
              active
                ? "bg-tab-active text-tab-active-foreground"
                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
              // 6-tab grid: row 1 (idx 0–2) gets a bottom border to separate from row 2
              TABS.length > 3 && idx < 3 ? "border-b border-border" : "",
            )}
            aria-current={active ? "page" : undefined}
          >
            <Icon className={cn("h-5 w-5", active && "stroke-[2.5]")} />
            <span className="truncate px-0.5 leading-tight text-center">{t.label}</span>
          </button>
        );
      })}
    </div>
  );

  const tabContent = (
    <>
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
          onSuccess={() => setTab("days")}
          onClose={() => onOpenChange(false)}
        />
      )}
    </>
  );

  const closeButton = (
    <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
  );

  const anomalyModal = isOuting && incidentSession ? (
    <LogAnomalyModal
      open={incidentOpen}
      onOpenChange={setIncidentOpen}
      context={{
        kind: "event-day",
        eventId: event.id,
        eventDaySessionId: incidentSession.id,
      }}
    />
  ) : null;

  // ── Mobile: full-height bottom Sheet ──────────────────────────────────

  if (isMobile) {
    return (
      <>
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent
            side="bottom"
            className="flex h-[100dvh] flex-col rounded-t-2xl border-t border-border bg-card p-0 pb-[env(safe-area-inset-bottom)]"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>{event.title}</SheetTitle>
              <SheetDescription>Event management</SheetDescription>
            </SheetHeader>

            {/* Sticky header: compact info + tab grid */}
            <div className="shrink-0 border-b border-border bg-card">
              {mobileHeader}
              {mobileTabGrid}
            </div>

            {/* Scrollable tab content */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              {tabContent}
            </div>

            {/* Footer */}
            {tab !== "details" && (
              <div className="shrink-0 border-t border-border px-4 py-3">
                {closeButton}
              </div>
            )}
          </SheetContent>
        </Sheet>
        {anomalyModal}
      </>
    );
  }

  // ── Desktop: centred Dialog ────────────────────────────────────────────

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[95dvh] w-full max-w-5xl overflow-hidden border-border bg-card p-0 sm:max-h-[90vh]">
          {desktopHeader}
          <div className="max-h-[55dvh] overflow-y-auto px-6 py-5 sm:max-h-[65vh]">
            {tabContent}
          </div>
          {tab !== "details" && (
            <DialogFooter className="border-t border-border px-6 py-3">
              {closeButton}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      {anomalyModal}
    </>
  );
}
