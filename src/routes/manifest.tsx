// Force rebuild version 2.4 - Full Integrated Guard
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  MapPin,
  Navigation,
  Pill,
  AlertTriangle,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  ClipboardCheck,
  LogOut,
  GripVertical,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  useStartDayCentreRun,
  useTodaysBusRunSummaries,
  usePatchTripLeg,
  useCompleteTrip,
  useCancelTrip,
  useConfirmedEvents,
  useLastEndOdometer,
  useLookupParameters,
  useReorderTripPickupLegs,
} from "@/hooks/use-supabase-data";

import { NoShowCountdownModal } from "@/components/attendance/no-show-countdown-modal";
import { haversineKm, getCurrentPosition } from "@/lib/geo";
import { cn } from "@/lib/utils";
import { triggerInspectionAlert, toSeverity } from "@/hooks/use-notification-router";
import type {
  TripLeg,
  ActiveTripBundle,
  MedicationHandoverStatus,
  TransportAsset,
  AssetCheckpoint,
  AssetDailyClearance,
  TodayManifestSummary,
  StartPointChoice,
} from "@/lib/data-store";
import {
  listTransportAssets,
  getClearanceForAssetOnDate,
  listCheckpointsForAsset,
  insertAssetClearanceWithItems,
  getTodayManifestSummary,
  getStaffId,
  getActiveUserRole,
  STAFF_DIRECTORY,
  DEFAULT_STAFF_UUID,
  computePickupChainEndpoints,
} from "@/lib/data-store";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { IssueAccumulatorPanel } from "@/components/manifest/issue-accumulator-panel";
// RedHandshakeWaitingPanel + multi-device handshake removed — RED now flows
// through the single-user VerbalAuthOverrideDialog inside IssueAccumulatorPanel.
// DynamicOperationalForm preserved on disk as inactive fallback (see preservation guidelines).
// PRE_TRIP_SCHEMA retained in operational-forms.ts for the inactive DynamicOperationalForm fallback.
import { getAssetGroundedStatus } from "@/lib/api/clearance";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { raiseUnexpectedMedBagIssue } from "@/lib/api/unexpected-med-bag";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { LOOKUP_CATEGORIES } from "@/lib/data-store";
import { dayCodeFromSydneyIndex } from "@/lib/api/centre-hours";
import { useSystemParameter } from "@/hooks/use-system-parameters";
import {
  canCancelPickupLeg,
  isPassengerPickupLeg,
  PickupCancelButton,
  PointerSortableList,
  usePickupCancelDialog,
  type PickupDragBind,
} from "@/components/manifest/manage-pickups-panel";

export const Route = createFileRoute("/manifest")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Active Driver Manifest — Yada Connect" },
      {
        name: "description",
        content: "Sequential leg-by-leg trip workflow with GPS, passenger boarding, and medication bag handover.",
      },
    ],
  }),
  component: ManifestPage,
});

function ManifestPage() {
  const driverStaffId = getStaffId() || DEFAULT_STAFF_UUID;
  const navigate = useNavigate();
  const manifestQueryClient = useQueryClient();

  // Multi-device handshake rehydration removed — RED issues now resolve
  // locally via VerbalAuthOverrideDialog inside IssueAccumulatorPanel. No
  // realtime escalation polling, no EscalationRehydrationGate, no waiting
  // panel branch.

  const { data: bundle, isLoading: isTripLoading } = useActiveTrip();

  const assetsQ = useQuery({
    queryKey: ["transport-assets"],
    queryFn: () => listTransportAssets(),
    staleTime: 5 * 60_000,
  });

  const userRole = typeof window !== "undefined" ? getActiveUserRole() : "driver";
  const currentDriverName = staffName(driverStaffId);

  const handleGlobalLogout = () => {
    if (typeof window !== "undefined") {
      try {
        localStorage.clear();
        sessionStorage.clear();
        void supabase.auth.signOut();
      } catch {
        // ignore cleanup errors
      }
    }
    manifestQueryClient.clear();
    void navigate({ to: "/auth", replace: true });
  };

  const isLoading = isTripLoading || assetsQ.isLoading;

  return (
    <div className="mx-auto flex h-[100dvh] max-w-md flex-col overflow-x-hidden bg-background">
      {/* Permanent Session Identity Header */}
      <div className="flex items-center justify-between border-b border-border bg-slate-900 px-4 py-2.5 text-xs text-white shrink-0 z-30 shadow-md">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn("h-2 w-2 rounded-full shrink-0", isLoading ? "bg-amber-500 animate-pulse" : "bg-green-500")}
          />
          <span className="text-slate-300 truncate">
            User: <b className="text-white font-semibold">{currentDriverName}</b>{" "}
            <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700 ml-1 uppercase font-mono tracking-wider text-blue-400">
              {userRole}
            </span>
          </span>
        </div>
        <button
          onClick={() => {
            if (
              confirm(
                "Are you sure you want to log out? Active server trips remain secure, but local setup memory will clear.",
              )
            ) {
              handleGlobalLogout();
            }
          }}
          className="flex items-center gap-1 font-bold text-red-400 hover:text-red-300 transition shrink-0 ml-2"
        >
          <LogOut className="h-3.5 w-3.5" /> Log Out
        </button>
      </div>

      {isLoading ? (
        <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground gap-3 bg-slate-950/10">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          <span className="text-sm font-medium tracking-wide">Synchronizing system manifest…</span>
        </div>
      ) : bundle ? (
        <ActiveTripScreen bundle={bundle} />
      ) : (
        <InitializeTripScreen fleetAssets={assetsQ.data ?? []} />
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

function InitializeTripScreen({ fleetAssets }: { fleetAssets: TransportAsset[] }) {
  const today = todayDateStr();
  const { data: lastEndOdo = null } = useLastEndOdometer();
  const driverStaffId = getStaffId() || DEFAULT_STAFF_UUID;
  const driverName = staffName(driverStaffId);

  // Global escalation/handshake locks removed — RED issues no longer take
  // over the wizard; the verbal-consultation dialog inside
  // IssueAccumulatorPanel records the workaround and lets the driver keep
  // rolling.

  // Standard setup configuration states
  const [step, setStep] = useState<InitStep>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("yada_init_step") as InitStep) || "vehicle";
    }
    return "vehicle";
  });
  const [assetId, setAssetId] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("yada_init_assetId") || "";
    }
    return "";
  });
  const [odo, setOdo] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("yada_init_odo") || "";
    }
    return "";
  });
  const [clearanceOk, setClearanceOk] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("yada_init_clearanceOk") === "true";
    }
    return false;
  });

  const hasHydratedOdoRef = useRef(false);

  useEffect(() => {
    if (hasHydratedOdoRef.current) return;
    if (lastEndOdo != null && odo === "") {
      setOdo(String(lastEndOdo));
      hasHydratedOdoRef.current = true;
    }
  }, [lastEndOdo, odo]);

  useEffect(() => {
    localStorage.setItem("yada_init_step", step);
  }, [step]);
  useEffect(() => {
    localStorage.setItem("yada_init_assetId", assetId);
  }, [assetId]);
  useEffect(() => {
    localStorage.setItem("yada_init_odo", odo);
  }, [odo]);
  useEffect(() => {
    localStorage.setItem("yada_init_clearanceOk", String(clearanceOk));
  }, [clearanceOk]);

  const activeAssets = useMemo(() => fleetAssets.filter((a) => a.isActive), [fleetAssets]);
  const selectedAsset = useMemo(() => activeAssets.find((a) => a.id === assetId) ?? null, [activeAssets, assetId]);

  const odoNum = odo === "" ? NaN : Number(odo);
  const odoReasonable = Number.isFinite(odoNum) && odoNum > 0 && odoNum < 10_000_000;

  const proceedToClearance = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsset || !odoReasonable) return;
    setStep("clearance");
  };

  // Multi-device handshake short-circuit branches removed.

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
                  <SelectValue placeholder="Today's vehicle…" />
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
                  Last recorded closing odometer: <span className="tabular-nums font-medium">{lastEndOdo} KM</span>
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
        <EventPickAndStart asset={selectedAsset} startOdometer={odoNum} onBack={() => setStep("clearance")} />
      )}
    </div>
  );
}

/* -------------------- Clearance Gate -------------------- */

interface ClearanceGateProps {
  asset: TransportAsset;
  startOdometer: number;
  dateStr: string;
  onCleared: () => void;
  onBack: () => void;
}

function ClearanceGate({
  asset,
  startOdometer,
  dateStr,
  onCleared,
  onBack,
}: ClearanceGateProps) {
  const existingQ = useQuery<AssetDailyClearance | null>({
    queryKey: ["asset-clearance", asset.id, dateStr],
    queryFn: () => getClearanceForAssetOnDate(asset.id, dateStr),
    staleTime: 30_000,
  });

  // Grounded lock: if a manager denied an escalation for this vehicle today,
  // refuse to render the walkaround form until the office clears it.
  const vehicleInfo = `${asset.name} · ${asset.regoPlate}`;
  const groundedQ = useQuery<boolean>({
    queryKey: ["asset-grounded", vehicleInfo, dateStr],
    queryFn: () => getAssetGroundedStatus(vehicleInfo, dateStr),
    staleTime: 30_000,
  });

  if (existingQ.isLoading || groundedQ.isLoading) {
    return (
      <Card className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking today's clearance…
      </Card>
    );
  }

  if (groundedQ.data === true) {
    return (
      <Card className="border-2 border-red-700 bg-red-600/10 p-5 text-red-900 dark:text-red-200">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-red-600" />
          <h2 className="text-lg font-extrabold text-red-700 dark:text-red-400">Vehicle Grounded</h2>
        </div>
        <p className="mt-2 text-sm font-medium">
          A manager has denied a clearance escalation for {asset.name} today. You cannot perform a new walkaround.
        </p>
        <p className="mt-2 text-xs opacity-80">
          This vehicle is locked out of service until the office manually inspects and overrides the status.
        </p>
        <Button onClick={onBack} variant="outline" className="w-full mt-5 border-red-700/50 hover:bg-red-700/20">
          ← Pick a different vehicle
        </Button>
      </Card>
    );
  }

  const existing = existingQ.data ?? null;

  if (existing && existing.status === "passed") {
    return <FastPassBanner asset={asset} clearance={existing} onConfirm={onCleared} onBack={onBack} />;
  }

  if (existing && existing.status === "failed") {
    return (
      <Card className="border-2 border-destructive/60 bg-destructive/5 p-5">
        <div className="flex items-center gap-2 text-destructive">
          <ShieldAlert className="h-5 w-5" />
          <h2 className="text-lg font-extrabold">Vehicle NOT cleared today</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {asset.name} ({asset.regoPlate}) failed today's walkaround. The coordinator must resolve the flagged
          checkpoints before this vehicle can be dispatched.
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
    <IssueAccumulatorGate
      asset={asset}
      startOdometer={startOdometer}
      dateStr={dateStr}
      onPassed={onCleared}
      onBack={onBack}
    />
  );
}

function IssueAccumulatorGate({
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
  const driverStaffId = getStaffId() || DEFAULT_STAFF_UUID;
  const driverName = staffName(driverStaffId);

  return (
    <IssueAccumulatorPanel
      asset={asset}
      startOdometer={startOdometer}
      dateStr={dateStr}
      checkpoints={[]}
      driverName={driverName}
      onCleared={onPassed}
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
  const parsed = clearance.createdAt ? new Date(clearance.createdAt) : null;
  const time =
    parsed && !isNaN(parsed.getTime())
      ? parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const driver = staffName(clearance.driverStaffId);

  return (
    <Card className="border-2 border-green-600 bg-green-600/10 p-5">
      <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
        <ShieldCheck className="h-6 w-6" />
        <h2 className="text-lg font-extrabold">Fast-Pass · Vehicle Cleared</h2>
      </div>
      <p className="mt-3 text-sm">
        <span className="font-semibold">{asset.name}</span> ({asset.regoPlate}) was cleared for service at{" "}
        <span className="font-mono font-semibold">{time}</span> by <span className="font-semibold">{driver}</span>.
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

/* -------------------- Walkaround Checklist (Legacy Backwards Compat) -------------------- */

interface ChecklistAnswer {
  passed: boolean;
  notes: string;
}

const SEATBELT_RX = /seat\s*belt|seatbelt/i;
const HOIST_RX = /hoist|wheelchair/i;

function isSeatbeltCheckpoint(c: AssetCheckpoint): boolean {
  return SEATBELT_RX.test(c.label);
}
function isHoistCheckpoint(c: AssetCheckpoint): boolean {
  return HOIST_RX.test(c.label);
}

// WalkaroundChecklist removed 2026-06-29 - contained a hardcoded '0000' manager
// override PIN that bypassed GUARDRAILS section 1.3 role verification. The
// active walkaround path is IssueAccumulatorPanel (via ClearanceGate).
// Tombstone preserves the removal record per the project's preservation policy.

/* -------------------- Event Picker + Start Trip -------------------- */

type Step3Tab = "daycentre" | "event";

function StartPointPicker({
  direction,
  depotAddress,
  centreAddress,
  choice,
  onChoiceChange,
  alternateAddress,
  onAlternateAddressChange,
}: {
  /** Morning defaults to Depot; afternoon home run defaults to Day Centre. */
  direction: "morning" | "afternoon";
  depotAddress: string;
  centreAddress: string;
  choice: StartPointChoice;
  onChoiceChange: (c: StartPointChoice) => void;
  alternateAddress: string;
  onAlternateAddressChange: (v: string) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftAlternate, setDraftAlternate] = useState("");

  const defaultChoice: StartPointChoice = direction === "morning" ? "depot" : "day_centre";

  const openAlternateDialog = () => {
    setDraftAlternate(alternateAddress);
    setDialogOpen(true);
  };

  const saveAlternate = () => {
    const trimmed = draftAlternate.trim();
    if (trimmed.length < 5) {
      toast.error("Enter a full street address for this trip.");
      return;
    }
    onAlternateAddressChange(trimmed);
    onChoiceChange("alternate");
    setDialogOpen(false);
  };

  const depotDisplay = depotAddress.trim() || "Not configured in Admin";
  const centreDisplay = centreAddress.trim() || "Not configured in Admin";
  const alternateDisplay = alternateAddress.trim();

  const optionClass = (selected: boolean) =>
    cn(
      "w-full rounded-xl border-2 px-4 py-3 text-left transition active:scale-[0.99]",
      selected
        ? "border-green-500 bg-green-600/25 shadow-sm shadow-green-900/30"
        : "border-border bg-card hover:border-green-400/60",
    );

  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold">Starting from</Label>

      <button
        type="button"
        onClick={() => onChoiceChange("depot")}
        className={optionClass(choice === "depot")}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold text-foreground">Depot</span>
          {choice === "depot" && (
            <span className="rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
              Selected
            </span>
          )}
          {choice !== "depot" && defaultChoice === "depot" && (
            <span className="text-[10px] font-medium text-muted-foreground">Default</span>
          )}
        </div>
        <p className="mt-1 text-sm leading-snug text-muted-foreground">{depotDisplay}</p>
      </button>

      <button
        type="button"
        onClick={() => onChoiceChange("day_centre")}
        className={optionClass(choice === "day_centre")}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold text-foreground">Day Centre</span>
          {choice === "day_centre" && (
            <span className="rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
              Selected
            </span>
          )}
          {choice !== "day_centre" && defaultChoice === "day_centre" && (
            <span className="text-[10px] font-medium text-muted-foreground">Default</span>
          )}
        </div>
        <p className="mt-1 text-sm leading-snug text-muted-foreground">{centreDisplay}</p>
      </button>

      <button
        type="button"
        onClick={() => {
          if (alternateDisplay) {
            onChoiceChange("alternate");
          } else {
            openAlternateDialog();
          }
        }}
        className={optionClass(choice === "alternate")}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold text-foreground">Other address (this trip only)</span>
          {choice === "alternate" && (
            <span className="rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
              Selected
            </span>
          )}
        </div>
        <p className="mt-1 text-sm leading-snug text-muted-foreground">
          {alternateDisplay || "Tap to enter a one-off starting address"}
        </p>
      </button>

      {choice === "alternate" && alternateDisplay && (
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={openAlternateDialog}>
          Edit alternate address
        </Button>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Alternate starting address</DialogTitle>
            <DialogDescription>
              For this trip only — e.g. bus parked at a staff home or temporary yard.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            value={draftAlternate}
            onChange={(e) => setDraftAlternate(e.target.value)}
            placeholder="Full street address"
            className="text-base"
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={saveAlternate}>
              Save &amp; use this address
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

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
  const startDayCentreRun = useStartDayCentreRun();
  const today = todayDateStr();

  // Derive today's day-of-week code (DAY-MON … DAY-SUN) from Sydney local time.
  const todayDayCode = useMemo(() => {
    const sydneyOffset = 10; // AEST (+10), DST not considered here — offset handles display
    const nowUtc = new Date();
    const sydneyMs = nowUtc.getTime() + sydneyOffset * 60 * 60 * 1000;
    const sydneyDate = new Date(sydneyMs);
    return dayCodeFromSydneyIndex(sydneyDate.getUTCDay());
  }, []);

  // Load bus run definitions so we can map codes → labels.
  const { data: busRunDefs = [] } = useLookupParameters(LOOKUP_CATEGORIES.busRun);
  const runLabels = useMemo(
    () => Object.fromEntries(busRunDefs.map((r) => [r.code, r.displayName])),
    [busRunDefs],
  );

  // Today's active bus run summaries (which runs have passengers today).
  const { data: todaysRuns = [] } = useTodaysBusRunSummaries(todayDayCode, runLabels);

  // BMS-style silent refresh: if the coordinator adds/removes a booking while
  // the driver is on the event-picker screen, the list updates in real time.
  useRealtimeInvalidate({
    table: "event_roster_bookings",
    queryKeys: [["events", "confirmed"]],
  });
  useRealtimeInvalidate({
    table: "participant_attendance_schedules",
    queryKeys: [["today-bus-run-summaries", todayDayCode]],
  });

  const todaysEvents = useMemo(
    () => events.filter((e) => e.startDate <= today && (e.endDate ?? e.startDate) >= today),
    [events, today],
  );

  // Always default to Day Centre Run — drivers use this almost exclusively.
  // The One-off Event tab remains accessible via the tab switcher.
  const [tab, setTab] = useState<Step3Tab>("daycentre");

  // Day Centre run state.
  const [selectedRun, setSelectedRun] = useState("");
  const [selectedDirection, setSelectedDirection] = useState<"morning" | "afternoon">("morning");
  const dcInFlightRef = useRef(false);

  // Event state.
  const [eventId, setEventId] = useState("");
  const eventInFlightRef = useRef(false);

  const defaultDepotAddress = useSystemParameter<string>("depot_address", "");
  const defaultCentreAddress = useSystemParameter<string>("day_centre_address", "");

  const [runStartChoice, setRunStartChoice] = useState<StartPointChoice>("depot");
  const [runAlternateAddress, setRunAlternateAddress] = useState("");
  const [eventStartChoice, setEventStartChoice] = useState<StartPointChoice>("depot");
  const [eventAlternateAddress, setEventAlternateAddress] = useState("");

  useEffect(() => {
    if (todaysRuns.length === 1) {
      setSelectedRun(todaysRuns[0]!.runCode);
      setSelectedDirection(todaysRuns[0]!.direction);
    }
  }, [todaysRuns]);

  useEffect(() => {
    setRunStartChoice(selectedDirection === "morning" ? "depot" : "day_centre");
    setRunAlternateAddress("");
  }, [selectedDirection]);

  useEffect(() => {
    setEventStartChoice("depot");
    setEventAlternateAddress("");
  }, [eventId]);

  const clearLocalStorage = () => {
    localStorage.removeItem("yada_init_step");
    localStorage.removeItem("yada_init_assetId");
    localStorage.removeItem("yada_init_odo");
    localStorage.removeItem("yada_init_clearanceOk");
  };

  // ── Day Centre Run submit ──────────────────────────────────────────────────
  const submitDayCentreRun = () => {
    if (!selectedRun || startDayCentreRun.isPending || dcInFlightRef.current) return;
    if (runStartChoice === "alternate" && !runAlternateAddress.trim()) {
      toast.error("Enter an alternate starting address first.");
      return;
    }
    dcInFlightRef.current = true;
    const runLabel = runLabels[selectedRun] ?? selectedRun;
    startDayCentreRun.mutate(
      {
        busRunCode: selectedRun,
        busRunLabel: runLabel,
        startOdometerKm: startOdometer,
        dayCode: todayDayCode,
        direction: selectedDirection,
        startPoint: runStartChoice,
        alternateStartAddress: runAlternateAddress.trim() || null,
        centreAddress: defaultCentreAddress.trim() || null,
        depotAddress: defaultDepotAddress.trim() || null,
      },
      {
        onSuccess: () => {
          clearLocalStorage();
          toast.success(`${runLabel} started`, { description: "Day Centre manifest is open." });
        },
        onSettled: () => { dcInFlightRef.current = false; },
      },
    );
  };

  // ── Event submit ───────────────────────────────────────────────────────────
  const submitEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId || startTrip.isPending || eventInFlightRef.current) return;
    if (eventStartChoice === "alternate" && !eventAlternateAddress.trim()) {
      toast.error("Enter an alternate starting address first.");
      return;
    }
    eventInFlightRef.current = true;
    startTrip.mutate(
      {
        eventId,
        startOdometerKm: startOdometer,
        varianceReason: null,
        startPoint: eventStartChoice,
        alternateStartAddress: eventAlternateAddress.trim() || null,
        depotAddress: defaultDepotAddress.trim() || null,
        centreAddress: defaultCentreAddress.trim() || null,
      },
      {
        onSuccess: () => {
          clearLocalStorage();
          toast.success("Daily run started", { description: "Manifest is now open." });
        },
        onSettled: () => { eventInFlightRef.current = false; },
      },
    );
  };

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
        <ShieldCheck className="h-5 w-5" />
        <h2 className="text-lg font-extrabold">{asset.name} cleared · start run</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Step 3 of 3 — choose your starting point, then open the manifest to run the route.
      </p>

      {/* Tab switcher */}
      <div className="mt-4 flex rounded-lg border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => setTab("daycentre")}
          className={cn(
            "flex-1 py-2 text-sm font-semibold transition",
            tab === "daycentre"
              ? "bg-blue-600 text-white"
              : "bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          Day Centre Run
          {todaysRuns.length > 0 && (
            <span className="ml-1.5 rounded-full bg-white/20 px-1.5 py-0.5 text-[11px] font-bold">
              {todaysRuns.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setTab("event")}
          className={cn(
            "flex-1 py-2 text-sm font-semibold transition",
            tab === "event"
              ? "bg-blue-600 text-white"
              : "bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          One-off Event
        </button>
      </div>

      {/* ── Day Centre Run tab ─────────────────────────────────────────────── */}
      {tab === "daycentre" && (
        <div className="mt-4 space-y-4">
          {todaysRuns.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
              No participants are scheduled for a Day Centre bus run today.
              <br />
              <span className="text-xs">
                Runs are configured in Admin → Day Centre Bus Runs.
              </span>
            </div>
          ) : todaysRuns.length > 1 ? (
            <div className="grid gap-2">
              <Label htmlFor="bus-run">Which run?</Label>
              <Select
                value={selectedRun && selectedDirection ? `${selectedRun}:${selectedDirection}` : ""}
                onValueChange={(v) => {
                  const [code, dir] = v.split(":");
                  setSelectedRun(code ?? "");
                  setSelectedDirection((dir as "morning" | "afternoon") ?? "morning");
                }}
              >
                <SelectTrigger id="bus-run" className="h-12">
                  <SelectValue placeholder="Select today's run…" />
                </SelectTrigger>
                <SelectContent>
                  {todaysRuns.map((run) => (
                    <SelectItem key={`${run.runCode}-${run.direction}`} value={`${run.runCode}:${run.direction}`}>
                      {run.runLabel} · {run.direction === "morning" ? "Morning" : "Afternoon Return"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm">
              <span className="font-semibold">{todaysRuns[0]!.runLabel}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {todaysRuns[0]!.direction === "morning" ? "Morning pickup" : "Afternoon return"}
              </span>
            </div>
          )}

          {/* Starting point — morning = Depot, afternoon home run = Day Centre */}
          <StartPointPicker
            direction={selectedDirection}
            depotAddress={defaultDepotAddress}
            centreAddress={defaultCentreAddress}
            choice={runStartChoice}
            onChoiceChange={setRunStartChoice}
            alternateAddress={runAlternateAddress}
            onAlternateAddressChange={setRunAlternateAddress}
          />

          <button
            type="button"
            disabled={!selectedRun || startDayCentreRun.isPending}
            onClick={submitDayCentreRun}
            className={cn(
              "h-14 w-full rounded-xl font-bold text-white shadow transition",
              !selectedRun || startDayCentreRun.isPending
                ? "bg-blue-600 opacity-60 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700",
            )}
          >
            {startDayCentreRun.isPending ? "Opening…" : "Start Day Centre Run & Open Manifest"}
          </button>
        </div>
      )}

      {/* ── Event tab ─────────────────────────────────────────────────────── */}
      {tab === "event" && (
        <form onSubmit={submitEvent} className="mt-4 space-y-4">
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

          <StartPointPicker
            direction="morning"
            depotAddress={defaultDepotAddress}
            centreAddress={defaultCentreAddress}
            choice={eventStartChoice}
            onChoiceChange={setEventStartChoice}
            alternateAddress={eventAlternateAddress}
            onAlternateAddressChange={setEventAlternateAddress}
          />

          <button
            type="submit"
            disabled={!eventId || startTrip.isPending}
            className={cn(
              "h-14 w-full rounded-xl font-bold text-white shadow transition",
              !eventId || startTrip.isPending
                ? "bg-blue-600 opacity-60 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700",
            )}
          >
            {startTrip.isPending ? "Opening…" : "Start Daily Trip & Open Manifest"}
          </button>
        </form>
      )}

      <button
        type="button"
        onClick={onBack}
        className="mt-3 h-10 w-full rounded-xl text-sm font-semibold text-muted-foreground transition hover:text-foreground"
      >
        ← Back to clearance
      </button>
    </Card>
  );
}

/* -------------------- Active Trip -------------------- */

interface ActiveTripScreenProps {
  bundle: ActiveTripBundle;
}

const ACTIVE_TRIP_QUERY_KEY = ["transport_trips", "active"] as const;

function ActiveTripScreen({ bundle }: ActiveTripScreenProps) {
  const { trip, legs } = bundle;
  const reorderPickups = useReorderTripPickupLegs();
  const activeLeg = legs.find((l) => l.status !== "completed") ?? null;
  const completedCount = legs.filter((l) => l.status === "completed").length;
  const allLegsComplete = activeLeg == null;
  const totalKm = legs.reduce((sum, l) => sum + (l.loggedDistanceKm ?? l.gpsDistanceKm ?? 0), 0);
  const { requestCancel, dialog: pickupCancelDialog, isCancelling } = usePickupCancelDialog(trip.id);

  const completedPickupCount = useMemo(
    () => legs.filter((l) => isPassengerPickupLeg(l) && l.status === "completed").length,
    [legs],
  );
  const completedLegs = useMemo(
    () => legs.filter((l) => l.status === "completed").sort((a, b) => a.legIndex - b.legIndex),
    [legs],
  );
  const pendingPickups = useMemo(
    () =>
      legs
        .filter((l) => isPassengerPickupLeg(l) && l.status === "pending")
        .sort((a, b) => a.legIndex - b.legIndex),
    [legs],
  );
  const pendingPickupIds = pendingPickups.map((l) => l.id);
  const pendingPickupMap = useMemo(() => new Map(pendingPickups.map((l) => [l.id, l])), [pendingPickups]);

  const activeIsPendingPickup =
    activeLeg != null && isPassengerPickupLeg(activeLeg) && activeLeg.status === "pending";
  const activeInProgress =
    activeLeg != null && (activeLeg.status === "en_route" || activeLeg.status === "arrived");

  const upcomingStaticLegs = useMemo(() => {
    if (!activeLeg) return [];
    const pendingPickupIdSet = new Set(pendingPickupIds);
    return legs.filter(
      (l) =>
        l.status !== "completed" &&
        l.id !== activeLeg.id &&
        !pendingPickupIdSet.has(l.id),
    );
  }, [activeLeg, legs, pendingPickupIds]);

  const [localPickupOrder, setLocalPickupOrder] = useState<string[]>([]);
  useEffect(() => {
    setLocalPickupOrder([]);
  }, [pendingPickupIds.join("|")]);

  const sortablePickupIds =
    localPickupOrder.length === pendingPickupIds.length ? localPickupOrder : pendingPickupIds;

  const displayLegForPendingOrder = (leg: TripLeg, orderedPendingIds: string[]): TripLeg => {
    const ep = computePickupChainEndpoints(trip, legs, orderedPendingIds).get(leg.id);
    return ep ? { ...leg, ...ep } : leg;
  };

  const applyPickupReorder = (nextIds: string[]) => {
    setLocalPickupOrder(nextIds);
    reorderPickups.mutate(
      { tripId: trip.id, orderedLegIds: nextIds },
      {
        onSuccess: () => toast.success("Pickup order updated"),
        onSettled: () => setLocalPickupOrder([]),
      },
    );
  };

  const startAddressForLeg = (leg: TripLeg) =>
    leg.legKind === "depot_to_client" && leg.toParticipantId != null ? trip.originAddress : null;

  // BMS-style silent refresh:
  useRealtimeInvalidate({ table: "trip_legs", queryKeys: [ACTIVE_TRIP_QUERY_KEY] });
  useRealtimeInvalidate({ table: "transport_trips", queryKeys: [ACTIVE_TRIP_QUERY_KEY] });

  const activeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (activeRef.current) activeRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeLeg?.id]);

  const prevLegIdsRef = useRef<string[]>(legs.map((l) => l.id));
  useEffect(() => {
    const currentIds = new Set(legs.map((l) => l.id));
    const dropped = prevLegIdsRef.current.filter((id) => !currentIds.has(id));
    if (dropped.length > 0) {
      toast.info("Coordinator updated your manifest", {
        description: `${dropped.length} stop${dropped.length === 1 ? "" : "s"} rerouted to alternative transport Simon.`,
      });
    }
    prevLegIdsRef.current = legs.map((l) => l.id);
  }, [legs]);

  const renderActiveCard = (
    leg: TripLeg,
    outerRef?: (el: HTMLDivElement | null) => void,
    drag?: PickupDragBind,
    displayLeg?: TripLeg,
  ) => {
    const shown = displayLeg ?? leg;
    return (
      <div
        ref={(el) => {
          activeRef.current = el;
          outerRef?.(el);
        }}
      >
        <ActiveLegCard
          leg={shown}
          startAddress={startAddressForLeg(shown)}
          onCancelPickup={canCancelPickupLeg(leg) ? () => requestCancel(leg) : undefined}
          cancelDisabled={isCancelling}
          drag={drag}
        />
      </div>
    );
  };

  const renderUpcomingPickupRow = (
    leg: TripLeg,
    stopNumber: number,
    drag?: PickupDragBind,
    displayLeg?: TripLeg,
  ) => (
    <LegRow
      key={leg.id}
      leg={displayLeg ?? leg}
      stopNumber={stopNumber}
      drag={drag}
      onCancelPickup={requestCancel}
      cancelDisabled={isCancelling || reorderPickups.isPending}
    />
  );

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-border bg-slate-900 text-white">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="min-w-0 flex-1 pr-3">
            <div className="truncate text-base font-bold leading-tight">{bundle.eventTitle ?? "Daily Run"}</div>
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

      <main className="flex-1 overflow-y-auto px-3 pb-4 pt-3 space-y-2">
        {completedLegs.map((l) => (
          <LegRow key={l.id} leg={l} locked />
        ))}

        {activeLeg && !activeIsPendingPickup && renderActiveCard(activeLeg)}

        {activeIsPendingPickup && pendingPickups.length > 0 && (
          <>
            {pendingPickups.length >= 2 ? (
              <PointerSortableList
                itemIds={sortablePickupIds}
                onReorder={applyPickupReorder}
                disabled={reorderPickups.isPending || isCancelling}
              >
                {({ ids, bindRow }) => (
                  <div className="space-y-2">
                    {ids.map((id, index) => {
                      const leg = pendingPickupMap.get(id);
                      if (!leg) return null;
                      const bind = bindRow(id);
                      const displayLeg = displayLegForPendingOrder(leg, ids);
                      if (index === 0) {
                        return (
                          <div key={id}>{renderActiveCard(leg, bind.rowRef, bind, displayLeg)}</div>
                        );
                      }
                      return renderUpcomingPickupRow(leg, completedPickupCount + index + 1, bind, displayLeg);
                    })}
                  </div>
                )}
              </PointerSortableList>
            ) : (
              renderActiveCard(
                pendingPickups[0]!,
                undefined,
                undefined,
                displayLegForPendingOrder(pendingPickups[0]!, pendingPickupIds),
              )
            )}
          </>
        )}

        {activeInProgress && pendingPickups.length >= 2 && (
          <div className="space-y-2">
            <div className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Upcoming stops — drag to reorder
            </div>
            <PointerSortableList
              itemIds={sortablePickupIds}
              onReorder={applyPickupReorder}
              disabled={reorderPickups.isPending || isCancelling}
            >
              {({ ids, bindRow }) => (
                <div className="space-y-2">
                  {ids.map((id, index) => {
                    const leg = pendingPickupMap.get(id);
                    if (!leg) return null;
                    return renderUpcomingPickupRow(
                      leg,
                      completedPickupCount + index + 2,
                      bindRow(id),
                      displayLegForPendingOrder(leg, ids),
                    );
                  })}
                </div>
              )}
            </PointerSortableList>
          </div>
        )}

        {activeInProgress && pendingPickups.length === 1 && (
          renderUpcomingPickupRow(
            pendingPickups[0]!,
            completedPickupCount + 2,
            undefined,
            displayLegForPendingOrder(pendingPickups[0]!, pendingPickupIds),
          )
        )}

        {!activeLeg && (
          <Card className="border-2 border-green-600 bg-green-600/10 p-4 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-green-600" />
            <div className="mt-2 text-lg font-bold">All legs completed</div>
            <div className="text-sm text-muted-foreground">Finalize the shift below.</div>
          </Card>
        )}

        {upcomingStaticLegs.map((l) => (
          <LegRow key={l.id} leg={l} onCancelPickup={canCancelPickupLeg(l) ? requestCancel : undefined} cancelDisabled={isCancelling} />
        ))}
      </main>

      {pickupCancelDialog}

      <footer className="sticky bottom-0 z-20 space-y-3 border-t border-border bg-card p-3 pb-[env(safe-area-inset-bottom)]">
        {allLegsComplete ? (
          <FinalizeShiftCard tripId={trip.id} startOdometer={trip.startOdometerKm} />
        ) : (
          <div className="text-center text-xs text-muted-foreground">
            Drag upcoming stops to reorder · tap Depart Stop when ready.
          </div>
        )}
        <CancelTripButton tripId={trip.id} />
      </footer>
    </>
  );
}

function LegRow({
  leg,
  onCancelPickup,
  cancelDisabled,
  stopNumber,
  drag,
  locked,
}: {
  leg: TripLeg;
  onCancelPickup?: (leg: TripLeg) => void;
  cancelDisabled?: boolean;
  stopNumber?: number;
  drag?: PickupDragBind;
  locked?: boolean;
}) {
  const done = leg.status === "completed";
  const showCancel = !done && !locked && onCancelPickup && canCancelPickupLeg(leg);
  const label = stopNumber != null ? `Stop ${stopNumber}` : `Leg ${leg.legIndex}`;

  return (
    <Card
      ref={drag?.rowRef}
      data-sort-id={drag ? leg.id : undefined}
      className={cn(
        "flex items-center justify-between gap-3 p-3 text-sm",
        drag?.isDragging && "z-10 opacity-90 shadow-lg ring-2 ring-blue-400",
        done
          ? "border-green-600/40 bg-green-600/5"
          : locked || !drag
            ? "border-border bg-card"
            : "border-border bg-card touch-manipulation select-none",
      )}
    >
      {drag && (
        <button
          type="button"
          className={cn(
            "flex h-10 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground",
            cancelDisabled ? "cursor-not-allowed opacity-50" : "cursor-grab active:cursor-grabbing",
          )}
          aria-label="Drag to reorder stop"
          disabled={cancelDisabled}
          onPointerDown={drag.onGripPointerDown}
        >
          <GripVertical className="h-5 w-5" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="truncate font-medium">
          {leg.fromLabel} <span className="text-muted-foreground">→</span> {leg.toLabel}
        </div>
        {leg.targetAddress && (
          <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{leg.targetAddress}</span>
          </div>
        )}
        {done && leg.passengerPresent === false && (
          <div className="mt-0.5 text-[10px] font-medium uppercase text-amber-600">
            Cancelled / no pickup
          </div>
        )}
      </div>
      {done ? (
        <div className="flex shrink-0 items-center gap-1 text-xs font-semibold text-green-600">
          <CheckCircle2 className="h-4 w-4" />
          {(leg.loggedDistanceKm ?? leg.gpsDistanceKm ?? 0).toFixed(1)} km
        </div>
      ) : showCancel ? (
        <PickupCancelButton
          size="sm"
          onClick={() => onCancelPickup!(leg)}
          disabled={cancelDisabled}
        />
      ) : (
        <div className="shrink-0 text-xs uppercase tracking-wider text-muted-foreground">Upcoming</div>
      )}
    </Card>
  );
}

/* -------------------- Active Leg -------------------- */

function ActiveLegCard({
  leg,
  startAddress,
  onCancelPickup,
  cancelDisabled,
  drag,
}: {
  leg: TripLeg;
  startAddress?: string | null;
  onCancelPickup?: () => void;
  cancelDisabled?: boolean;
  drag?: PickupDragBind;
}) {
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
          leg.startLat != null && leg.startLng != null ? haversineKm({ lat: leg.startLat, lng: leg.startLng }, pos) : 0;
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
    <Card
      className={cn(
        "relative rounded-xl border-2 border-blue-500 bg-slate-900 p-4 text-white",
        drag?.isDragging && "z-10 opacity-90 shadow-lg ring-2 ring-blue-300",
      )}
    >
      {drag && (
        <button
          type="button"
          className={cn(
            "absolute left-3 top-3 z-10 flex h-9 w-8 items-center justify-center rounded-md text-slate-400",
            cancelDisabled ? "cursor-not-allowed opacity-50" : "cursor-grab active:cursor-grabbing",
          )}
          aria-label="Drag to reorder stop"
          disabled={cancelDisabled}
          onPointerDown={drag.onGripPointerDown}
        >
          <GripVertical className="h-5 w-5" />
        </button>
      )}
      {onCancelPickup && (
        <div className="absolute right-3 top-3 z-10">
          <PickupCancelButton onClick={onCancelPickup} disabled={cancelDisabled} />
        </div>
      )}
      <div
        className={cn(
          "flex items-center gap-2 pr-10 text-[11px] font-bold uppercase tracking-wider text-blue-300",
          drag && "pl-10",
        )}
      >
        <Navigation className="h-3.5 w-3.5" /> Active leg {leg.legIndex}
      </div>
      <div className="mt-1 flex items-start gap-2">
        <MapPin className="mt-1 h-5 w-5 shrink-0 text-blue-300" />
        <div className="min-w-0">
          <div className="truncate text-lg font-bold leading-tight">{leg.fromLabel}</div>
          {startAddress && (
            <div className="mt-0.5 flex items-start gap-1.5 text-xs text-slate-300">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-300" />
              <span className="break-words">{startAddress}</span>
            </div>
          )}
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
  const storageKey = `yada_leg_form_${leg.id}`;

  const [formState, setFormState] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (_) {}
      }
    }
    return {
      loggedKm: String(leg.loggedDistanceKm ?? leg.gpsDistanceKm ?? 0),
      present: leg.passengerPresent ?? true,
      medStatus: leg.medicationHandoverStatus ?? (leg.medicationHandoverConfirmed ? "collected_intact" : null),
      extraMed: leg.unexpectedMedicationLogged ?? false,
      extraNotes: leg.unexpectedMedicationNotes ?? "",
    };
  });

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(formState));
  }, [formState, storageKey]);

  const { loggedKm, present, medStatus, extraMed, extraNotes } = formState;
  const [showNoShow, setShowNoShow] = useState(false);

  const participantId = leg.toParticipantId ?? leg.fromParticipantId;
  const participantName = leg.toParticipantId ? leg.toLabel : leg.fromLabel;

  const expectedMedSatisfied =
    medStatus === "collected_intact" || medStatus === "collected_damaged" || medStatus === "expected_not_provided";

  const exceptionFlagged = medStatus === "collected_damaged" || medStatus === "expected_not_provided";

  const blocked =
    !loggedKm ||
    Number.isNaN(Number(loggedKm)) ||
    (leg.medicationExpected && !expectedMedSatisfied) ||
    (extraMed && extraNotes.trim().length < 3);

  const updateField = (field: string, value: any) => {
    setFormState((prev: any) => ({ ...prev, [field]: value }));
  };

  const confirm = async () => {
    try {
      await patch.mutateAsync({
        legId: leg.id,
        patch: {
          status: "completed",
          loggedDistanceKm: Number(loggedKm),
          passengerPresent: present,
          medicationHandoverStatus: leg.medicationExpected
            ? medStatus
            : "not_required",
          medicationHandoverConfirmed:
            leg.medicationExpected &&
            (medStatus === "collected_intact" || medStatus === "collected_damaged"),
          unexpectedMedicationLogged: extraMed,
          unexpectedMedicationNotes: extraMed ? extraNotes.trim() : null,
          completedAt: new Date().toISOString(),
        },
      });
      // Parallel RED escalation — runs after boarding completes.
      // GUARDRAILS §1.1: failure is surfaced to the operator, not swallowed.
      if (extraMed && participantId) {
        raiseUnexpectedMedBagIssue({
          participantId,
          participantName: participantName ?? null,
          context: "transport",
          referenceId: leg.id,
          notes: extraNotes.trim() || null,
        }).catch((e) => {
          console.error("[ArrivedChecklist] unexpected med escalation failed", e);
          toast.error("Unexpected med-bag: escalation failed — manual log required", {
            description: (e as Error).message ?? "Ledger write failed. Contact your coordinator immediately.",
          });
        });
      }
      localStorage.removeItem(storageKey);
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
        <Label htmlFor="kmlog" className="text-slate-200">
          Logged Leg Kilometers (GPS)
        </Label>
        <Input
          id="kmlog"
          type="number"
          inputMode="decimal"
          className="h-12 bg-slate-950 text-base tabular-nums text-white"
          value={loggedKm}
          onChange={(e) => updateField("loggedKm", e.target.value)}
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2">
        <div>
          <div className="text-sm font-semibold">Passenger Present &amp; Boarded</div>
          <div className="text-xs text-slate-400">Toggle off to escalate as no-show.</div>
        </div>
        <Switch checked={present} onCheckedChange={(v) => updateField("present", v)} />
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
          <div className="mb-3 flex items-start gap-2 text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="text-sm font-semibold">
              Expected medication on this client — confirm bag status before departure.
            </div>
          </div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Medication Bag Handover
          </div>
          <RadioGroup
            value={medStatus ?? ""}
            onValueChange={(v) => updateField("medStatus", v as MedicationHandoverStatus)}
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
              <span>Manager exception flag will be recorded against this leg.</span>
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={extraMed} onCheckedChange={(v) => updateField("extraMed", v === true)} />
          <span className="font-medium">
            <Pill className="mr-1 inline h-4 w-4 text-blue-300" />➕ Log Unexpected Medication Bag Received
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
              onChange={(e) => updateField("extraNotes", e.target.value)}
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
    complete.mutate({ tripId, endOdometerKm: Number(odo) }, { onSuccess: () => toast.success("Daily run locked.") });
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

/* -------------------- Cancel/Reset Trip -------------------- */

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
            Logged kilometres and leg captures will be discarded. This cannot be undone. You'll return to the event
            selection screen.
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
