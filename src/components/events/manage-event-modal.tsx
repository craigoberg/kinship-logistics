import { useState } from "react";
import { Users, Wallet, Settings2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import { useLookupParameters } from "@/hooks/use-supabase-data";
import type { EventManifest } from "@/lib/data-store";
import { RosterTab } from "./roster-tab";
import { EventFinanceTab } from "./event-finance-tab";
import { EventDetailsTab } from "./event-details-tab";

interface Props {
  event: EventManifest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type TabKey = "roster" | "finance" | "details";

const TABS: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: "roster", label: "Roster Management", icon: Users },
  { key: "finance", label: "Event Finance & P&L", icon: Wallet },
  { key: "details", label: "Event Details & Config", icon: Settings2 },
];

export function ManageEventModal({ event, open, onOpenChange }: Props) {
  const [tab, setTab] = useState<TabKey>("roster");
  const { data: types = [] } = useLookupParameters("event_types");

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
          <DialogHeader className="space-y-1">
            <DialogTitle className="text-xl">{event.title}</DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-primary/15 px-2 py-0.5 font-semibold uppercase tracking-wide text-primary">
                {typeLabel}
              </span>
              <span className="text-muted-foreground">{event.venue}</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-mono tabular-nums text-muted-foreground">{dateLabel}</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-semibold tabular-nums text-white">
                ${event.ticketPrice.toFixed(2)}
              </span>
            </DialogDescription>
          </DialogHeader>

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
            <RosterTab event={event} />
          ) : tab === "finance" ? (
            <EventFinanceTab event={event} />
          ) : (
            <EventDetailsTab
              event={event}
              onSuccess={() => {
                setTab("roster");
                onOpenChange(false);
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
