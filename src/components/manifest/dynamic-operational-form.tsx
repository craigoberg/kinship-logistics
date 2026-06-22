import { useMemo, useState } from "react";
import {
  Check,
  ClipboardCheck,
  Info,
  Plus,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import type {
  AssetClearanceBundle,
  AssetDailyClearance,
  ClearanceIssueSeverity,
  NewClearanceItemInput,
  OperationalEscalation,
  TransportAsset,
} from "@/lib/data-store";
import {
  DEFAULT_STAFF_UUID,
  getStaffId,
  insertAssetClearanceWithItems,
  raiseOperationalEscalation,
  submitDriverAuthorization,
} from "@/lib/data-store";
import type { OperationalSchema } from "@/lib/operational-forms";
import { triggerInspectionAlert } from "@/hooks/use-notification-router";

const COMFORT_DECLARATION_TEXT =
  "I confirm that all issues have been cleanly recorded, appropriate workarounds are deployed, and I am personally comfortable, oriented, and acting in accordance with my signed Organization Onboarding Guidelines to operate safely today.";

interface DraftIssue {
  id: string;
  severity: ClearanceIssueSeverity;
  text: string;
}

function freshId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

function severityChip(s: ClearanceIssueSeverity): {
  label: string;
  tone: string;
  emoji: string;
} {
  if (s === "red")
    return { label: "RED", tone: "bg-red-600 text-white", emoji: "🛑" };
  if (s === "yellow")
    return { label: "YELLOW", tone: "bg-yellow-400 text-black", emoji: "🟡" };
  return { label: "GREEN", tone: "bg-green-600 text-white", emoji: "🟢" };
}

interface Props {
  schema: OperationalSchema;
  asset: TransportAsset;
  startOdometer: number;
  dateStr: string;
  driverName: string;
  onCleared: () => void;
  onEscalated: (esc: OperationalEscalation) => void;
  onRedHandshake: (
    clearance: AssetDailyClearance,
    issues: DraftIssue[],
  ) => void;
  onBack: () => void;
}

export function DynamicOperationalForm({
  schema,
  asset,
  startOdometer,
  dateStr,
  driverName,
  onCleared,
  onEscalated,
  onRedHandshake,
  onBack,
}: Props) {
  const gates = schema.criticalGates ?? [];
  const [gateState, setGateState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(gates.map((g) => [g.id, false])),
  );

  const [issues, setIssues] = useState<DraftIssue[]>([]);
  const [draftSeverity, setDraftSeverity] =
    useState<ClearanceIssueSeverity>("green");
  const [draftText, setDraftText] = useState("");
  const [addingOpen, setAddingOpen] = useState(false);

  const [forkOpen, setForkOpen] = useState(false);
  const [forkSubmitting, setForkSubmitting] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);

  const hasRed = useMemo(() => issues.some((i) => i.severity === "red"), [
    issues,
  ]);
  const firstUnverifiedGate = useMemo(
    () => gates.find((g) => !gateState[g.id]),
    [gates, gateState],
  );

  // ─────── helpers ───────
  const toggleGate = (id: string) =>
    setGateState((p) => ({ ...p, [id]: !p[id] }));

  const addDraft = () => {
    if (!draftText.trim()) {
      toast.error("Describe the fault/workaround first.");
      return;
    }
    setIssues((p) => [
      ...p,
      { id: freshId(), severity: draftSeverity, text: draftText.trim() },
    ]);
    setDraftText("");
    setDraftSeverity("green");
    setAddingOpen(false);
  };

  const removeIssue = (id: string) =>
    setIssues((p) => p.filter((i) => i.id !== id));

  const buildAccumulatedBlob = (list: DraftIssue[]): string =>
    list
      .map((i, idx) => {
        const c = severityChip(i.severity);
        return `${idx + 1}. ${c.emoji} ${c.label} — ${i.text}`;
      })
      .join("\n");

  const fireSimulatorAlerts = () => {
    issues.forEach((i) => {
      if (i.severity === "green") return;
      triggerInspectionAlert(
        asset.name,
        driverName,
        i.text,
        i.severity === "red" ? "critical_no_go" : "conditional_warning",
        i.text,
      );
    });
  };

  const buildClearance = async (
    comfortDeclared: boolean,
  ): Promise<AssetClearanceBundle> => {
    const driverStaffId = getStaffId() || DEFAULT_STAFF_UUID;
    const items: NewClearanceItemInput[] = issues.map((i) => ({
      checkpointId: null,
      checkpointLabel: i.text.slice(0, 80),
      passed: i.severity === "green",
      isMandatory: i.severity === "red",
      notes: i.text,
      severity: i.severity,
      workaroundText: i.text,
    }));
    return insertAssetClearanceWithItems({
      assetId: asset.id,
      clearanceDate: dateStr,
      driverStaffId,
      startOdometer: Math.round(startOdometer),
      items,
      accumulatedIssues: buildAccumulatedBlob(issues),
      driverComfortDeclared: comfortDeclared,
    });
  };

  // ─────── primary action ───────
  const onPrimaryPress = async () => {
    if (firstUnverifiedGate) {
      setForkOpen(true);
      return;
    }
    if (hasRed) {
      // Persist the clearance immediately and hand off to the existing
      // dual-PIN dashboard handshake.
      try {
        const bundle = await buildClearance(false);
        fireSimulatorAlerts();
        toast.warning("Awaiting manager joint review", {
          description:
            "A RED issue was logged. The Operations Manager has been notified.",
        });
        onRedHandshake(bundle.clearance, issues);
      } catch (err) {
        toast.error("Could not save clearance", {
          description: (err as Error).message,
        });
      }
      return;
    }
    setPinOpen(true);
  };

  const handleRaiseSev1 = async () => {
    if (forkSubmitting || !firstUnverifiedGate) return;
    setForkSubmitting(true);
    try {
      const esc = await raiseOperationalEscalation({
        clearanceId: null,
        driverName,
        vehicleInfo: `${asset.name} · ${asset.regoPlate}`,
        gateId: firstUnverifiedGate.id,
      });
      setForkOpen(false);
      toast.success(
        "🚨 Sev 1 Escalation Active. Broadcast signals and backup SMS alerts have been dispatched to the Office Pool.",
        { duration: 8000 },
      );
      onEscalated(esc);
    } catch {
      toast.error("Network error. Please contact the office via phone directly.");
    } finally {
      setForkSubmitting(false);
    }
  };

  return (
    <Card className="p-5">
      {/* ─────── 1. Header ─────── */}
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-5 w-5 text-blue-600" />
        <h2 className="text-lg font-extrabold">{schema.title}</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {asset.name} · {asset.regoPlate} — {schema.description}
      </p>

      {/* ─────── 2. Info banner ─────── */}
      <div className="mt-4 flex items-start gap-2 rounded-lg border border-blue-600/40 bg-blue-600/10 p-3 text-xs text-blue-900 dark:text-blue-200">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{schema.infoBannerText}</span>
      </div>

      {/* ─────── 3. Critical gate banners ─────── */}
      {gates.length > 0 && (
        <div className="mt-4 space-y-2">
          {gates.map((g) => {
            const on = !!gateState[g.id];
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => toggleGate(g.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl p-4 text-left text-sm font-semibold transition min-h-16 shadow-sm",
                  on
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-700",
                )}
                aria-pressed={on}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2",
                    on
                      ? "border-white bg-white/20"
                      : "border-slate-400 dark:border-slate-500",
                  )}
                >
                  {on && <Check className="h-4 w-4" />}
                </span>
                <span className="leading-snug">{g.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ─────── 4. Issue accumulator ─────── */}
      <div className="mt-5 space-y-2">
        {issues.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
            No issues logged yet. Add one below, or roll straight through if the
            vehicle is fully clean.
          </div>
        )}
        {issues.map((i, idx) => {
          const c = severityChip(i.severity);
          return (
            <div
              key={i.id}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-3",
                i.severity === "red"
                  ? "border-red-600/70 bg-red-600/10"
                  : i.severity === "yellow"
                    ? "border-yellow-500/70 bg-yellow-400/10"
                    : "border-green-600/40 bg-green-600/5",
              )}
            >
              <span
                className={cn(
                  "shrink-0 rounded-md px-2 py-1 text-[10px] font-extrabold tracking-wide",
                  c.tone,
                )}
              >
                #{idx + 1} · {c.label}
              </span>
              <div className="min-w-0 flex-1 text-sm">{i.text}</div>
              <button
                type="button"
                onClick={() => removeIssue(i.id)}
                className="rounded p-1 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                aria-label="Remove issue"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>

      {addingOpen ? (
        <div className="mt-3 rounded-lg border-2 border-blue-600/40 bg-blue-600/5 p-3">
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            New issue
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {(["green", "yellow", "red"] as ClearanceIssueSeverity[]).map(
              (s) => {
                const c = severityChip(s);
                const selected = draftSeverity === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setDraftSeverity(s)}
                    className={cn(
                      "h-12 rounded-md border-2 text-sm font-bold transition",
                      selected
                        ? `${c.tone} border-transparent`
                        : "border-border bg-background text-muted-foreground hover:border-foreground/40",
                    )}
                  >
                    {c.emoji} {c.label}
                  </button>
                );
              },
            )}
          </div>
          <Label htmlFor="draft-text" className="mt-3 block text-xs">
            Fault &amp; workaround description
          </Label>
          <Textarea
            id="draft-text"
            rows={3}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder="e.g. Rear brake light intermittent — confirmed working at 0815, will revisit at depot."
            className="mt-1"
          />
          {draftSeverity === "red" && (
            <div className="mt-2 flex items-start gap-2 rounded-md border border-red-600/60 bg-red-600/10 p-2 text-[11px] text-red-700 dark:text-red-300">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                A RED tag pauses the run and triggers a dual-PIN joint review
                with the Operations Manager before dispatch.
              </span>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => {
                setAddingOpen(false);
                setDraftText("");
                setDraftSeverity("green");
              }}
            >
              Cancel
            </Button>
            <Button type="button" className="flex-1" onClick={addDraft}>
              Add to today's summary
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAddingOpen(true)}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-blue-600/50 bg-blue-600/5 text-sm font-bold text-blue-700 transition hover:bg-blue-600/10 dark:text-blue-300"
        >
          <Plus className="h-4 w-4" /> Add An Issue
        </button>
      )}

      {/* ─────── 5. Primary footer action (always interactive) ─────── */}
      <button
        type="button"
        onClick={onPrimaryPress}
        className={cn(
          "mt-6 h-14 w-full rounded-xl font-bold text-white shadow transition",
          hasRed
            ? "bg-red-600 hover:bg-red-700"
            : "bg-blue-600 hover:bg-blue-700",
        )}
      >
        {hasRed ? "🛑 Submit & Request Joint Review" : schema.primaryActionText}
      </button>
      <button
        type="button"
        onClick={onBack}
        className="mt-2 h-10 w-full rounded-xl text-sm font-semibold text-muted-foreground transition hover:text-foreground"
      >
        ← Change vehicle
      </button>

      {/* ─────── 6. Guidance fork (bottom sheet) ─────── */}
      <GuidanceForkSheet
        open={forkOpen}
        onOpenChange={(o) => !forkSubmitting && setForkOpen(o)}
        submitting={forkSubmitting}
        onRaise={handleRaiseSev1}
      />

      {/* ─────── 7. PIN declaration modal ─────── */}
      <PinDeclarationModal
        open={pinOpen}
        onOpenChange={(o) => setPinOpen(o)}
        onConfirm={async (pin) => {
          const driverStaffId = getStaffId() || DEFAULT_STAFF_UUID;
          const bundle = await buildClearance(true);
          fireSimulatorAlerts();
          await submitDriverAuthorization(bundle.clearance.id, driverStaffId, pin);
          toast.success("Declaration locked in", {
            description: `${asset.name} cleared for service.`,
          });
          setPinOpen(false);
          onCleared();
        }}
      />
    </Card>
  );
}

// ───────────────────────── Guidance Fork Sheet ─────────────────────────

function GuidanceForkSheet({
  open,
  onOpenChange,
  submitting,
  onRaise,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  submitting: boolean;
  onRaise: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-rose-600">
            <ShieldAlert className="h-5 w-5" /> Reality Check
          </SheetTitle>
          <SheetDescription className="text-base leading-relaxed text-foreground">
            You haven't verified the passenger manifest gate. If you are missing
            passengers, please raise a Sev 1 for Manager Consultation for
            Approval to Leave.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-3 pb-6">
          <button
            type="button"
            disabled={submitting}
            onClick={onRaise}
            className={cn(
              "h-14 w-full rounded-xl bg-rose-600 px-4 text-base font-extrabold text-white shadow-lg transition hover:bg-rose-700",
              submitting && "cursor-not-allowed opacity-60",
            )}
          >
            {submitting ? "Sending…" : "🚨 RAISE SEV 1 ESCALATION"}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
            className="block w-full text-center text-sm font-medium text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline"
          >
            - Go Back &amp; Verify Manifest -
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ───────────────────────── PIN Declaration Modal ─────────────────────────

function PinDeclarationModal({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: (pin: string) => Promise<void>;
}) {
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    if (submitting) return;
    if (!/^\d{4}$/.test(pin)) {
      toast.error("Enter your 4-digit onboarding PIN.");
      return;
    }
    setSubmitting(true);
    try {
      await onConfirm(pin);
      setPin("");
    } catch (err) {
      toast.error("Could not save clearance", {
        description: (err as Error).message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (submitting) return;
        if (!o) setPin("");
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Driver Comfort Declaration</DialogTitle>
          <DialogDescription className="text-foreground/90">
            {COMFORT_DECLARATION_TEXT}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Label
            htmlFor="pin-modal-input"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Driver Onboarding PIN
          </Label>
          <Input
            id="pin-modal-input"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoFocus
            autoComplete="off"
            value={pin}
            onChange={(e) =>
              setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
            }
            placeholder="----"
            className="h-14 max-w-[200px] text-center text-2xl tracking-[0.6em] tabular-nums"
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={submitting || pin.length !== 4}
            onClick={handleConfirm}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {submitting ? "Confirming…" : "Confirm & Roll"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { DraftIssue };
export { COMFORT_DECLARATION_TEXT };
