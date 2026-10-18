/**
 * EventDeliverStatusPanel — group journey status banner (GUARDRAILS §12.13.8)
 */
import { useMemo } from "react";
import { useQuery, type QueryKey } from "@tanstack/react-query";
import {
  Bus,
  CheckCircle2,
  Circle,
  Loader2,
  MapPin,
  Moon,
  Pill,
  Sunrise,
  Users,
  Utensils,
} from "lucide-react";
import { ClientTime } from "@/components/ui/client-time";
import { cn } from "@/lib/utils";
import {
  eventDeliverStatusKey,
  fetchEventDeliverGroupStatus,
  plannedDayStatusSteps,
  type EventDeliverStatusStep,
  type StatusStamp,
} from "@/lib/api/event-deliver-status";
import { listEventVenueStops } from "@/lib/api/event-outing";
import { resolveVenueStops } from "@/lib/deliver-offline/outbox";
import { useRealtimeInvalidateMany } from "@/hooks/use-realtime-invalidate";

const GROUP_STATUS_TABLES = [
  "event_attendance_log",
  "event_venue_stops",
  "event_bus_manifest",
  "transport_trips",
  "trip_legs",
  "event_day_sessions",
  "event_morning_log",
  "event_curfew_log",
  "asset_daily_clearance",
] as const;

interface Props {
  eventId: string;
  sessionId: string;
  sessionDate: string;
  /** Also invalidate these keys when group-status tables change (e.g. office Live). */
  extraQueryKeys?: QueryKey[];
}

const TONE_HEADLINE: Record<string, string> = {
  planning: "border-muted bg-muted/30",
  arrival: "border-amber-500/40 bg-amber-500/10",
  roll: "border-violet-500/40 bg-violet-500/10",
  transit: "border-blue-500/40 bg-blue-500/10",
  activity: "border-emerald-500/40 bg-emerald-500/10",
  base: "border-indigo-500/40 bg-indigo-500/10",
  closed: "border-zinc-500/40 bg-zinc-500/10",
};

export function EventDeliverStatusPanel({
  eventId,
  sessionId,
  sessionDate,
  extraQueryKeys = [],
}: Props) {
  useRealtimeInvalidateMany({
    tables: GROUP_STATUS_TABLES,
    queryKeys: [eventDeliverStatusKey(sessionId), ...extraQueryKeys],
  });

  const { data, isLoading } = useQuery({
    queryKey: eventDeliverStatusKey(sessionId),
    queryFn: () =>
      fetchEventDeliverGroupStatus({ eventId, sessionId, sessionDate }),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
  const { data: stops = [] } = useQuery({
    queryKey: ["event-venue-stops", eventId],
    queryFn: () => resolveVenueStops(eventId, () => listEventVenueStops(eventId)),
    staleTime: 20_000,
    networkMode: "always",
  });
  const steps = useMemo(() => {
    if (!data) return [];
    const hasProgramme = data.steps.some(
      (step) =>
        step.id.startsWith("hop-") ||
        step.id.startsWith("onsite-") ||
        step.id === "evening-roll" ||
        step.id === "base-end",
    );
    if (hasProgramme || stops.length === 0) return data.steps;
    return [...data.steps, ...plannedDayStatusSteps(stops, sessionDate)];
  }, [data, stops, sessionDate]);

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading group status…
      </div>
    );
  }

  const HeadlineIcon =
    data.tone === "transit"
      ? Bus
      : data.tone === "base"
        ? Moon
        : data.tone === "roll"
          ? Sunrise
          : data.tone === "arrival"
            ? Users
            : MapPin;

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "rounded-xl border-2 px-4 py-3",
          TONE_HEADLINE[data.tone] ?? TONE_HEADLINE.planning,
        )}
      >
        <div className="flex items-start gap-2">
          <HeadlineIcon className="mt-0.5 h-5 w-5 shrink-0 opacity-80" />
          <div className="min-w-0">
            <div className="text-sm font-bold leading-snug">{data.headline}</div>
            {data.subline && (
              <div className="mt-0.5 text-xs text-muted-foreground">{data.subline}</div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card px-3 py-2">
        <div className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Group status
        </div>
        <ol className="space-y-1">
          {steps.map((step) => (
            <StatusStepRow key={step.id} step={step} />
          ))}
        </ol>
      </div>
    </div>
  );
}

function StatusStepRow({ step }: { step: EventDeliverStatusStep }) {
  const Icon =
    step.state === "complete"
      ? CheckCircle2
      : step.state === "current"
        ? step.id === "morning-roll"
          ? Sunrise
          : step.id === "evening-roll"
            ? Moon
            : step.id.startsWith("onsite-")
              ? step.label.toLowerCase().includes("medication")
                ? Pill
                : Utensils
              : step.id.includes("collect")
                ? Users
                : step.id.includes("-at")
                  ? MapPin
                  : step.id.includes("depart")
                    ? Bus
                    : MapPin
        : Circle;

  return (
    <li
      className={cn(
        "flex items-start gap-2.5 rounded-lg px-2 py-2 text-sm",
        step.state === "current" && "bg-primary/10 ring-1 ring-primary/30",
        step.state === "complete" && "opacity-80",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          step.state === "complete" && "text-emerald-600",
          step.state === "current" && "text-primary",
          step.state === "upcoming" && "text-muted-foreground",
        )}
      />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "font-medium leading-snug",
            step.state === "current" && "text-foreground",
            step.state === "upcoming" && "text-muted-foreground",
          )}
        >
          {step.label}
        </div>
        {step.detail && (
          <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {step.detail}
          </div>
        )}
        {step.stamps && step.stamps.length > 0 && <StepStamps stamps={step.stamps} />}
      </div>
    </li>
  );
}

function StepStamps({ stamps }: { stamps: StatusStamp[] }) {
  return (
    <div className="mt-0.5 text-[11px] tabular-nums leading-snug text-muted-foreground">
      {stamps.map((stamp, i) => (
        <span key={`${stamp.label}-${stamp.at}`}>
          {i > 0 ? " · " : null}
          {stamp.label}{" "}
          <ClientTime iso={stamp.at} options={{ hour: "2-digit", minute: "2-digit" }} />
        </span>
      ))}
    </div>
  );
}
