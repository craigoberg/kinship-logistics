// Force rebuild version 2.0
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, MapPin, Navigation, Pill, AlertTriangle, Loader2, ShieldCheck, ShieldAlert, ClipboardCheck } from "lucide-react";

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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  useActiveTrip,
  useStartTrip,
  usePatchTripLeg,
  useCompleteTrip,
  useCancelTrip,
  useConfirmedEvents,
  useLastEndOdometer,
} from "@/hooks/use-supabase-data";

import { NoShowCountdownModal } from "@/components/attendance/no-show-countdown-modal";
import { haversineKm, getCurrentPosition } from "@/lib/geo";
import { cn } from "@/lib/utils";
import type { TripLeg, ActiveTripBundle, MedicationHandoverStatus, TransportAsset, AssetCheckpoint, AssetDailyClearance } from "@/lib/data-store";
import {
  listTransportAssets,
  getClearanceForAssetOnDate,
  listCheckpointsForAsset,
  insertAssetClearanceWithItems,
  getStaffId,
  STAFF_DIRECTORY,
  DEFAULT_STAFF_UUID,
} from "@/lib/data-store";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

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

type InitStep = "vehicle" | "clearance" | "event";

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function staffName(staffId: string): string {
  return STAFF_DIRECTORY.find((s) => s.id === staffId)?.name ?? "Driver";
}

function InitializeTripScreen() {
  const today = todayDateStr();
  const { data: lastEndOdo = null } = useLastEndOdometer();

  const [step, setStep] = useState<InitStep>("vehicle");
  const [assetId, setAssetId] = useState("");
  const [odo, setOdo] = useState("");
  const [clearanceOk, setClearanceOk] = useState(false);
  const hasHydratedOdoRef = useRef(false);

  useEffect(() => {
    if (hasHydratedOdoRef.current) return;
    if (lastEndOdo != null && odo === "") {
      setOdo(String(lastEndOdo));
      hasHydratedOdoRef.current = true;
    }
  }, [lastEndOdo, odo]);

  const assetsQ = useQuery({
    queryKey: ["transport-assets"],
    queryFn: () => listTransportAssets(),
    staleTime: 5 * 60_000,
  });
  const activeAssets = useMemo(
    () => (assetsQ.data ?? []).filter((a) => a.isActive),
    [assetsQ.data],
  );
  const selectedAsset = useMemo(
    () => activeAssets.find((a) => a.id === assetId) ?? null,
    [activeAssets, assetId],
  );

  const odoNum = odo === "" ? NaN : Number(odo);
  const odoReasonable = Number.isFinite(odoNum) && odoNum > 0 && odoNum < 10_000_000;

  const proceedToClearance = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsset || !odoReasonable) return;
    setStep("clearance");
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {step === "vehicle" && (
        <Card className="p-5">
          <h1 className="text-xl font-extrabold tracking-tight">Initialize Daily Run</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Step 1 of 3 — pick today's vehicle and record the starting odometer.
          </p>
          <form onSubmit={proceedToClearance} className="mt-5 space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="asset">Select Vehicle</Label>
              <Select value={assetId} onValueChange={setAssetId}>
                <SelectTrigger id="asset" className="h-12">
                  <SelectValue placeholder={assetsQ.isLoading ? "Loading fleet…" : "Today's vehicle…"} />
                </SelectTrigger>
                <SelectContent>
                  {activeAssets.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} · {a.regoPlate} · {a.passengerCapacity} seats
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="odo">Starting Odometer reading (KM)</Label>
              <Input
                id="odo"
                type="number"
                value={odo}
                onChange={(e) => setOdo(e.target.value)}
                placeholder="Enter starting KM"
                className="h-14 text-lg tabular-nums"
              />
              {lastEndOdo != null && (
                <p className="text-[11px] text-muted-foreground">
                  Last recorded closing odometer:{" "}
                  <span className="tabular-nums font-medium">{lastEndOdo} KM</span>
                  {odoNum === lastEndOdo && " · pre-filled"}
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={!assetId || !odoReasonable}
              className={cn(
                "h-14 w-full rounded-xl font-bold text-white shadow transition",
                !assetId || !odoReasonable
                  ? "bg-blue-600 opacity-60 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-700",
              )}
            >
              Continue to Vehicle Clearance →
            </button>
          </form>
        </Card>
      )}

      {step === "clearance" && selectedAsset && (
        <ClearanceGate
          asset={selectedAsset}
          startOdometer={odoNum}
          dateStr={today}
          onCleared={() => {
            setClearanceOk(true);
            setStep("event");
          }}
          onBack={() => setStep("vehicle")}
        />
      )}

      {step === "event" && selectedAsset && clearanceOk && (
        <EventPickAndStart
          asset={selectedAsset}
          startOdometer={odoNum}
          onBack={() => setStep("clearance")}
        />
      )}
    </div>
  );
}

/* -------------------- Clearance Gate -------------------- */

function ClearanceGate({
  asset,
  startOdometer,
  dateStr,
  onCleared,
  onBack,
}: {
  asset: TransportAsset;
  startOdometer: number;
  dateStr: string;
  onCleared: () => void;
  onBack: () => void;
}) {
  const existingQ = useQuery<AssetDailyClearance | null>({
    queryKey: ["asset-clearance", asset.id, dateStr],
    queryFn: () => getClearanceForAssetOnDate(asset.id, dateStr),
    staleTime: 30_000,
  });

  if (existingQ.isLoading) {
    return (
      <Card className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking today's clearance…
      </Card>
    );
  }

  const existing = existingQ.data ?? null;

  if (existing && existing.status === "passed") {
    return (
      <FastPassBanner
        asset={asset}
        clearance={existing}
        onConfirm={onCleared}
        onBack={onBack}
      />
    );
  }

  if (existing && existing.status === "failed") {
    return (
      <Card className="border-2 border-destructive/60 bg-destructive/5 p-5">
        <div className="flex items-center gap-2 text-destructive">
          <ShieldAlert className="h-5 w-5" />
          <h2 className="text-lg font-extrabold">Vehicle NOT cleared today</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {asset.name} ({asset.regoPlate}) failed today's walkaround. The coordinator must
          resolve the flagged checkpoints before this vehicle can be dispatched.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="mt-4 h-12 w-full rounded-xl border-2 border-destructive bg-transparent font-bold text-destructive transition hover:bg-destructive/10"
        >
          ← Pick a different vehicle
        </button>
      </Card>
    );
  }

  return (
    <WalkaroundChecklist
      asset={asset}
      startOdometer={startOdometer}
      dateStr={dateStr}
      onPassed={onCleared}
      onBack={onBack}
    />
  );
}

function FastPassBanner({
  asset,
  clearance,
  onConfirm,
  onBack,
}: {
  asset: TransportAsset;
  clearance: AssetDailyClearance;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const time = new Date(clearance.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const driver = staffName(clearance.driverStaffId);

  return (
    <Card className="border-2 border-green-600 bg-green-600/10 p-5">
      <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
        <ShieldCheck className="h-6 w-6" />
        <h2 className="text-lg font-extrabold">Fast-Pass · Vehicle Cleared</h2>
      </div>
      <p className="mt-3 text-sm">
        <span className="font-semibold">{asset.name}</span> ({asset.regoPlate}) was cleared
        for service at <span className="font-mono font-semibold">{time}</span> by{" "}
        <span className="font-semibold">{driver}</span>.
      </p>
      <p className="mt-2 text-sm font-medium text-amber-700 dark:text-amber-300">
        Please inspect for obvious new damage before departing.
      </p>
      <button
        type="button"
        onClick={onConfirm}
        className="mt-5 h-14 w-full rounded-xl bg-green-600 text-base font-bold text-white shadow transition hover:bg-green-700"
      >
        ✓ Confirm &amp; Roll
      </button>
      <button
        type="button"
        onClick={onBack}
        className="mt-2 h-10 w-full rounded-xl text-sm font-semibold text-muted-foreground transition hover:text-foreground"
      >
        ← Change vehicle
      </button>
    </Card>
  );
}

/* -------------------- Walkaround Checklist -------------------- */

interface ChecklistAnswer {
  passed: boolean;
  notes: string;
}

function WalkaroundChecklist({
  asset,
  startOdometer,
  dateStr,
  onPassed,
  onBack,
}: {
  asset: TransportAsset;
  startOdometer: number;
  dateStr: string;
  onPassed: () => void;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const checkpointsQ = useQuery<AssetCheckpoint[]>({
    queryKey: ["asset-checkpoints", asset.id, asset.vehicleCategory],
    queryFn: () => listCheckpointsForAsset(asset.id, asset.vehicleCategory),
    staleTime: 5 * 60_000,
  });

  const [answers, setAnswers] = useState<Record<string, ChecklistAnswer>>({});

  const submitMut = useMutation({
    mutationFn: async (checkpoints: AssetCheckpoint[]) => {
      const driverStaffId = getStaffId() || DEFAULT_STAFF_UUID;
      const items = checkpoints.map((c) => {
        const a = answers[c.id] ?? { passed: false, notes: "" };
        return {
          checkpointId: c.id,
          checkpointLabel: c.label,
          passed: a.passed,
          isMandatory: c.isMandatory,
          notes: a.notes.trim() ? a.notes.trim() : null,
        };
      });
      return insertAssetClearanceWithItems({
        assetId: asset.id,
        clearanceDate: dateStr,
        driverStaffId,
        startOdometer: Math.round(startOdometer),
        items,
      });
    },
    onSuccess: (bundle) => {
      qc.invalidateQueries({ queryKey: ["asset-clearance", asset.id, dateStr] });
      qc.invalidateQueries({ queryKey: ["start-end-day-anomalies"] });
      if (bundle.clearance.status === "passed") {
        toast.success("Vehicle cleared", { description: `${asset.name} passed walkaround.` });
        onPassed();
      } else {
        toast.error("Vehicle NOT cleared", {
          description: "A mandatory checkpoint failed. Coordinator notified.",
          className: "border-red-700 bg-red-600 text-white font-medium",
        });
      }
    },
    onError: (e: Error) => {
      toast.error("Could not log clearance", { description: e.message });
    },
  });

  if (checkpointsQ.isLoading) {
    return (
      <Card className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading walkaround checklist…
      </Card>
    );
  }

  const checkpoints = checkpointsQ.data ?? [];
  const allAnswered = checkpoints.every((c) => answers[c.id]?.passed !== undefined);

  const setPassed = (id: string, passed: boolean) =>
    setAnswers((p) => ({ ...p, [id]: { ...(p[id] ?? { notes: "" }), passed } }));
  const setNotes = (id: string, notes: string) =>
    setAnswers((p) => ({ ...p, [id]: { ...(p[id] ?? { passed: false }), notes } }));

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-5 w-5 text-blue-600" />
        <h2 className="text-lg font-extrabold">Daily Walkaround — {asset.name}</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {asset.regoPlate} · Tick every checkpoint as PASS or FAIL. Mandatory failures block dispatch.
      </p>

      <div className="mt-5 space-y-3">
        {checkpoints.map((c) => {
          const a = answers[c.id];
          const decided = a?.passed !== undefined;
          const failed = a?.passed === false;
          return (
            <div
              key={c.id}
              className={cn(
                "rounded-lg border p-3",
                failed
                  ? "border-destructive/60 bg-destructive/5"
                  : decided
                    ? "border-green-600/40 bg-green-600/5"
                    : "border-border",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{c.label}</div>
                  <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {c.category ?? "general"} · {c.isMandatory ? "mandatory" : "optional"}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => setPassed(c.id, true)}
                    className={cn(
                      "h-9 rounded-md border px-3 text-xs font-bold transition",
                      a?.passed === true
                        ? "border-green-600 bg-green-600 text-white"
                        : "border-border bg-background text-muted-foreground hover:border-green-600/60",
                    )}
                  >
                    PASS
                  </button>
                  <button
                    type="button"
                    onClick={() => setPassed(c.id, false)}
                    className={cn(
                      "h-9 rounded-md border px-3 text-xs font-bold transition",
                      a?.passed === false
                        ? "border-destructive bg-destructive text-destructive-foreground"
                        : "border-border bg-background text-muted-foreground hover:border-destructive/60",
                    )}
                  >
                    FAIL
                  </button>
                </div>
              </div>
              {failed && (
                <div className="mt-2 grid gap-1">
                  <Label htmlFor={`note-${c.id}`} className="text-xs">
                    Notes (what failed?)
                  </Label>
                  <Textarea
                    id={`note-${c.id}`}
                    rows={2}
                    value={a?.notes ?? ""}
                    onChange={(e) => setNotes(c.id, e.target.value)}
                    placeholder="e.g. left brake light intermittent"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        disabled={!allAnswered || submitMut.isPending}
        onClick={() => submitMut.mutate(checkpoints)}
        className={cn(
          "mt-5 h-14 w-full rounded-xl font-bold text-white shadow transition",
          !allAnswered || submitMut.isPending
            ? "bg-blue-600 opacity-60"
            : "bg-blue-600 hover:bg-blue-700",
        )}
      >
        {submitMut.isPending ? "Submitting clearance…" : "Submit Walkaround & Clear Vehicle"}
      </button>
      <button
        type="button"
        onClick={onBack}
        className="mt-2 h-10 w-full rounded-xl text-sm font-semibold text-muted-foreground transition hover:text-foreground"
      >
        ← Change vehicle
      </button>
    </Card>
  );
}

/* -------------------- Event Picker + Start Trip -------------------- */

function EventPickAndStart({
  asset,
  startOdometer,
  onBack,
}: {
  asset: TransportAsset;
  startOdometer: number;
  onBack: () => void;
}) {
  const { data: events = [] } = useConfirmedEvents();
  const startTrip = useStartTrip();
  const today = todayDateStr();
  const todaysEvents = useMemo(
    () => events.filter((e) => e.startDate <= today && (e.endDate ?? e.startDate) >= today),
    [events, today],
  );
  const [eventId, setEventId] = useState("");
  const inFlightRef = useRef(false);

  const disabled = !eventId || startTrip.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    if (inFlightRef.current || startTrip.isPending) return;
    inFlightRef.current = true;
    startTrip.mutate(
      { eventId, startOdometerKm: startOdometer, varianceReason: null },
      {
        onSuccess: () => toast.success("Daily run started", { description: "Manifest is now open." }),
        onSettled: () => {
          inFlightRef.current = false;
        },
      },
    );
  };

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
        <ShieldCheck className="h-5 w-5" />
        <h2 className="text-lg font-extrabold">{asset.name} cleared · pick event</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Step 3 of 3 — select today's event manifest to open the leg itinerary.
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
        <button
          type="submit"
          disabled={disabled}
          className={cn(
            "h-14 w-full rounded-xl font-bold text-white shadow transition",
            disabled ? "bg-blue-600 opacity-60 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700",
          )}
        >
          {startTrip.isPending ? "Opening…" : "Start Daily Trip & Open Manifest"}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="mt-1 h-10 w-full rounded-xl text-sm font-semibold text-muted-foreground transition hover:text-foreground"
        >
          ← Back to clearance
        </button>
      </form>
    </Card>
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
          <div className="min-w-0 flex-1 pr-3">
            <div className="truncate text-base font-bold leading-tight">
              {bundle.eventTitle ?? "Daily Run"}
            </div>
            <div className="truncate text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {trip.tripDate} · Leg {Math.min(completedCount + 1, legs.length)} of {legs.length}
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

      <footer className="sticky bottom-0 z-20 space-y-3 border-t border-border bg-card p-3 pb-[env(safe-area-inset-bottom)]">
        {allLegsComplete ? (
          <FinalizeShiftCard tripId={trip.id} startOdometer={trip.startOdometerKm} />
        ) : (
          <div className="text-center text-xs text-muted-foreground">
            Complete each leg in order. Driver: tap from the seat.
          </div>
        )}
        <CancelTripButton tripId={trip.id} />
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
        {leg.targetAddress && (
          <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{leg.targetAddress}</span>
          </div>
        )}
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
          {leg.targetAddress && (
            <div className="mt-1 flex items-start gap-1.5 text-xs text-slate-300">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-300" />
              <span className="break-words">{leg.targetAddress}</span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4">
        {leg.status === "en_route" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => runGps("end")}
            className="h-14 w-full rounded-xl bg-green-600 text-lg font-bold text-white transition hover:bg-green-500 disabled:opacity-60"
          >
            🛑 Arrive at Stop
          </button>
        ) : leg.status === "arrived" ? (
          <ArrivedChecklist leg={leg} />
        ) : leg.status === "completed" ? null : (
          // Defensive default: any unhandled status (e.g. legacy 'scheduled', null)
          // is treated as the initial state so the driver always has an action.
          <button
            type="button"
            disabled={busy}
            onClick={() => runGps("start")}
            className="h-14 w-full animate-pulse rounded-xl bg-yellow-500 text-lg font-bold text-black transition hover:bg-yellow-400 disabled:opacity-60"
          >
            🚀 Depart Stop
          </button>
        )}
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
  const [medStatus, setMedStatus] = useState<MedicationHandoverStatus | null>(
    leg.medicationHandoverStatus ?? (leg.medicationHandoverConfirmed ? "collected_intact" : null),
  );
  const [extraMed, setExtraMed] = useState(leg.unexpectedMedicationLogged);
  const [extraNotes, setExtraNotes] = useState(leg.unexpectedMedicationNotes ?? "");
  const [showNoShow, setShowNoShow] = useState(false);

  const participantId = leg.toParticipantId ?? leg.fromParticipantId;
  const participantName = leg.toParticipantId ? leg.toLabel : leg.fromLabel;

  const medSatisfied =
    medStatus === "collected_intact" ||
    medStatus === "collected_damaged" ||
    medStatus === "expected_not_provided";
  const expectedMedSatisfied =
    medStatus === "collected_intact" ||
    medStatus === "collected_damaged" ||
    medStatus === "expected_not_provided";
  const exceptionFlagged =
    medStatus === "collected_damaged" || medStatus === "expected_not_provided";
  const blocked =
    !loggedKm ||
    Number.isNaN(Number(loggedKm)) ||
    (leg.medicationExpected && !expectedMedSatisfied) ||
    (!leg.medicationExpected && !medSatisfied) ||
    (extraMed && extraNotes.trim().length < 3);

  const confirm = async () => {
    try {
      await patch.mutateAsync({
        legId: leg.id,
        patch: {
          status: "completed",
          loggedDistanceKm: Number(loggedKm),
          passengerPresent: present,
          medicationHandoverStatus: medStatus,
          medicationHandoverConfirmed: medStatus === "collected_intact" || medStatus === "collected_damaged",
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

      <div
        className={cn(
          "rounded-lg border p-3",
          leg.medicationExpected
            ? "border-amber-500/60 bg-amber-500/10"
            : "border-slate-700 bg-slate-950/40",
        )}
      >
        {leg.medicationExpected && (
          <div className="mb-3 flex items-start gap-2 text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="text-sm font-semibold">
              ⚠️ EXPECTED MEDICATION: Confirm bag status before departure.
            </div>
          </div>
        )}
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-300">
          Medication Bag Handover
        </div>
        <RadioGroup
          value={medStatus ?? ""}
          onValueChange={(v) => setMedStatus(v as MedicationHandoverStatus)}
          className="mt-2 grid gap-2"
        >
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="collected_intact" id={`med-intact-${leg.id}`} />
            <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
            <span className="font-medium">Collected &amp; Intact</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="collected_damaged" id={`med-dmg-${leg.id}`} />
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
            <span className="font-medium">Collected but Damaged / Compromised</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="expected_not_provided" id={`med-exc-${leg.id}`} />
            <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
            <span className="font-medium">Expected but Not Provided</span>
          </label>
        </RadioGroup>
        {exceptionFlagged && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/60 bg-amber-500/10 p-2 text-xs text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Manager exception flag will be recorded against this leg.
            </span>
          </div>
        )}
      </div>


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

function CancelTripButton({ tripId }: { tripId: string }) {
  const cancel = useCancelTrip();
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          className="h-11 w-full rounded-xl border-2 border-red-600 bg-transparent text-sm font-bold text-red-600 transition hover:bg-red-50 disabled:opacity-60"
          disabled={cancel.isPending}
        >
          ✕ Cancel / Reset Trip
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this run?</AlertDialogTitle>
          <AlertDialogDescription>
            Logged kilometres and leg captures will be discarded. This cannot be undone.
            You'll return to the event selection screen.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep Driving</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-600 text-white hover:bg-red-700"
            onClick={() =>
              cancel.mutate(
                { tripId },
                {
                  onSuccess: () => {
                    toast.success("Run cancelled");
                    setOpen(false);
                  },
                },
              )
            }
          >
            Cancel Trip
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
