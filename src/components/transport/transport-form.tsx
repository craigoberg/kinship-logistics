import { useState } from "react";
import { Check, X, Clock, Save } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { addTransportLog, type Participant, type TransportStatus } from "@/lib/data-store";
import { enqueue } from "@/lib/sync-queue";
import { useOnlineStatus } from "@/hooks/use-online-status";

interface Props {
  participants: Participant[];
  onLogged?: () => void;
}

const STATUSES: { value: TransportStatus; label: string; icon: typeof Check }[] = [
  { value: "En route", label: "En route", icon: Clock },
  { value: "Arrived",  label: "Arrived",  icon: Check },
  { value: "No-show",  label: "No-show",  icon: X },
];

export function TransportForm({ participants, onLogged }: Props) {
  const online = useOnlineStatus();
  const [participantId, setParticipantId] = useState("");
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [present, setPresent] = useState(true);
  const [status, setStatus] = useState<TransportStatus>("Arrived");
  const [notes, setNotes] = useState("");

  const km =
    pickup && dropoff && Number(dropoff) >= Number(pickup)
      ? Number(dropoff) - Number(pickup)
      : null;

  const canSubmit = !!participantId && !!pickup && !!dropoff;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const log = addTransportLog({
      participantId,
      pickupOdometer: Number(pickup),
      dropoffOdometer: Number(dropoff),
      passengerPresent: present,
      status,
      timestamp: new Date().toISOString(),
      notes,
    });
    enqueue("transport_log", { id: log.id, participantId, status, km });
    setPickup("");
    setDropoff("");
    setNotes("");
    setStatus("Arrived");
    setPresent(true);
    setParticipantId("");
    onLogged?.();
  };

  return (
    <Card asChild>
      <form onSubmit={submit} className="space-y-5 p-5">
        <div className="grid gap-2">
          <Label htmlFor="participant">Participant</Label>
          <Select value={participantId} onValueChange={setParticipantId}>
            <SelectTrigger id="participant" className="h-12">
              <SelectValue placeholder="Select participant…" />
            </SelectTrigger>
            <SelectContent>
              {participants.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.fullName} <span className="text-muted-foreground">· {p.ndisId}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label htmlFor="pickup">Pickup odometer (km)</Label>
            <Input
              id="pickup"
              type="number"
              inputMode="numeric"
              className="h-14 text-lg tabular-nums"
              value={pickup}
              onChange={(e) => setPickup(e.target.value)}
              placeholder="48 210"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dropoff">Drop-off odometer</Label>
            <Input
              id="dropoff"
              type="number"
              inputMode="numeric"
              className="h-14 text-lg tabular-nums"
              value={dropoff}
              onChange={(e) => setDropoff(e.target.value)}
              placeholder="48 227"
            />
          </div>
        </div>
        {km !== null && (
          <div className="text-xs text-muted-foreground">
            Distance: <span className="font-semibold text-foreground tabular-nums">{km} km</span>
          </div>
        )}

        <div className="grid gap-2">
          <Label>Arrival status</Label>
          <div role="radiogroup" className="grid grid-cols-3 gap-2">
            {STATUSES.map((s) => {
              const active = status === s.value;
              const Icon = s.icon;
              return (
                <button
                  key={s.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setStatus(s.value)}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg border-2 px-2 py-2 text-sm font-semibold transition-all",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    active
                      ? s.value === "Arrived"
                        ? "border-success bg-success/15 text-success-foreground"
                        : s.value === "No-show"
                          ? "border-destructive bg-destructive/15 text-destructive"
                          : "border-info bg-info/15 text-info-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-foreground/30",
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-4 py-3">
          <div>
            <div className="text-sm font-medium">Passenger present</div>
            <div className="text-xs text-muted-foreground">Tap to toggle if no-show</div>
          </div>
          <button
            type="button"
            onClick={() => setPresent((v) => !v)}
            aria-pressed={present}
            className={cn(
              "inline-flex h-8 w-14 items-center rounded-full p-1 transition-colors",
              present ? "bg-success" : "bg-muted-foreground/30",
            )}
          >
            <span
              className={cn(
                "h-6 w-6 rounded-full bg-background shadow transition-transform",
                present ? "translate-x-6" : "translate-x-0",
              )}
            />
          </button>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="notes">Notes (optional)</Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything the next coordinator should know…"
            rows={2}
          />
        </div>

        <Button type="submit" disabled={!canSubmit} className="h-14 w-full gap-2 text-base">
          <Save className="h-5 w-5" />
          {online ? "Save run" : "Save & queue offline"}
        </Button>
      </form>
    </Card>
  );
}
