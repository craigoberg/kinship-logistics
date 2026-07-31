/**
 * BL-098 leftover — Day Centre visitor → pick event → Add guest (prefilled).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { AddGuestBookingModal } from "@/components/events/add-guest-booking-modal";
import {
  splitDisplayNameForGuest,
  type GuestBookingPrefill,
} from "@/lib/api/event-guest";
import {
  VISITOR_KIND_LABELS,
  type SiteDayVisitor,
} from "@/lib/api/site-day-visitors";
import { listEvents, type EventManifest } from "@/lib/data-store";
import { getOperationalTodayIso } from "@/lib/operational-clock";
import { formatDate } from "@/lib/utils";

type Props = {
  open: boolean;
  visitor: SiteDayVisitor | null;
  onClose: () => void;
};

const LIVE_STATUSES = new Set(["Planning", "Confirmed", "Open"]);

function buildPrefill(visitor: SiteDayVisitor): GuestBookingPrefill {
  const { firstName, lastName } = splitDisplayNameForGuest(visitor.displayName);
  const kindLabel = VISITOR_KIND_LABELS[visitor.kind];
  const note = visitor.note?.trim();
  const opsNote = note
    ? `From Day Centre visitor (${kindLabel}): ${note}`
    : `From Day Centre visitor (${kindLabel})`;
  return {
    firstName,
    lastName,
    hostParticipantId: visitor.linkedParticipantId,
    opsNote,
    sourceVisitorId: visitor.id,
  };
}

export function PromoteVisitorToEventDialog({
  open,
  visitor,
  onClose,
}: Props) {
  const [selectedEvent, setSelectedEvent] = useState<EventManifest | null>(
    null,
  );
  const today = getOperationalTodayIso();

  const prefill = useMemo(
    () => (visitor ? buildPrefill(visitor) : null),
    [
      visitor?.id,
      visitor?.displayName,
      visitor?.kind,
      visitor?.note,
      visitor?.linkedParticipantId,
    ],
  );

  const eventsQ = useQuery({
    queryKey: ["event_manifest", "promote-visitor"],
    queryFn: listEvents,
    enabled: open && !!visitor && !selectedEvent,
    staleTime: 30_000,
  });

  const eligible = useMemo(() => {
    const rows = eventsQ.data ?? [];
    return rows
      .filter((ev) => LIVE_STATUSES.has(ev.status))
      .filter((ev) => {
        const end = (ev.endDate ?? ev.startDate ?? "").slice(0, 10);
        return end >= today;
      })
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  }, [eventsQ.data, today]);

  const handleCloseAll = () => {
    setSelectedEvent(null);
    onClose();
  };

  if (!visitor || !prefill) return null;

  if (selectedEvent) {
    return (
      <AddGuestBookingModal
        open={open}
        onOpenChange={(o) => {
          if (!o) handleCloseAll();
        }}
        event={selectedEvent}
        prefill={prefill}
      />
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleCloseAll();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to event</DialogTitle>
          <DialogDescription>
            Choose a Planning, Confirmed, or Open event for{" "}
            <span className="font-medium text-foreground">
              {visitor.displayName}
            </span>
            . You will complete DOB, emergency contact, and allergies next.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border">
          <Command>
            <CommandInput placeholder="Search events…" />
            <CommandList className="max-h-64">
              {eventsQ.isLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : eligible.length === 0 ? (
                <CommandEmpty>
                  No upcoming Planning / Confirmed / Open events.
                </CommandEmpty>
              ) : (
                <CommandGroup>
                  {eligible.map((ev) => (
                    <CommandItem
                      key={ev.id}
                      value={`${ev.title} ${ev.startDate} ${ev.status}`}
                      onSelect={() => setSelectedEvent(ev)}
                      className="flex flex-col items-start gap-0.5 py-2.5"
                    >
                      <span className="font-medium">{ev.title}</span>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CalendarDays className="h-3 w-3" />
                        {formatDate(ev.startDate)}
                        {ev.endDate && ev.endDate !== ev.startDate
                          ? ` – ${formatDate(ev.endDate)}`
                          : ""}
                        <span className="uppercase">· {ev.status}</span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </div>

        <DialogFooter className="sm:justify-start">
          <Button type="button" variant="outline" onClick={handleCloseAll}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
