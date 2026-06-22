import { useMemo, useState } from "react";
import { ClipboardCheck, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { LogAnomalyModal } from "@/components/site-day/log-anomaly-modal";
import { ActiveIssuesRegister } from "@/components/issue-engine/active-issues-register";
import { getActiveEscalation } from "@/lib/api/clearance";

import type {
  AssetCheckpoint,
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
  submitDriverAuthorization,
} from "@/lib/data-store";
import { triggerInspectionAlert, toSeverity } from "@/hooks/use-notification-router";
import { RedHandshakeWaitingPanel } from "./red-handshake-waiting-panel";

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
  asset: TransportAsset;
  startOdometer: number;
  dateStr: string;
  checkpoints: AssetCheckpoint[];
  driverName: string;
  onCleared: () => void;
  onBack: () => void;
  onRedRaised?: (esc: OperationalEscalation) => void;
}

export function IssueAccumulatorPanel({
  asset,
  startOdometer,
  dateStr,
  checkpoints,
  driverName,
  onCleared,
  onBack,
  onRedRaised,
}: Props) {
  const [issues, setIssues] = useState<DraftIssue[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [comfortDeclared, setComfortDeclared] = useState(false);
  const [driverPin, setDriverPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [redClearance, setRedClearance] =
    useState<AssetDailyClearance | null>(null);

  const vehicleInfo = `${asset.name} · ${asset.regoPlate}`;
  const hasRed = useMemo(() => issues.some((i) => i.severity === "red"), [issues]);

  if (redClearance) {
    return (
      <RedHandshakeWaitingPanel
        asset={asset}
        clearance={redClearance}
        issues={issues}
        driverName={driverName}
        onAuthorized={onCleared}
        onBack={onBack}
      />
    );
  }

  const removeIssue = (id: string) =>
    setIssues((p) => p.filter((i) => i.id !== id));

  const buildAccumulatedBlob = (list: DraftIssue[]): string =>
    list
      .map((i, idx) => {
        const c = severityChip(i.severity);
        return `${idx + 1}. ${c.emoji} ${c.label} — ${i.text}`;
      })
      .join("\n");

  const submit = async () => {
    if (submitting) return;
    const driverStaffId = getStaffId() || DEFAULT_STAFF_UUID;

    if (!comfortDeclared) {
      toast.error("Please tick the comfort declaration to continue.");
      return;
    }
    if (!/^\d{4}$/.test(driverPin)) {
      toast.error("Enter your 4-digit onboarding PIN.");
      return;
    }

    setSubmitting(true);
    try {
      const items: NewClearanceItemInput[] = issues.map((i) => ({
        checkpointId: null,
        checkpointLabel: i.text.slice(0, 80),
        passed: i.severity === "green",
        isMandatory: false,
        notes: i.text,
        severity: i.severity,
        workaroundText: i.text,
      }));

      const bundle = await insertAssetClearanceWithItems({
        assetId: asset.id,
        clearanceDate: dateStr,
        driverStaffId,
        startOdometer: Math.round(startOdometer),
        items,
        accumulatedIssues: buildAccumulatedBlob(issues),
        driverComfortDeclared: comfortDeclared,
      });

      issues.forEach((i) => {
        if (i.severity === "green") return;
        const cpHint = checkpoints.find((c) =>
          i.text.toLowerCase().includes(c.label.toLowerCase().slice(0, 12)),
        );
        triggerInspectionAlert(
          asset.name,
          driverName,
          i.text,
          cpHint ? toSeverity(cpHint.impactLevel) : "conditional_warning",
          i.text,
        );
      });

      await submitDriverAuthorization(bundle.clearance.id, driverStaffId, driverPin);
      toast.success("Declaration locked in", {
        description: `${asset.name} cleared for service.`,
      });
      onCleared();
    } catch (err) {
      toast.error("Could not save clearance", {
        description: (err as Error).message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Section 9 — inherited unresolved exceptions for this vehicle */}
      <ActiveIssuesRegister vehicleInfo={vehicleInfo} />

      <Card className="p-5">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-blue-600" />
          <h2 className="text-lg font-extrabold">
            Daily Walkaround — {asset.name}
          </h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {asset.regoPlate} · Log every fault or workaround you noticed on your
          walkaround. Tag each one Green, Yellow, or RED.
        </p>

        {/* ---------------- Accumulated issues stack ---------------- */}
        <div className="mt-5 space-y-2">
          {issues.length === 0 && (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
              No issues logged yet. Add one below, or jump straight to the
              comfort declaration if the vehicle is fully clean.
            </div>
          )}
          {issues.map((i, idx) => {
            const c = severityChip(i.severity);
            return (
              <div
                key={i.id}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3",
                  i.severity === "yellow"
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

        {/* Add-issue trigger — opens the unified LogAnomalyModal (pre-trip context). */}
        <button
          type="button"
          onClick={() => setLogOpen(true)}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-blue-600/50 bg-blue-600/5 text-sm font-bold text-blue-700 transition hover:bg-blue-600/10 dark:text-blue-300"
        >
          <Plus className="h-4 w-4" /> Add An Issue
        </button>

        {/* Comfort declaration & PIN — always required (the dual-PIN handshake
            for RED is handled by RedHandshakeWaitingPanel once an escalation
            has been raised, so by the time we get here the run is GREEN/YELLOW). */}
        {!hasRed && (
          <div className="mt-6 rounded-lg border-2 border-green-600/40 bg-green-600/5 p-4">
            <div className="flex items-start gap-3">
              <Checkbox
                id="comfort"
                checked={comfortDeclared}
                onCheckedChange={(v) => setComfortDeclared(v === true)}
                className="mt-0.5"
              />
              <Label
                htmlFor="comfort"
                className="cursor-pointer text-sm font-medium leading-snug"
              >
                {COMFORT_DECLARATION_TEXT}
              </Label>
            </div>

            <div className="mt-4 grid gap-1.5">
              <Label
                htmlFor="driver-pin"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                Driver Onboarding PIN
              </Label>
              <Input
                id="driver-pin"
                type="password"
                inputMode="numeric"
                maxLength={4}
                autoComplete="off"
                value={driverPin}
                onChange={(e) =>
                  setDriverPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                }
                placeholder="••••"
                className="h-12 max-w-[180px] text-center text-lg tracking-[0.6em] tabular-nums"
              />
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={submitting || hasRed}
          onClick={submit}
          className={cn(
            "mt-5 h-14 w-full rounded-xl font-bold text-white shadow transition",
            "bg-blue-600 hover:bg-blue-700",
            (submitting || hasRed) && "opacity-60 cursor-not-allowed",
          )}
        >
          {submitting ? "Saving…" : "Lock In Declaration & Roll"}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="mt-2 h-10 w-full rounded-xl text-sm font-semibold text-muted-foreground transition hover:text-foreground"
        >
          ← Change vehicle
        </button>
      </Card>

      {/* Reentrant unified Issue/Escalation engine — pre-trip context.
          Green/Yellow → emit DraftIssue to local accumulator.
          Red          → modal raises a single-rail operational_escalations
                         row directly; we then lift the full escalation row
                         to the route via onRedRaised so RedHandshakeWaitingPanel
                         renders. */}
      <LogAnomalyModal
        open={logOpen}
        onOpenChange={setLogOpen}
        context={{
          kind: "pre-trip",
          asset: { id: asset.id, name: asset.name, regoPlate: asset.regoPlate },
          driverName,
          dateStr,
          onLogged: (draft) => {
            setIssues((prev) => [
              ...prev,
              {
                id: freshId(),
                severity: draft.severity as ClearanceIssueSeverity,
                text: draft.workaround
                  ? `${draft.description} — Workaround: ${draft.workaround}`
                  : draft.description,
              },
            ]);
          },
          onEscalated: async () => {
            // Resolve the full escalation row so the parent can render the
            // handshake waiting panel without another round-trip.
            try {
              const driverStaffId = getStaffId() || DEFAULT_STAFF_UUID;
              const esc = await getActiveEscalation(driverStaffId);
              if (esc) onRedRaised?.(esc);
            } catch (err) {
              console.error("[IssueAccumulatorPanel] lift escalation failed", err);
            }
          },
        }}
      />
    </div>
  );
}

export { COMFORT_DECLARATION_TEXT };
export type { DraftIssue };
