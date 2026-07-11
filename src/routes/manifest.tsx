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
  Users,
  UserCheck,
  Bus,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumericEntryTrigger } from "@/components/ui/numeric-entry-dialog";
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
  useCancelTrip,
  useManifestPickerEvents,
  useLastEndOdometer,
  useLookupParameters,
  useReorderTripPickupLegs,
} from "@/hooks/use-supabase-data";

import { NoShowCountdownModal } from "@/components/attendance/no-show-countdown-modal";
import { haversineKm, getCurrentPosition } from "@/lib/geo";
import { cn, todayLocalIso, eventSpansDate } from "@/lib/utils";
import { triggerInspectionAlert, toSeverity } from "@/hooks/use-notification-router";
import type {
  TripLeg,
  TransportTrip,
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
  resolveStaffIdWithFallback,
} from "@/lib/data-store";
import { IssueAccumulatorPanel } from "@/components/manifest/issue-accumulator-panel";
import { CloseRunCard } from "@/components/manifest/close-run-card";
import { ManifestRouteMap } from "@/components/manifest/manifest-route-map";
import { MobileFieldButton, MobileOptionButton } from "@/components/manifest/mobile-field-button";
// RedHandshakeWaitingPanel + multi-device handshake removed — RED now flows
// through VerbalConsultationDialog inside IssueAccumulatorPanel.
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
import { writeToLedger } from "@/lib/api/ledger";
import { raiseUnsafeDropHubIssue } from "@/lib/api/transport-unsafe-drop";
import { VerbalConsultationDialog, formatVerbalWorkaroundDescription } from "@/components/issue-engine/verbal-consultation-dialog";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { LOOKUP_CATEGORIES } from "@/lib/data-store";
import { dayCodeFromSydneyIndex } from "@/lib/api/centre-hours";
import { getLastItineraryStopForDate } from "@/lib/api/event-outing";
import { useSystemParameter } from "@/hooks/use-system-parameters";
import {
  canCancelPickupLeg,
  isPassengerPickupLeg,
  PickupCancelButton,
  PointerSortableList,
  PICKUP_DRAG_GRIP_CLASS,
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
  // locally via VerbalConsultationDialog inside IssueAccumulatorPanel. No
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

function staffName(staffId: string): string {
  return STAFF_DIRECTORY.find((s) => s.id === staffId)?.name ?? "Driver";
}

function InitializeTripScreen({ fleetAssets }: { fleetAssets: TransportAsset[] }) {
  const today = todayLocalIso();
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
          <form onSubmit={proceedToClearance} className="mt-5 space-y-5">
            <div className="grid gap-2">
              <Label>Select Vehicle</Label>
              {activeAssets.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  No active vehicles in the fleet — add one in Admin first.
                </p>
              ) : (
                <div className="space-y-2">
                  {activeAssets.map((a) => (
                    <MobileFieldButton
                      key={a.id}
                      title={a.name}
                      subtitle={`${a.regoPlate} · ${a.passengerCapacity} seats${
                        a.makeModel ? ` · ${a.makeModel}` : ""
                      }`}
                      icon={<Bus className="h-5 w-5" />}
                      tone="info"
                      active={assetId === a.id}
                      onClick={() => setAssetId(a.id)}
                      className="min-h-[4.5rem] py-4"
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="grid gap-2">
              <NumericEntryTrigger
                id="odo"
                label="Starting odometer"
                value={odo}
                onChange={setOdo}
                placeholder="Tap to enter starting km"
                title="Starting odometer"
                description={
                  lastEndOdo != null
                    ? `Last closing reading was ${lastEndOdo} km. Enter today's start reading.`
                    : "Enter the odometer reading where the bus is parked."
                }
                step={1}
                allowDecimal={false}
                min={1}
                unit="km"
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
  heading = "Starting from",
  alternateHeading = "Other address (this trip only)",
  alternateDescription = "Tap to enter a one-off starting address",
}: {
  /** Morning defaults to Depot; afternoon home run defaults to Day Centre. */
  direction: "morning" | "afternoon";
  depotAddress: string;
  centreAddress: string;
  choice: StartPointChoice;
  onChoiceChange: (c: StartPointChoice) => void;
  alternateAddress: string;
  onAlternateAddressChange: (v: string) => void;
  heading?: string;
  alternateHeading?: string;
  alternateDescription?: string;
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
        ? "border-success bg-success text-success-foreground shadow-md ring-2 ring-success/40"
        : "border-border bg-card text-foreground hover:border-success/50",
    );

  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold">{heading}</Label>

      <button
        type="button"
        onClick={() => onChoiceChange("depot")}
        className={optionClass(choice === "depot")}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold">Depot</span>
          {choice === "depot" && (
            <span className="rounded-full bg-success-foreground/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
              Selected
            </span>
          )}
          {choice !== "depot" && defaultChoice === "depot" && (
            <span className="text-[10px] font-medium text-muted-foreground">Default</span>
          )}
        </div>
        <p
          className={cn(
            "mt-1 text-sm leading-snug",
            choice === "depot" ? "opacity-95" : "text-muted-foreground",
          )}
        >
          {depotDisplay}
        </p>
      </button>

      <button
        type="button"
        onClick={() => onChoiceChange("day_centre")}
        className={optionClass(choice === "day_centre")}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold">Day Centre</span>
          {choice === "day_centre" && (
            <span className="rounded-full bg-success-foreground/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
              Selected
            </span>
          )}
          {choice !== "day_centre" && defaultChoice === "day_centre" && (
            <span className="text-[10px] font-medium text-muted-foreground">Default</span>
          )}
        </div>
        <p
          className={cn(
            "mt-1 text-sm leading-snug",
            choice === "day_centre" ? "opacity-95" : "text-muted-foreground",
          )}
        >
          {centreDisplay}
        </p>
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
          <span className="font-bold">{alternateHeading}</span>
          {choice === "alternate" && (
            <span className="rounded-full bg-success-foreground/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
              Selected
            </span>
          )}
        </div>
        <p
          className={cn(
            "mt-1 text-sm leading-snug",
            choice === "alternate" ? "opacity-95" : "text-muted-foreground",
          )}
        >
          {alternateDisplay || alternateDescription}
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

type ReturnDepartChoice = "last_itinerary_stop" | "alternate";

/** Return run: where the bus is parked when the home run starts (§12.4.3a). */
function ReturnDepartFromPicker({
  lastStop,
  choice,
  onChoiceChange,
  alternateAddress,
  onAlternateAddressChange,
  loading,
}: {
  lastStop: { label: string; streetAddress: string | null } | null;
  choice: ReturnDepartChoice;
  onChoiceChange: (c: ReturnDepartChoice) => void;
  alternateAddress: string;
  onAlternateAddressChange: (v: string) => void;
  loading?: boolean;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftAlternate, setDraftAlternate] = useState("");

  const optionClass = (selected: boolean) =>
    cn(
      "w-full rounded-xl border-2 px-4 py-3 text-left transition active:scale-[0.99] touch-manipulation",
      selected
        ? "border-green-500 bg-green-600/25 shadow-sm shadow-green-900/30"
        : "border-border bg-card hover:border-green-400/60",
    );

  const openAlternateDialog = () => {
    setDraftAlternate(alternateAddress);
    setDialogOpen(true);
  };

  const saveAlternate = () => {
    const trimmed = draftAlternate.trim();
    if (trimmed.length < 5) {
      toast.error("Enter the full street address where the bus is parked.");
      return;
    }
    onAlternateAddressChange(trimmed);
    onChoiceChange("alternate");
    setDialogOpen(false);
  };

  const alternateDisplay = alternateAddress.trim();
  const lastStopAddress = lastStop?.streetAddress?.trim() || "Address not on file — add in Venue registry or use Other address.";

  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold">Bus is at (return run starts here)</Label>
      <p className="text-xs text-muted-foreground">
        Odometer reading is taken here. Defaults to the last stop on today&apos;s itinerary.
      </p>

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : lastStop ? (
        <button
          type="button"
          onClick={() => onChoiceChange("last_itinerary_stop")}
          className={optionClass(choice === "last_itinerary_stop")}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-foreground">Last stop on itinerary</span>
            {choice === "last_itinerary_stop" && (
              <span className="rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                Selected
              </span>
            )}
            {choice !== "last_itinerary_stop" && (
              <span className="text-[10px] font-medium text-muted-foreground">Recommended</span>
            )}
          </div>
          <p className="mt-1 text-sm font-medium leading-snug">{lastStop.label}</p>
          <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{lastStopAddress}</p>
        </button>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          No itinerary stops for this day — use Other address below or add stops on the event Itinerary tab.
        </p>
      )}

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
          {alternateDisplay || "Bus parked somewhere else — tap to enter address"}
        </p>
      </button>

      {choice === "alternate" && alternateDisplay && (
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={openAlternateDialog}>
          Edit address
        </Button>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Where is the bus parked?</DialogTitle>
            <DialogDescription>
              Full street address for this return run only — e.g. if the bus moved after the last stop.
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
  const today = todayLocalIso();
  const { data: picker = { events: [], todaySessionEventIds: [] } } = useManifestPickerEvents(today);
  const events = picker.events;
  const todaySessionEventIds = useMemo(
    () => new Set(picker.todaySessionEventIds),
    [picker.todaySessionEventIds],
  );
  const startTrip = useStartTrip();
  const startDayCentreRun = useStartDayCentreRun();

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
    queryKeys: [["events", "manifest-picker"], ["events", "confirmed"]],
  });
  useRealtimeInvalidate({
    table: "event_manifest",
    queryKeys: [["events", "manifest-picker"], ["events", "confirmed"]],
  });
  useRealtimeInvalidate({
    table: "event_day_sessions",
    queryKeys: [["events", "manifest-picker"], ["events", "confirmed"]],
  });
  useRealtimeInvalidate({
    table: "participant_attendance_schedules",
    queryKeys: [["today-bus-run-summaries", todayDayCode]],
  });

  const todaysEvents = useMemo(
    () =>
      events.filter(
        (e) => eventSpansDate(e.startDate, e.endDate, today) || todaySessionEventIds.has(e.id),
      ),
    [events, today, todaySessionEventIds],
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
  const [eventRunDirection, setEventRunDirection] = useState<"outbound" | "return">("outbound");
  const eventInFlightRef = useRef(false);

  const defaultDepotAddress = useSystemParameter<string>("depot_address", "");
  const defaultCentreAddress = useSystemParameter<string>("day_centre_address", "");

  const [runStartChoice, setRunStartChoice] = useState<StartPointChoice>("depot");
  const [runAlternateAddress, setRunAlternateAddress] = useState("");
  const [eventStartChoice, setEventStartChoice] = useState<StartPointChoice>("depot");
  const [eventAlternateAddress, setEventAlternateAddress] = useState("");
  const [returnDepartChoice, setReturnDepartChoice] = useState<ReturnDepartChoice>("last_itinerary_stop");
  const [returnDepartAlternate, setReturnDepartAlternate] = useState("");

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
    setEventRunDirection("outbound");
    setReturnDepartChoice("last_itinerary_stop");
    setReturnDepartAlternate("");
  }, [eventId]);

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === eventId) ?? null,
    [events, eventId],
  );

  const returnSessionDate = useMemo(() => {
    if (!selectedEvent) return today;
    const start = selectedEvent.startDate;
    const end = selectedEvent.endDate ?? start;
    if (eventSpansDate(start, end, today) || todaySessionEventIds.has(selectedEvent.id)) {
      return today;
    }
    return start;
  }, [selectedEvent, today, todaySessionEventIds]);

  const { data: lastItineraryStop, isLoading: lastStopLoading } = useQuery({
    queryKey: ["event-last-itinerary-stop", eventId, returnSessionDate],
    queryFn: () => getLastItineraryStopForDate(eventId, returnSessionDate),
    enabled: !!eventId && eventRunDirection === "return",
    staleTime: 30_000,
  });

  useEffect(() => {
    if (eventRunDirection !== "return") return;
    if (lastItineraryStop) {
      setReturnDepartChoice("last_itinerary_stop");
    } else if (!lastStopLoading) {
      setReturnDepartChoice("alternate");
    }
  }, [eventRunDirection, lastItineraryStop, lastStopLoading]);

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

  // ── Derived: selected event + inferred kind ────────────────────────────────
  // Show direction picker for ANY selected event — every event run can be
  // outbound (bus stays at venue) or return (separate home run).  Inferred
  // outing kind only affects UI label; non-outing events default "outbound".
  const showDirectionPicker = !!selectedEvent;
  const eventTransportBlocked =
    selectedEvent?.status === "Planning" || selectedEvent?.status === "Closed";

  // ── Event submit ───────────────────────────────────────────────────────────
  const submitEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId || startTrip.isPending || eventInFlightRef.current) return;
    if (selectedEvent?.status === "Planning") {
      toast.error("Event is still Planning — promote to Confirmed in Events first.");
      return;
    }
    if (selectedEvent?.status === "Closed") {
      toast.error("This event is closed — transport runs cannot be started.");
      return;
    }
    if (eventStartChoice === "alternate" && !eventAlternateAddress.trim()) {
      toast.error("Enter an alternate starting address first.");
      return;
    }
    if (eventRunDirection === "return") {
      if (returnDepartChoice === "alternate" && !returnDepartAlternate.trim()) {
        toast.error("Enter where the bus is parked for this return run.");
        return;
      }
      if (returnDepartChoice === "last_itinerary_stop" && !lastItineraryStop) {
        toast.error("No itinerary stop for this day — use Other address for bus location.");
        return;
      }
    }
    eventInFlightRef.current = true;
    startTrip.mutate(
      {
        eventId,
        startOdometerKm: startOdometer,
        varianceReason: null,
        tripDirection: eventRunDirection,
        startPoint: eventStartChoice,
        alternateStartAddress: eventAlternateAddress.trim() || null,
        depotAddress: defaultDepotAddress.trim() || null,
        centreAddress: defaultCentreAddress.trim() || null,
        returnSessionDate,
        returnDepartPoint: eventRunDirection === "return" ? returnDepartChoice : undefined,
        returnDepartLabel:
          eventRunDirection === "return" && returnDepartChoice === "last_itinerary_stop"
            ? lastItineraryStop?.label ?? null
            : eventRunDirection === "return" && returnDepartChoice === "alternate"
              ? "Starting point"
              : null,
        returnDepartAddress:
          eventRunDirection === "return"
            ? returnDepartChoice === "last_itinerary_stop"
              ? lastItineraryStop?.streetAddress ?? null
              : returnDepartAlternate.trim() || null
            : null,
      },
      {
        onSuccess: () => {
          clearLocalStorage();
          const dirLabel = eventRunDirection === "outbound" ? "Outbound run started" : "Return run started";
          toast.success(dirLabel, { description: "Manifest is now open." });
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
                    {e.status === "Planning" ? " (Planning — confirm first)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {eventTransportBlocked && (
            <div className="flex gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                {selectedEvent?.status === "Planning" ? (
                  <>
                    <p className="font-semibold">Event still in Planning</p>
                    <p className="mt-0.5 text-xs opacity-90">
                      A coordinator must promote this event to <strong>Confirmed</strong> in Events before
                      you can start an outbound or return run.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold">Event is closed</p>
                    <p className="mt-0.5 text-xs opacity-90">
                      Transport runs cannot be started for a closed event.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Direction picker — shown for every event run (§12.4.3a) */}
          {showDirectionPicker && !eventTransportBlocked && (
            <div className="grid gap-2">
              <Label>Run direction</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setEventRunDirection("outbound")}
                  className={cn(
                    "rounded-lg border px-3 py-3 text-sm font-semibold transition text-left",
                    eventRunDirection === "outbound"
                      ? "border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                      : "border-border text-muted-foreground hover:border-blue-400",
                  )}
                >
                  <div className="font-bold">Outbound</div>
                  <div className="mt-0.5 text-xs opacity-75">Depot → pickups → venue · bus waits</div>
                </button>
                <button
                  type="button"
                  onClick={() => setEventRunDirection("return")}
                  className={cn(
                    "rounded-lg border px-3 py-3 text-sm font-semibold transition text-left",
                    eventRunDirection === "return"
                      ? "border-green-500 bg-green-500/10 text-green-700 dark:text-green-300"
                      : "border-border text-muted-foreground hover:border-green-400",
                  )}
                >
                  <div className="font-bold">Return home</div>
                  <div className="mt-0.5 text-xs opacity-75">Venue → drop-offs → depot</div>
                </button>
              </div>
              {eventRunDirection === "return" && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Return run — roster filtered to bus passengers only. Take odometer reading where the bus is parked (usually the last itinerary stop).
                </p>
              )}
            </div>
          )}

          {eventRunDirection === "return" && !eventTransportBlocked && (
            <ReturnDepartFromPicker
              lastStop={
                lastItineraryStop
                  ? {
                      label: lastItineraryStop.label,
                      streetAddress: lastItineraryStop.streetAddress,
                    }
                  : null
              }
              choice={returnDepartChoice}
              onChoiceChange={setReturnDepartChoice}
              alternateAddress={returnDepartAlternate}
              onAlternateAddressChange={setReturnDepartAlternate}
              loading={lastStopLoading}
            />
          )}

          {!eventTransportBlocked && (
            <StartPointPicker
              direction={eventRunDirection === "return" ? "afternoon" : "morning"}
              depotAddress={defaultDepotAddress}
              centreAddress={defaultCentreAddress}
              choice={eventStartChoice}
              onChoiceChange={setEventStartChoice}
              alternateAddress={eventAlternateAddress}
              onAlternateAddressChange={setEventAlternateAddress}
              heading={eventRunDirection === "return" ? "Returning to" : "Starting from"}
              alternateHeading={
                eventRunDirection === "return"
                  ? "Other return destination (this trip only)"
                  : "Other address (this trip only)"
              }
              alternateDescription={
                eventRunDirection === "return"
                  ? "Tap if the bus returns somewhere other than depot or day centre"
                  : "Tap to enter a one-off starting address"
              }
            />
          )}

          <button
            type="submit"
            disabled={!eventId || startTrip.isPending || eventTransportBlocked}
            className={cn(
              "h-14 w-full rounded-xl font-bold text-white shadow transition",
              !eventId || startTrip.isPending || eventTransportBlocked
                ? "bg-blue-600 opacity-60 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700",
            )}
          >
            {eventTransportBlocked
              ? "Confirm event in Events first"
              : startTrip.isPending
                ? "Opening…"
                : eventRunDirection === "return"
                  ? "Start Return Run & Open Manifest"
                  : "Start Outbound Run & Open Manifest"
            }
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
  const { trip, legs, eventTitle } = bundle;
  const reorderPickups = useReorderTripPickupLegs();
  const activeLeg = legs.find((l) => l.status !== "completed") ?? null;
  const completedCount = legs.filter((l) => l.status === "completed").length;

  // Return-run context ──────────────────────────────────────────────────────
  const isReturnRun = trip.tripReturn !== "none";

  // Derive return passengers from the drop-off legs (exclude venue_to_depot).
  const returnPassengers: ReturnPassenger[] = useMemo(() => {
    if (!isReturnRun) return [];
    return legs
      .filter((l) => l.toParticipantId != null && l.legKind !== "venue_to_depot")
      .sort((a, b) => a.legIndex - b.legIndex)
      .map((l) => ({ id: l.toParticipantId!, name: l.toLabel }));
  }, [isReturnRun, legs]);

  const boardingKey = `return_boarding_confirmed_${trip.id}`;
  const [boardingConfirmed, setBoardingConfirmed] = useState(
    () => localStorage.getItem(boardingKey) === "true" || returnPassengers.length === 0,
  );

  const handleAllBoarded = () => {
    localStorage.setItem(boardingKey, "true");
    setBoardingConfirmed(true);
  };
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
  const activeIsEnRoute = activeLeg?.status === "en_route";
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
          trip={trip}
          legs={legs}
          startAddress={startAddressForLeg(shown)}
          onCancelPickup={canCancelPickupLeg(leg) ? () => requestCancel(leg) : undefined}
          cancelDisabled={isCancelling}
          drag={drag}
          isReturnRun={isReturnRun}
          boardingRequired={isReturnRun && !boardingConfirmed}
          tripId={trip.id}
          eventId={trip.eventId}
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
            <div className="truncate text-base font-bold leading-tight">{eventTitle ?? "Daily Run"}</div>
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

      <main
        data-manifest-scroll
        className={cn(
          "flex-1 overflow-y-auto px-3 pb-4 pt-3 space-y-2",
          "overscroll-y-contain",
        )}
      >
        {/* Return run: boarding roll gate before first leg departs */}
        {isReturnRun && !boardingConfirmed && returnPassengers.length > 0 && (
          <ReturnBoardingRoll
            tripId={trip.id}
            passengers={returnPassengers}
            onAllBoarded={handleAllBoarded}
          />
        )}

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

        {activeInProgress && !activeIsEnRoute && pendingPickups.length >= 2 && (
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

        {activeInProgress && !activeIsEnRoute && pendingPickups.length === 1 && (
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

        {!activeIsEnRoute &&
          upcomingStaticLegs.map((l) => (
            <LegRow
              key={l.id}
              leg={l}
              onCancelPickup={canCancelPickupLeg(l) ? requestCancel : undefined}
              cancelDisabled={isCancelling}
            />
          ))}
      </main>

      {pickupCancelDialog}

      <footer className="sticky bottom-0 z-20 space-y-2 border-t border-border bg-card p-3 pb-[max(env(safe-area-inset-bottom),12px)]">
        {allLegsComplete ? (
          <CloseRunCard trip={trip} legs={legs} eventTitle={eventTitle} />
        ) : activeIsEnRoute ? (
          <div className="text-center text-xs text-muted-foreground">
            Tap Arrive at Stop when you reach the destination.
          </div>
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
        drag?.isDragging && "z-10 touch-none opacity-90 shadow-lg ring-2 ring-blue-400",
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
            PICKUP_DRAG_GRIP_CLASS,
            cancelDisabled && "cursor-not-allowed opacity-50",
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

/* -------------------- Return Boarding Roll -------------------- */

interface ReturnPassenger { id: string; name: string }

/**
 * Pre-departure boarding roll for return runs.
 * Driver checks every passenger onto the bus by name before the first leg
 * departs. Blocking gate — "Depart Stop" stays disabled until all confirmed.
 */
function ReturnBoardingRoll({
  tripId,
  passengers,
  onAllBoarded,
}: {
  tripId: string;
  passengers: ReturnPassenger[];
  onAllBoarded: () => void;
}) {
  const boardingKey = `return_boarding_${tripId}`;

  const [boarded, setBoarded] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(boardingKey);
      if (saved) return new Set(JSON.parse(saved) as string[]);
    } catch (_) {}
    return new Set();
  });
  const [saving, setSaving] = useState(false);

  const toggle = (id: string) => {
    setBoarded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(boardingKey, JSON.stringify([...next])); } catch (_) {}
      return next;
    });
  };

  const allBoarded = passengers.length > 0 && passengers.every((p) => boarded.has(p.id));

  const confirm = async () => {
    if (!allBoarded || saving) return;
    setSaving(true);
    try {
      await writeToLedger({
        staff_id: getStaffId(),
        category: "CENTRE",
        severity: "GREEN",
        action_type: "RETURN_BOARDING_CONFIRMED",
        gps_lat: null,
        gps_lng: null,
        metadata: {
          trip_id: tripId,
          passenger_count: passengers.length,
          passenger_ids: passengers.map((p) => p.id),
        },
      });
    } catch (_) { /* best-effort */ } finally {
      setSaving(false);
    }
    localStorage.removeItem(boardingKey);
    onAllBoarded();
  };

  const boardedCount = passengers.filter((p) => boarded.has(p.id)).length;

  return (
    <Card className="rounded-xl border-2 border-amber-500 bg-slate-900 p-4 text-white">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-amber-400">
        <Users className="h-3.5 w-3.5" />
        Pre-departure — Return boarding roll
      </div>
      <p className="mt-1.5 text-sm text-slate-300">
        Check <strong>every passenger</strong> onto the bus before departing. You are responsible for confirming head count.
      </p>
      <div className="mt-3 space-y-2">
        {passengers.map((p) => {
          const on = boarded.has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggle(p.id)}
              className={cn(
                "flex w-full touch-manipulation select-none items-center justify-between rounded-xl border-2 px-4 py-3 text-left transition active:scale-[0.99]",
                on
                  ? "border-green-500 bg-green-600/25 text-white"
                  : "border-slate-600 bg-slate-800/60 text-slate-200",
              )}
            >
              <span className="text-base font-semibold">{p.name}</span>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase",
                  on ? "bg-green-600 text-white" : "bg-slate-700 text-slate-400",
                )}
              >
                {on ? "✓ On Bus" : "Not yet"}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 text-center text-sm text-slate-400">
        {boardedCount}/{passengers.length} confirmed
      </div>
      <button
        type="button"
        disabled={!allBoarded || saving}
        onClick={confirm}
        className={cn(
          "mt-3 h-14 w-full rounded-xl font-bold text-white transition",
          allBoarded
            ? "animate-pulse bg-green-600 hover:bg-green-500 hover:animate-none"
            : "cursor-not-allowed bg-slate-700 opacity-60",
        )}
      >
        {saving ? "Confirming…" : allBoarded ? "✅ All Aboard — Depart" : `Waiting for ${passengers.length - boardedCount} more…`}
      </button>
    </Card>
  );
}

/* -------------------- Active Leg -------------------- */

function ActiveLegCard({
  leg,
  trip,
  legs,
  startAddress,
  onCancelPickup,
  cancelDisabled,
  drag,
  isReturnRun,
  boardingRequired,
  tripId,
  eventId,
}: {
  leg: TripLeg;
  trip: TransportTrip;
  legs: TripLeg[];
  startAddress?: string | null;
  onCancelPickup?: () => void;
  cancelDisabled?: boolean;
  drag?: PickupDragBind;
  isReturnRun?: boolean;
  boardingRequired?: boolean;
  tripId: string;
  eventId?: string | null;
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
        "rounded-xl border-2 border-blue-500 bg-slate-900 p-4 text-white",
        drag?.isDragging && "z-10 touch-none opacity-90 shadow-lg ring-2 ring-blue-300",
      )}
    >
      <div className="flex items-start gap-2">
        {drag && leg.status !== "en_route" && (
          <button
            type="button"
            className={cn(
              PICKUP_DRAG_GRIP_CLASS,
              "text-slate-400",
              cancelDisabled && "cursor-not-allowed opacity-50",
            )}
            aria-label="Drag to reorder stop"
            disabled={cancelDisabled}
            onPointerDown={drag.onGripPointerDown}
          >
            <GripVertical className="h-5 w-5" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-blue-300">
              <Navigation className="h-3.5 w-3.5 shrink-0" /> Active leg {leg.legIndex}
            </div>
            {onCancelPickup && leg.status !== "en_route" && (
              <PickupCancelButton onClick={onCancelPickup} disabled={cancelDisabled} />
            )}
          </div>

          {leg.status === "en_route" ? (
            <div className="mt-1 min-w-0">
              <div className="truncate text-base font-bold leading-tight">
                {leg.fromLabel} <span className="font-normal text-slate-400">→</span> {leg.toLabel}
              </div>
              {leg.targetAddress && (
                <div className="mt-1 flex items-start gap-1.5 text-xs text-slate-300">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-300" />
                  <span className="break-words">{leg.targetAddress}</span>
                </div>
              )}
            </div>
          ) : (
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
          )}

          {leg.status === "en_route" && (
            <ManifestRouteMap leg={leg} trip={trip} legs={legs} className="mt-3" />
          )}

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
              <ArrivedChecklist
                leg={leg}
                isReturnRun={isReturnRun}
                tripId={tripId}
                eventId={eventId}
              />
            ) : leg.status === "completed" ? null : boardingRequired ? (
              <div className="flex h-14 w-full items-center justify-center rounded-xl bg-slate-700 text-sm font-bold text-slate-400">
                ✋ Complete boarding roll above to depart
              </div>
            ) : (
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
        </div>
      </div>
    </Card>
  );
}

/* -------------------- Arrived checklist -------------------- */

function ArrivedChecklist({
  leg,
  isReturnRun = false,
  tripId,
  eventId,
}: {
  leg: TripLeg;
  isReturnRun?: boolean;
  tripId: string;
  eventId?: string | null;
}) {
  const queryClient = useQueryClient();
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
      unsafeDropVerbalCleared: false,
    };
  });

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(formState));
  }, [formState, storageKey]);

  const { loggedKm, present, medStatus, extraMed, extraNotes, unsafeDropVerbalCleared } = formState;
  const [noShowArmed, setNoShowArmed] = useState(() => !(formState.present ?? true));
  const [unsafeDropArmed, setUnsafeDropArmed] = useState(() => !(formState.present ?? true));
  const [showNoShow, setShowNoShow] = useState(false);
  const [showUnsafeDrop, setShowUnsafeDrop] = useState(false);
  const [verbalPending, setVerbalPending] = useState<{ description: string } | null>(null);

  const participantId = leg.toParticipantId ?? leg.fromParticipantId;
  const participantName = leg.toParticipantId ? leg.toLabel : leg.fromLabel;
  const dropAddress = leg.targetAddress?.trim() || leg.toLabel;

  // On return runs, medication checks do not apply.
  const showMedChecks = !isReturnRun && leg.medicationExpected;
  const showExtraMed = !isReturnRun;

  const expectedMedSatisfied =
    medStatus === "collected_intact" || medStatus === "collected_damaged" || medStatus === "expected_not_provided";

  const exceptionFlagged = medStatus === "collected_damaged" || medStatus === "expected_not_provided";

  /** Unsafe drop on return run requires RED verbal auth before leg can complete. */
  const unsafeDropBlocked = isReturnRun && !present && !unsafeDropVerbalCleared;

  const blocked =
    !loggedKm ||
    Number.isNaN(Number(loggedKm)) ||
    (showMedChecks && !expectedMedSatisfied) ||
    (showExtraMed && extraMed && extraNotes.trim().length < 3) ||
    unsafeDropBlocked;

  const updateField = (field: string, value: unknown) => {
    setFormState((prev: Record<string, unknown>) => ({ ...prev, [field]: value }));
  };

  const openUnsafeDropVerbal = () => {
    const description =
      `Unsafe drop-off — ${participantName} was NOT safely handed over at ${dropAddress}. ` +
      `Driver must obtain manager verbal authorization before departing.`;
    setVerbalPending({ description });
  };

  const confirm = async () => {
    if (unsafeDropBlocked) {
      toast.error("Verbal consultation required", {
        description: "Record your manager contact attempt and sign with your PIN before logging this leg.",
        className: "border-red-700 bg-red-600 text-white font-medium",
      });
      return;
    }
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
      if (
        leg.medicationExpected &&
        (medStatus === "collected_intact" || medStatus === "collected_damaged")
      ) {
        resolveStaffIdWithFallback()
          .then((staffId) =>
            writeToLedger({
              staff_id: staffId,
              category: "TRIP",
              severity: "GREEN",
              action_type: "MED_BAG_HANDOVER",
              gps_lat: null,
              gps_lng: null,
              metadata: {
                trip_id: tripId,
                leg_id: leg.id,
                event_id: eventId ?? null,
                participant_id: participantId,
                handover_status: medStatus,
              },
            }),
          )
          .catch((e) => console.warn("[ArrivedChecklist] MED_BAG_HANDOVER ledger failed", e));
      }
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

  const confirmLabel = unsafeDropBlocked
    ? "🔴 Complete verbal consultation first"
    : "Confirm & Log Leg Completion";

  return (
    <div className="space-y-4 rounded-lg bg-slate-800/60 p-3 text-white">
      <NumericEntryTrigger
        id="kmlog"
        label="Logged leg km"
        value={loggedKm}
        onChange={(v) => updateField("loggedKm", v)}
        placeholder="Tap to enter leg distance"
        title="Logged leg kilometres"
        description="GPS estimate pre-filled — adjust in 0.5 km steps if needed."
        step={0.5}
        allowDecimal
        min={0}
        unit="km"
        variant="dark"
      />

      {/* ── Passenger confirmation — context-sensitive ──────────────────── */}
      {isReturnRun ? (
        /* Return run: confirm safe handover at front door */
        <>
          <MobileFieldButton
            tone={unsafeDropArmed ? "warning" : "success"}
            active={!unsafeDropArmed}
            icon={<UserCheck className="h-5 w-5" />}
            title={unsafeDropArmed ? "Unsafe drop?" : "Passenger safely at drop-off"}
            subtitle={
              unsafeDropArmed
                ? "Tap to cancel — passenger is safe"
                : "Tap if passenger was NOT safely handed over"
            }
            onClick={() => {
              if (unsafeDropArmed) {
                setUnsafeDropArmed(false);
                updateField("present", true);
                updateField("unsafeDropVerbalCleared", false);
                return;
              }
              setUnsafeDropArmed(true);
              updateField("present", false);
            }}
          />

          {unsafeDropArmed && participantId && (
            <div className="rounded-lg border border-red-500/60 bg-red-500/10 p-3 text-sm text-red-200">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                <div>
                  <div className="font-semibold">RED — Unsafe drop</div>
                  <div className="mt-0.5 text-xs text-red-300">
                    {unsafeDropVerbalCleared
                      ? "Verbal consultation recorded. You may log this leg and proceed."
                      : "Contact your coordinator. Record your contact attempt and sign with your PIN before departing."}
                  </div>
                </div>
              </div>
              {!unsafeDropVerbalCleared && (
                <button
                  type="button"
                  onClick={() => setShowUnsafeDrop(true)}
                  className="mt-3 h-12 w-full rounded-xl bg-red-600 font-bold text-white transition hover:bg-red-700 touch-manipulation"
                >
                  🔴 Log verbal consultation
                </button>
              )}
            </div>
          )}

          {/* Unsafe drop confirmation — opens verbal auth, does NOT allow proceed alone */}
          <AlertDialog open={showUnsafeDrop} onOpenChange={setShowUnsafeDrop}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>RED — Unsafe drop for {participantName}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This is a RED safety event. Select the manager you will contact (or attempted),
                  record whether you reached them or could not, and sign with your operator PIN.
                  Do not enter the manager&apos;s PIN — they are not present.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel
                  onClick={() => {
                    setUnsafeDropArmed(false);
                    updateField("present", true);
                    setShowUnsafeDrop(false);
                  }}
                >
                  Cancel — passenger is safe
                </AlertDialogCancel>
                <AlertDialogAction
                  className="bg-red-600 hover:bg-red-700"
                  onClick={() => {
                    setShowUnsafeDrop(false);
                    openUnsafeDropVerbal();
                  }}
                >
                  Continue to consultation log
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <VerbalConsultationDialog
            open={!!verbalPending}
            onOpenChange={(o) => {
              if (!o) {
                if (!unsafeDropVerbalCleared) {
                  setUnsafeDropArmed(false);
                  updateField("present", true);
                }
                setVerbalPending(null);
              }
            }}
            ledgerCategory="TRIP"
            subjectLabel={`${participantName} · Leg ${leg.legIndex} drop-off`}
            sourceId={leg.id}
            actionType="RED_VERBAL_CONSULTATION"
            titleOverride="RED Verbal Consultation — Unsafe Drop"
            descriptionOverride="The manager is not with you. Select who you attempted to contact, record the outcome (reached with agreed plan, or unable to contact), and sign with your operator PIN only."
            onAccepted={async (payload) => {
              if (!verbalPending) return;
              const prefixed = formatVerbalWorkaroundDescription(
                verbalPending.description,
                payload,
              );
              try {
                await raiseUnsafeDropHubIssue({
                  tripId,
                  legId: leg.id,
                  eventId: eventId ?? null,
                  description: prefixed,
                  workaroundPlan: payload.notes,
                });
                queryClient.invalidateQueries({ queryKey: ["governance-unified-issues"] });
              } catch (err) {
                console.error("[ArrivedChecklist] unsafe-drop Hub sync failed", err);
                toast.error("Consultation logged to ledger, but Hub sync failed", {
                  description: (err as Error).message,
                });
                return;
              }
              updateField("unsafeDropVerbalCleared", true);
              setVerbalPending(null);
              toast.success("Verbal consultation recorded", {
                description: "Governance Hub updated. You may now log this leg and proceed.",
              });
            }}
          />
        </>
      ) : (
        /* Outbound pickup: confirm boarded + no-show flow */
        <>
          <MobileFieldButton
            tone={noShowArmed ? "warning" : "info"}
            active={!noShowArmed}
            icon={<UserCheck className="h-5 w-5" />}
            title={noShowArmed ? "No-show?" : "Passenger on board"}
            subtitle={noShowArmed ? "Tap to cancel — passenger is on board" : "Tap for no-show"}
            onClick={() => {
              if (noShowArmed) {
                setNoShowArmed(false);
                updateField("present", true);
                return;
              }
              setNoShowArmed(true);
            }}
          />

          {noShowArmed && participantId && (
            <>
              <button
                type="button"
                onClick={() => {
                  updateField("present", false);
                  setShowNoShow(true);
                }}
                className="h-12 w-full rounded-xl bg-red-600 font-bold text-white transition hover:bg-red-700 touch-manipulation"
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
        </>
      )}

      {/* ── Medication checks — outbound pickups only ────────────────────── */}
      {showMedChecks && (
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
          <div className="mt-2 grid gap-2">
            <MobileOptionButton
              selected={medStatus === "collected_intact"}
              dotClassName="bg-green-500"
              label="Collected & Intact"
              onClick={() => updateField("medStatus", "collected_intact")}
            />
            <MobileOptionButton
              selected={medStatus === "collected_damaged"}
              dotClassName="bg-amber-500"
              label="Collected but Damaged / Compromised"
              onClick={() => updateField("medStatus", "collected_damaged")}
            />
            <MobileOptionButton
              selected={medStatus === "expected_not_provided"}
              dotClassName="bg-red-500"
              label="Expected but Not Provided"
              onClick={() => updateField("medStatus", "expected_not_provided")}
            />
          </div>
          {exceptionFlagged && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/60 bg-amber-500/10 p-2 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Manager exception flag will be recorded against this leg.</span>
            </div>
          )}
        </div>
      )}

      {showExtraMed && (
        <div className="space-y-2">
          <MobileFieldButton
            tone={extraMed ? "info" : "neutral"}
            active={extraMed}
            icon={<Pill className="h-5 w-5" />}
            title={
              extraMed
                ? "Unexpected medication logged"
                : "Log unexpected medication bag received"
            }
            subtitle={extraMed ? "Tap to hide notes" : "Tap to add description"}
            onClick={() => updateField("extraMed", !extraMed)}
          />
          {extraMed && (
            <div className="grid gap-1">
              <Label htmlFor="xnotes" className="text-xs text-slate-300">
                Notes / description of unexpected medicine bag
              </Label>
              <Textarea
                id="xnotes"
                rows={3}
                value={extraNotes}
                onChange={(e) => updateField("extraNotes", e.target.value)}
                className="min-h-[5rem] bg-slate-950 text-base text-white"
                placeholder="e.g. small white pouch · 2 inhalers labelled JS"
              />
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        disabled={blocked || patch.isPending}
        onClick={() => void confirm()}
        className={cn(
          "h-14 w-full touch-manipulation rounded-xl text-lg font-bold text-white transition active:scale-[0.98] disabled:opacity-60",
          blocked || patch.isPending
            ? "cursor-not-allowed bg-slate-700"
            : "bg-green-600 hover:bg-green-700",
        )}
      >
        {patch.isPending ? "Logging…" : confirmLabel}
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
