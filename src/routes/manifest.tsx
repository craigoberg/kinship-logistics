import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, MapPin, Navigation, Pill, AlertTriangle, Loader2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useActiveTrip,
  useStartTrip,
  usePatchTripLeg,
  useCompleteTrip,
  useEvents,
  useLastEndOdometer,
} from "@/hooks/use-supabase-data";
import { NoShowCountdownModal } from "@/components/attendance/no-show-countdown-modal";
import { haversineKm, getCurrentPosition } from "@/lib/geo";
import { cn } from "@/lib/utils";
import type { TripLeg, ActiveTripBundle } from "@/lib/data-store";

export const Route = createFileRoute("/manifest")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Active Driver Manifest — Yada Connect" },
      { name: "description", content: "Sequential leg-by-leg trip workflow with GPS, passenger boarding, and medication bag handover." },
    ],
  }),
  component: ManifestPage,
});

function ManifestPage() {
  const { data: bundle, isLoading } = useActiveTrip();

  return (
    <div className="mx-auto flex h-[100dvh] max-w-md flex-col overflow-x-hidden bg-background">
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading manifest…
        </div>
      ) : bundle ? (
        <ActiveTripScreen bundle={bundle} />
      ) : (
        <InitializeTripScreen />
      )}
    </div>
  );
}

/* -------------------- Initialize -------------------- */

function InitializeTripScreen() {
  const { data: events = [] } = useEvents();
  const { data: lastEndOdo = null } = useLastEndOdometer();
  const startTrip = useStartTrip();
  const today = new Date().toISOString().slice(0, 10);
  const todaysEvents = useMemo(
    () => events.filter((e) => e.startDate <= today && (e.endDate ?? e.startDate) >= today),
    [events, today],
  );
  const [eventId, setEventId] = useState("");
  const [odo, setOdo] = useState("");
  const [reason, setReason] = useState("");

  const odoNum = odo === "" ? null : Number(odo);
  const VARIANCE_KM = 100;
  const outOfBounds =
    odoNum != null &&
    lastEndOdo != null &&
    (odoNum < lastEndOdo || odoNum > lastEndOdo + VARIANCE_KM);

  const reasonOk = !outOfBounds || reason.trim().length >= 3;
  const canSubmit = !!eventId && odoNum != null && odoNum > 0 && reasonOk && !startTrip.isPending;

  const onOdoChange = (raw: string) => {
    // Strip any non-digit characters (incl. spaces) — positive integers only.
    const cleaned = raw.replace(/\D+/g, "");
    setOdo(cleaned);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || odoNum == null) return;
    startTrip.mutate(
      {
        eventId,
        startOdometerKm: odoNum,
        varianceReason: outOfBounds ? reason.trim() : null,
      },
      {
        onSuccess: () => toast.success("Daily run started", { description: "Manifest is now open." }),
      },
    );
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <Card className="p-5">
        <h1 className="text-xl font-extrabold tracking-tight">Initialize Daily Run</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick today's event manifest and capture the starting odometer to open the leg itinerary.
        </p>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="event">Select Event</Label>
            <Select value={eventId} onValueChange={setEventId}>
              <SelectTrigger id="event" className="h-12">
                <SelectValue placeholder={todaysEvents.length ? "Today's events…" : "No events today — pick any"} />
              </SelectTrigger>
              <SelectContent>
                {(todaysEvents.length ? todaysEvents : events).map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.title} · {e.startDate}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="odo">Starting Odometer reading (KM)</Label>
            <Input
              id="odo"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]*"
              className={cn(
                "h-14 text-lg tabular-nums",
                outOfBounds && "border-amber-500 focus-visible:ring-amber-500",
              )}
              value={odo}
              onChange={(e) => onOdoChange(e.target.value)}
              placeholder="48210"
            />
            {lastEndOdo != null && !outOfBounds && odoNum != null && (
              <p className="text-[11px] text-muted-foreground">
                Last recorded closing odometer: <span className="tabular-nums font-medium">{lastEndOdo} KM</span>
              </p>
            )}
          </div>

          {outOfBounds && lastEndOdo != null && (
            <div className="space-y-2 rounded-lg border border-amber-500 bg-amber-500/10 p-3 animate-in slide-in-from-top-2">
              <div className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="text-sm font-semibold">
                  ⚠️ Reading varies significantly from the last recorded closing odometer of {lastEndOdo} KM. Please confirm for a typo.
                </p>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="reason" className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  Reason for Odometer Variance (Required)
                </Label>
                <Input
                  id="reason"
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="h-11 bg-background"
                  placeholder="e.g. vehicle swap, after-hours private use logged separately…"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="h-14 w-full rounded-xl bg-blue-600 font-bold text-white shadow transition hover:bg-blue-700 disabled:opacity-60"
          >
            {startTrip.isPending ? "Opening…" : "Start Daily Trip & Open Manifest"}
          </button>
        </form>
      </Card>
    </div>
  );
}

/* -------------------- Active Trip -------------------- */

function ActiveTripScreen({ bundle }: { bundle: ActiveTripBundle }) {
  const { trip, legs } = bundle;
  const activeLeg = legs.find((l) => l.status !== "completed") ?? null;
  const completedCount = legs.filter((l) => l.status === "completed").length;
  const allLegsComplete = activeLeg == null;
  const totalKm = legs.reduce((sum, l) => sum + (l.loggedDistanceKm ?? l.gpsDistanceKm ?? 0), 0);

  const activeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (activeRef.current) activeRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeLeg?.id]);

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-border bg-slate-900 text-white">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Daily Run · {trip.tripDate}
            </div>
            <div className="truncate text-base font-bold">
              Leg {Math.min(completedCount + 1, legs.length)} of {legs.length}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Logged</div>
            <div className="font-mono text-lg font-bold tabular-nums">{totalKm.toFixed(1)} km</div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-3 pb-4 pt-3">
        {activeLeg ? (
          <div ref={activeRef}>
            <ActiveLegCard leg={activeLeg} />
          </div>
        ) : (
          <Card className="border-2 border-green-600 bg-green-600/10 p-4 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-green-600" />
            <div className="mt-2 text-lg font-bold">All legs completed</div>
            <div className="text-sm text-muted-foreground">Finalize the shift below.</div>
          </Card>
        )}

        <div className="mt-4 space-y-2">
          {legs
            .filter((l) => l.id !== activeLeg?.id)
            .map((l) => (
              <LegRow key={l.id} leg={l} />
            ))}
        </div>
      </main>

      <footer className="sticky bottom-0 z-20 border-t border-border bg-card p-3 pb-[env(safe-area-inset-bottom)]">
        {allLegsComplete ? (
          <FinalizeShiftCard tripId={trip.id} startOdometer={trip.startOdometerKm} />
        ) : (
          <div className="text-center text-xs text-muted-foreground">
            Complete each leg in order. Driver: tap from the seat.
          </div>
        )}
      </footer>
    </>
  );
}

function LegRow({ leg }: { leg: TripLeg }) {
  const done = leg.status === "completed";
  return (
    <Card
      className={cn(
        "flex items-center justify-between gap-3 p-3 text-sm",
        done ? "border-green-600/40 bg-green-600/5" : "pointer-events-none opacity-50",
      )}
    >
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Leg {leg.legIndex}
        </div>
        <div className="truncate font-medium">
          {leg.fromLabel} <span className="text-muted-foreground">→</span> {leg.toLabel}
        </div>
      </div>
      {done ? (
        <div className="flex items-center gap-1 text-xs font-semibold text-green-600">
          <CheckCircle2 className="h-4 w-4" />
          {(leg.loggedDistanceKm ?? leg.gpsDistanceKm ?? 0).toFixed(1)} km
        </div>
      ) : (
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Upcoming</div>
      )}
    </Card>
  );
}

/* -------------------- Active Leg -------------------- */

function ActiveLegCard({ leg }: { leg: TripLeg }) {
  const patch = usePatchTripLeg();
  const [busy, setBusy] = useState(false);

  const runGps = async (mode: "start" | "end") => {
    setBusy(true);
    try {
      const pos = await getCurrentPosition();
      if (mode === "start") {
        await patch.mutateAsync({
          legId: leg.id,
          patch: {
            status: "en_route",
            startLat: pos.lat,
            startLng: pos.lng,
            startAt: new Date().toISOString(),
          },
        });
      } else {
        const km =
          leg.startLat != null && leg.startLng != null
            ? haversineKm({ lat: leg.startLat, lng: leg.startLng }, pos)
            : 0;
        await patch.mutateAsync({
          legId: leg.id,
          patch: {
            status: "arrived",
            endLat: pos.lat,
            endLng: pos.lng,
            endAt: new Date().toISOString(),
            gpsDistanceKm: Number(km.toFixed(2)),
            loggedDistanceKm: Number(km.toFixed(2)),
          },
        });
      }
    } catch (err) {
      toast.error("GPS capture failed", {
        description: (err as Error).message,
        className: "border-red-700 bg-red-600 text-white font-medium",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="rounded-xl border-2 border-blue-500 bg-slate-900 p-4 text-white">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-blue-300">
        <Navigation className="h-3.5 w-3.5" /> Active leg {leg.legIndex}
      </div>
      <div className="mt-1 flex items-start gap-2">
        <MapPin className="mt-1 h-5 w-5 shrink-0 text-blue-300" />
        <div className="min-w-0">
          <div className="truncate text-lg font-bold leading-tight">{leg.fromLabel}</div>
          <div className="text-xs text-slate-400">↓</div>
          <div className="truncate text-lg font-bold leading-tight">{leg.toLabel}</div>
        </div>
      </div>

      <div className="mt-4">
        {leg.status === "pending" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => runGps("start")}
            className="h-14 w-full rounded-xl bg-teal-600 text-lg font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
          >
            🚀 Start Leg / Set En Route
          </button>
        )}
        {leg.status === "en_route" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => runGps("end")}
            className="h-14 w-full animate-pulse rounded-xl bg-amber-500 text-lg font-bold text-black transition hover:bg-amber-400 disabled:opacity-60"
          >
            🛑 Arrived at Destination
          </button>
        )}
        {leg.status === "arrived" && <ArrivedChecklist leg={leg} />}
      </div>
    </Card>
  );
}

/* -------------------- Arrived checklist -------------------- */

function ArrivedChecklist({ leg }: { leg: TripLeg }) {
  const patch = usePatchTripLeg();
  const [loggedKm, setLoggedKm] = useState(
    String(leg.loggedDistanceKm ?? leg.gpsDistanceKm ?? 0),
  );
  const [present, setPresent] = useState<boolean>(leg.passengerPresent ?? true);
  const [medConfirmed, setMedConfirmed] = useState(leg.medicationHandoverConfirmed);
  const [extraMed, setExtraMed] = useState(leg.unexpectedMedicationLogged);
  const [extraNotes, setExtraNotes] = useState(leg.unexpectedMedicationNotes ?? "");
  const [showNoShow, setShowNoShow] = useState(false);

  const participantId = leg.toParticipantId ?? leg.fromParticipantId;
  const participantName = leg.toParticipantId ? leg.toLabel : leg.fromLabel;

  const blocked =
    !loggedKm ||
    Number.isNaN(Number(loggedKm)) ||
    (leg.medicationExpected && !medConfirmed) ||
    (extraMed && extraNotes.trim().length < 3);

  const confirm = async () => {
    try {
      await patch.mutateAsync({
        legId: leg.id,
        patch: {
          status: "completed",
          loggedDistanceKm: Number(loggedKm),
          passengerPresent: present,
          medicationHandoverConfirmed: medConfirmed,
          unexpectedMedicationLogged: extraMed,
          unexpectedMedicationNotes: extraMed ? extraNotes.trim() : null,
          completedAt: new Date().toISOString(),
        },
      });
      toast.success(`Leg ${leg.legIndex} logged`, {
        description: `${leg.fromLabel} → ${leg.toLabel}`,
      });
    } catch {
      /* hook surfaces red toast */
    }
  };

  return (
    <div className="space-y-4 rounded-lg bg-slate-800/60 p-3 text-white">
      <div className="grid gap-2">
        <Label htmlFor="kmlog" className="text-slate-200">Logged Leg Kilometers (GPS)</Label>
        <Input
          id="kmlog"
          type="number"
          inputMode="decimal"
          className="h-12 bg-slate-950 text-base tabular-nums text-white"
          value={loggedKm}
          onChange={(e) => setLoggedKm(e.target.value)}
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2">
        <div>
          <div className="text-sm font-semibold">Passenger Present &amp; Boarded</div>
          <div className="text-xs text-slate-400">Toggle off to escalate as no-show.</div>
        </div>
        <Switch checked={present} onCheckedChange={setPresent} />
      </div>

      {!present && participantId && (
        <>
          <button
            type="button"
            onClick={() => setShowNoShow(true)}
            className="mt-2 h-12 w-full rounded-xl bg-red-600 font-bold text-white transition hover:bg-red-700"
          >
            ⚠️ Trigger No-Show Countdown
          </button>
          <NoShowCountdownModal
            open={showNoShow}
            onOpenChange={(o) => {
              setShowNoShow(o);
              if (!o) {
                patch.mutate({
                  legId: leg.id,
                  patch: { noShowTriggeredAt: new Date().toISOString() },
                });
              }
            }}
            participantId={participantId}
            participantName={participantName}
          />
        </>
      )}

      {leg.medicationExpected && (
        <div className="rounded-lg border border-amber-500/60 bg-amber-500/10 p-3">
          <div className="flex items-start gap-2 text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="text-sm font-semibold">
              ⚠️ EXPECTED MEDICATION: Verify receipt of client's medication container.
            </div>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <Checkbox
              checked={medConfirmed}
              onCheckedChange={(v) => setMedConfirmed(v === true)}
            />
            <span className="font-medium">Medication Bag Handover Confirmed</span>
          </label>
        </div>
      )}

      <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={extraMed} onCheckedChange={(v) => setExtraMed(v === true)} />
          <span className="font-medium">
            <Pill className="mr-1 inline h-4 w-4 text-blue-300" />
            ➕ Log Unexpected Medication Bag Received
          </span>
        </label>
        {extraMed && (
          <div className="mt-2 grid gap-1">
            <Label htmlFor="xnotes" className="text-xs text-slate-300">
              Notes / Description of unexpected medicine bag
            </Label>
            <Textarea
              id="xnotes"
              rows={2}
              value={extraNotes}
              onChange={(e) => setExtraNotes(e.target.value)}
              className="bg-slate-950 text-white"
              placeholder="e.g. small white pouch · 2 inhalers labelled JS"
            />
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={blocked || patch.isPending}
        onClick={confirm}
        className="mt-4 h-14 w-full rounded-xl bg-green-600 font-bold text-white transition hover:bg-green-700 disabled:opacity-60"
      >
        {patch.isPending ? "Logging…" : "Confirm & Log Leg Completion"}
      </button>
    </div>
  );
}

/* -------------------- Finalize -------------------- */

function FinalizeShiftCard({ tripId, startOdometer }: { tripId: string; startOdometer: number }) {
  const complete = useCompleteTrip();
  const [odo, setOdo] = useState("");
  const valid = odo && Number(odo) >= startOdometer;

  const submit = () => {
    if (!valid) {
      toast.error("Ending odometer must be ≥ starting odometer", {
        className: "border-red-700 bg-red-600 text-white font-medium",
      });
      return;
    }
    complete.mutate(
      { tripId, endOdometerKm: Number(odo) },
      { onSuccess: () => toast.success("Daily run locked.") },
    );
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="endodo" className="text-xs font-bold uppercase tracking-wider">
        Ending Odometer reading (KM)
      </Label>
      <Input
        id="endodo"
        type="number"
        inputMode="numeric"
        className="h-12 text-base tabular-nums"
        value={odo}
        onChange={(e) => setOdo(e.target.value)}
        placeholder={`≥ ${startOdometer}`}
      />
      <button
        type="button"
        disabled={!valid || complete.isPending}
        onClick={submit}
        className="h-14 w-full rounded-xl bg-red-700 font-bold text-white transition hover:bg-red-800 disabled:opacity-60"
      >
        🏁 End Shift & Lock Daily Run Logs
      </button>
    </div>
  );
}
