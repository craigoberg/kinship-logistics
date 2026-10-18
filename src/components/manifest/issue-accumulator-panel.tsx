import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCheck, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import {
  resolveOperatorStaffIdFromPin,
  verifyOperatorPin,
} from "@/components/auth/pin-verify";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn, formatDate } from "@/lib/utils";

import { StartingKmConfirm } from "@/components/manifest/starting-km-confirm";
import { VehicleKnownIssues } from "@/components/manifest/vehicle-known-issues";
import { LogAnomalyModal } from "@/components/site-day/log-anomaly-modal";
import {
  VerbalConsultationDialog,
  formatVerbalWorkaroundDescription,
} from "@/components/issue-engine/verbal-consultation-dialog";
import { supabase } from "@/integrations/supabase/client";

import type {
  AssetCheckpoint,
  ClearanceIssueSeverity,
  NewClearanceItemInput,
  TransportAsset,
} from "@/lib/data-store";
import {
  getActiveUserProfile,
  getClearanceForAssetOnDate,
  insertAssetClearanceWithItems,
  resolveStaffIdWithFallback,
  resolveStaffDisplayName,
  submitDriverAuthorization,
} from "@/lib/data-store";
import { queueBusClearance } from "@/lib/deliver-offline/fleet-cache";
import { isNetworkError } from "@/lib/manifest-offline";
import { createMaintenanceItem, MAINTENANCE_ITEMS_KEY } from "@/lib/api/maintenance";
import { useQueryClient } from "@tanstack/react-query";
import { triggerInspectionAlert, toSeverity } from "@/hooks/use-notification-router";
// RedHandshakeWaitingPanel removed — single-user verbal flow replaces the
// multi-device handshake; RED issues now route through VerbalConsultationDialog.

const COMFORT_DECLARATION_TEXT =
  "I confirm that all issues have been cleanly recorded, appropriate workarounds are deployed, and I am personally comfortable, oriented, and acting in accordance with my signed Organization Onboarding Guidelines to operate safely today.";

const PRE_TRIP_TAG = "[Pre-trip]";

/**
 * GUARDRAILS §3: "red-verbal-cleared" is a local sentinel marking a RED issue
 * that has been formally authorised via VerbalConsultationDialog (operator PIN
 * verified, ledger receipt written). It is never persisted — it only prevents
 * `hasRed` from blocking the final submit after the workaround is on record.
 */
type DraftIssueSeverity = ClearanceIssueSeverity | "red-verbal-cleared";

interface DraftIssue {
  id: string;
  /** Backing operational_incidents.id when persisted (Green/Yellow/verbal-RED). */
  incidentId?: string;
  severity: DraftIssueSeverity;
  text: string;
  /** Logged in this sitting. Rehydrated rows are not mirrored again. */
  fresh?: boolean;
}

function freshId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

function sevToIncident(s: ClearanceIssueSeverity): "sev2" | "sev3" | null {
  if (s === "yellow") return "sev2";
  if (s === "green") return "sev3";
  return null;
}

function incidentSevToClearance(
  s: string | null | undefined,
): ClearanceIssueSeverity | null {
  if (s === "sev2") return "yellow";
  if (s === "sev3") return "green";
  return null;
}


/** Canonical severity display — visual chip classes match RYGE_SEVERITY_CHIPS active state. */
const SEVERITY_DISPLAY: Record<DraftIssueSeverity, { label: string; cls: string; emoji: string }> = {
  red:               { label: "RED",               cls: "bg-red-600 text-white",   emoji: "🛑" },
  "red-verbal-cleared": { label: "RED · Verbal Cleared", cls: "bg-amber-500 text-white", emoji: "✅" },
  yellow:            { label: "YELLOW",             cls: "bg-yellow-400 text-black", emoji: "🟡" },
  green:             { label: "GREEN",              cls: "bg-green-600 text-white",  emoji: "🟢" },
};

interface Props {
  asset: TransportAsset;
  dateStr: string;
  checkpoints: AssetCheckpoint[];
  driverName: string;
  /** Vehicle was already cleared today. This sitting is an extra finding from a later driver. */
  alreadyCleared?: boolean;
  /**
   * Manifest door runs confirm the dash reading. Event Deliver bus leave does not
   * ask for kilometres — the last known reading is stored and the vehicle total is not treated as a new trip start.
   */
  askOdometer?: boolean;
  /** Driver PIN pad length. Manifest keeps 4; Event Deliver uses 6. */
  pinLength?: 4 | 6;
  /** Confirmed dash reading for this run. */
  onCleared: (startKm: number) => void;
  onBack: () => void;
}

export function IssueAccumulatorPanel({
  asset,
  dateStr,
  checkpoints,
  driverName,
  alreadyCleared = false,
  askOdometer = true,
  pinLength = 4,
  onCleared,
  onBack,
}: Props) {
  const queryClient = useQueryClient();
  const [startKm, setStartKm] = useState<number | null>(null);
  useEffect(() => {
    if (askOdometer || startKm != null) return;
    const known = asset.currentOdometerKm;
    setStartKm(known != null && Number.isFinite(known) ? Math.round(known) : 0);
  }, [askOdometer, asset.currentOdometerKm, startKm]);
  const [issues, setIssues] = useState<DraftIssue[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [comfortDeclared, setComfortDeclared] = useState(false);
  const [driverPinVerified, setDriverPinVerified] = useState(false);
  const verifiedDriverPinRef = useRef("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Pending RED draft awaiting verbal authorization. When non-null, the
  // VerbalConsultationDialog is open and gates the next ledger + incident
  // write.
  const [verbalPending, setVerbalPending] = useState<{
    description: string;
    owner: "internal" | "council";
    occurredAt: string;
  } | null>(null);

  const hasRed = useMemo(() => issues.some((i) => i.severity === "red"), [issues]);

  // Rehydrate Green/Yellow drafts from operational_incidents so a refresh
  // mid-walkaround doesn't blank the panel. Filter to today's pending
  // mechanical findings for this vehicle.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("operational_incidents")
          .select("id, severity, description, created_at")
          .eq("vehicle_id", asset.id)
          .eq("status", "pending")
          .eq("incident_type", "mechanical")
          .in("severity", ["sev2", "sev3"])
          .gte("created_at", `${dateStr}T00:00:00.000Z`)
          .order("created_at", { ascending: true });
        if (error) throw error;
        if (cancelled || !data) return;
        const rehydrated: DraftIssue[] = [];
        for (const r of data) {
          const sev = incidentSevToClearance(r.severity as string);
          if (!sev) continue;
          const desc = String(r.description ?? "");
          const text = desc.startsWith(PRE_TRIP_TAG)
            ? desc.slice(PRE_TRIP_TAG.length).trim()
            : desc;
          rehydrated.push({
            id: freshId(),
            incidentId: String(r.id),
            severity: sev,
            text,
          });
        }

        if (rehydrated.length > 0) {
          setIssues((prev) => (prev.length === 0 ? rehydrated : prev));
        }
      } catch (err) {
        console.warn("[IssueAccumulatorPanel] rehydrate failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [asset.id, dateStr]);

  // RED handshake waiting branch removed — verbal-consultation dialog now
  // handles RED inline at the bottom of this component.

  const removeIssue = async (id: string) => {
    const target = issues.find((i) => i.id === id);
    setIssues((p) => p.filter((i) => i.id !== id));
    if (target?.incidentId) {
      try {
        const { error } = await supabase
          .from("operational_incidents")
          .update({ status: "resolved" })
          .eq("id", target.incidentId);
        if (error) throw error;
      } catch (err) {
        console.warn(
          "[IssueAccumulatorPanel] soft-resolve incident failed",
          err,
        );
        toast.error("Removed locally but could not sync to Governance Hub.");
      }
    }
  };


  const buildAccumulatedBlob = (list: DraftIssue[]): string =>
    list
      .map((i, idx) => {
        const d = SEVERITY_DISPLAY[i.severity];
        return `${idx + 1}. ${d.emoji} ${d.label} — ${i.text}`;
      })
      .join("\n");

  const submit = async () => {
    if (submitting) return;

    if (!comfortDeclared) {
      toast.error("Please tick the comfort declaration to continue.");
      return;
    }
    if (startKm == null) {
      toast.error(
        askOdometer
          ? "Confirm the starting kilometres on the dash."
          : "Walkaround is not ready yet.",
      );
      return;
    }
    if (!driverPinVerified || !verifiedDriverPinRef.current) {
      setPinError("Driver PIN required.");
      toast.error("Driver PIN required.");
      return;
    }

    const pin = verifiedDriverPinRef.current;
    setSubmitting(true);
    setPinError(null);
    let insertedClearanceId: string | null = null;
    let driverStaffId = getActiveUserProfile()?.staffId ?? "";
    const releaseOffline = async () => {
      if (!driverStaffId || startKm == null) return false;
      await queueBusClearance({
        assetId: asset.id,
        clearanceDate: dateStr,
        driverStaffId,
        startOdometer: Math.round(startKm),
        items: issues.map((i) => ({
          checkpointId: null,
          checkpointLabel: i.text.slice(0, 80),
          passed: i.severity === "green",
          isMandatory: false,
          notes: i.text,
          severity:
            i.severity === "yellow" ? "yellow" : i.severity === "green" ? "green" : "red",
          workaroundText: i.text,
        })),
        accumulatedIssues: buildAccumulatedBlob(issues),
        driverComfortDeclared: comfortDeclared,
      });
      toast.success("Offline. Clearance queued on this tablet. Bus released.");
      onCleared(startKm);
      return true;
    };
    try {
      // PIN holder is the driver of record — must match submitDriverAuthorization.
      driverStaffId = await resolveOperatorStaffIdFromPin(pin);

      const items: NewClearanceItemInput[] = issues.map((i) => ({
        checkpointId: null,
        checkpointLabel: i.text.slice(0, 80),
        passed: i.severity === "green",
        isMandatory: false,
        notes: i.text,
        severity: i.severity,
        workaroundText: i.text,
      }));

      let clearanceId: string;
      const existing = await getClearanceForAssetOnDate(asset.id, dateStr);
      const reusedExisting = !!existing;
      if (existing) {
        // Orphan from a prior failed PIN lock-in, or Fast-Pass path skipped — finish auth.
        if (existing.status === "failed") {
          throw new Error(
            `Clearance failed for this vehicle on ${dateStr}. Office must clear it before dispatch.`,
          );
        }
        clearanceId = existing.id;
      } else {
        const bundle = await insertAssetClearanceWithItems({
          assetId: asset.id,
          clearanceDate: dateStr,
          driverStaffId,
          startOdometer: Math.round(startKm),
          items,
          accumulatedIssues: buildAccumulatedBlob(issues),
          driverComfortDeclared: comfortDeclared,
        });
        clearanceId = bundle.clearance.id;
        insertedClearanceId = clearanceId;

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
      }

      try {
        await submitDriverAuthorization(clearanceId, driverStaffId, pin);
      } catch (authErr) {
        // Don't leave a UNIQUE(asset, date) row that blocks the next attempt.
        if (insertedClearanceId) {
          await supabase
            .from("asset_daily_clearance")
            .delete()
            .eq("id", insertedClearanceId);
        }
        throw authErr;
      }

      toast.success("Declaration locked in", {
        description: `${asset.name} cleared for service.`,
      });

      // ALL bus/vehicle pre-trip issues land in Maintenance & Repairs (§14.2).
      // GREEN = low-priority note (dented panel, dirty windows); still needs follow-up.
      // A later driver on Fast Pass only mirrors issues logged in this sitting.
      const issuesToMirror = reusedExisting ? issues.filter((i) => i.fresh) : issues;
      if (issuesToMirror.length > 0) {
        (async () => {
          try {
            const staffId = driverStaffId || (await resolveStaffIdWithFallback());
            const reporterName = resolveStaffDisplayName(staffId);
            const locationLabel = `${asset.name} (${asset.regoPlate}) — Pre-trip ${formatDate(dateStr)}`;
            for (const issue of issuesToMirror) {
              const sev =
                issue.severity === "red-verbal-cleared"
                  ? "red"
                  : (issue.severity as "green" | "yellow" | "red");
              await createMaintenanceItem({
                title: issue.text.slice(0, 120),
                description: issue.text,
                severity: sev,
                source: "vehicle_issue",
                locationLabel,
                reportedBy: reporterName,
              });
            }
            queryClient.invalidateQueries({ queryKey: MAINTENANCE_ITEMS_KEY });
          } catch (maintErr) {
            console.error("[IssueAccumulatorPanel] maintenance_items mirror failed", maintErr);
          }
        })();
      }

      void queryClient.invalidateQueries({
        queryKey: ["asset-clearance", asset.id, dateStr],
      });
      onCleared(startKm);
    } catch (err) {
      if (isNetworkError(err)) {
        const released = await releaseOffline();
        if (released) return;
      }
      const msg = (err as Error).message;
      if (/pin/i.test(msg)) {
        setPinError("Incorrect PIN. Please try again.");
        setDriverPinVerified(false);
        verifiedDriverPinRef.current = "";
      }
      toast.error("Could not save clearance", {
        description: msg,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      <VehicleKnownIssues asset={asset} />

      <Card className="p-5">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-blue-600" />
          <h2 className="text-lg font-extrabold">
            Daily Walkaround — {asset.name}
          </h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {alreadyCleared
            ? askOdometer
              ? `${asset.regoPlate} · Already cleared today. Known issues are listed above. Confirm the kilometres, and log only something new.`
              : `${asset.regoPlate} · Already cleared today. Known issues are listed above. Log only something new.`
            : askOdometer
              ? `${asset.regoPlate} · Known issues are listed above. Confirm the kilometres, then log only a new fault. Tag it Green, Yellow, or RED.`
              : `${asset.regoPlate} · Known issues are listed above. Log only a new fault. Tag it Green, Yellow, or RED.`}
        </p>

        {askOdometer ? (
          <div className="mt-5">
            <StartingKmConfirm assetId={asset.id} onReading={setStartKm} />
          </div>
        ) : null}

        {/* ---------------- Accumulated issues stack ---------------- */}
        <div className="mt-5 space-y-2">
          {issues.length === 0 && (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
              No issues logged yet. Add one below, or jump straight to the
              comfort declaration if the vehicle is fully clean.
            </div>
          )}
          {issues.map((i, idx) => {
            const d = SEVERITY_DISPLAY[i.severity];
            return (
              <div
                key={i.id}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3",
                  i.severity === "yellow"
                    ? "border-yellow-500/70 bg-yellow-400/10"
                    : i.severity === "red" || i.severity === "red-verbal-cleared"
                    ? "border-red-600/40 bg-red-600/5"
                    : "border-green-600/40 bg-green-600/5",
                )}
              >
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-1 text-[10px] font-extrabold tracking-wide",
                    d.cls,
                  )}
                >
                  #{idx + 1} · {d.label}
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
          <Plus className="h-4 w-4" /> Log a New Issue
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
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Driver Onboarding PIN
              </Label>
              <PinEntryTrigger
                label="Tap to enter driver PIN"
                verified={driverPinVerified}
                verifiedLabel="Driver PIN verified"
                length={pinLength}
                title="Driver comfort declaration"
                description="Confirms you are comfortable operating this vehicle today."
                onVerify={verifyOperatorPin}
                onSuccess={(pin) => {
                  verifiedDriverPinRef.current = pin;
                  setDriverPinVerified(true);
                  setPinError(null);
                }}
              />
              {pinError && (
                <p className="text-xs font-medium text-destructive">{pinError}</p>
              )}
            </div>
          </div>
        )}

        {(() => {
          const missing: string[] = [];
          if (askOdometer && startKm == null) missing.push("confirm the starting kilometres");
          if (hasRed) missing.push("clear the RED issue");
          else {
            if (!comfortDeclared) missing.push("comfort declaration");
            if (!driverPinVerified) missing.push("driver PIN");
          }
          if (missing.length === 0) return null;
          return (
            <div className="mt-5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Still needed: {missing.join(" · ")}
            </div>
          );
        })()}

        <button
          type="button"
          disabled={
            submitting ||
            hasRed ||
            (askOdometer && startKm == null) ||
            !comfortDeclared ||
            !driverPinVerified
          }
          onClick={submit}
          className={cn(
            "mt-5 h-14 w-full rounded-xl font-bold text-white shadow transition",
            "bg-blue-600 hover:bg-blue-700",
            (submitting ||
              hasRed ||
              (askOdometer && startKm == null) ||
              !comfortDeclared ||
              !driverPinVerified) &&
              "opacity-60 cursor-not-allowed",
          )}
        >
          {submitting ? "Saving…" : askOdometer ? "Lock In Declaration & Roll" : "Lock in walkaround"}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="mt-2 h-10 w-full rounded-xl text-sm font-semibold text-muted-foreground transition hover:text-foreground"
        >
          {alreadyCleared ? "← Back to fast-pass" : "← Change vehicle"}
        </button>
      </Card>

      {/* Reentrant unified Issue/Escalation engine — pre-trip context.
          Green/Yellow → accumulator + operational_incidents write-through.
          Red          → open VerbalConsultationDialog (remote verbal
                         consultation) and, on accept, write a sev1
                         operational_incidents row with the canonical
                         "[VERBAL WORKAROUND]" prefix. */}
      <LogAnomalyModal
        open={logOpen}
        onOpenChange={setLogOpen}
        context={{
          kind: "pre-trip",
          asset: { id: asset.id, name: asset.name, regoPlate: asset.regoPlate },
          driverName,
          dateStr,
          onLogged: async (draft) => {
            const severity = draft.severity as ClearanceIssueSeverity;
            const text = draft.workaround
              ? `${draft.description} — Workaround: ${draft.workaround}`
              : draft.description;
            const localId = freshId();
            setIssues((prev) => [
              ...prev,
              { id: localId, severity, text, fresh: true },
            ]);
            const incidentSev = sevToIncident(severity);
            if (!incidentSev) return;
            try {
              const { data, error } = await supabase
                .from("operational_incidents")
                .insert({
                  incident_type: "mechanical",
                  severity: incidentSev,
                  description: `${PRE_TRIP_TAG} ${text}`,
                  vehicle_id: asset.id,
                  reported_by: driverName || "driver",
                  status: "pending",
                  occurred_at: draft.occurredAt,
                })
                .select("id")
                .single();
              if (error) throw error;
              const incidentId = String(data.id);
              setIssues((prev) =>
                prev.map((i) =>
                  i.id === localId ? { ...i, incidentId } : i,
                ),
              );
            } catch (err) {
              console.error(
                "[IssueAccumulatorPanel] write-ahead incident failed",
                err,
              );
              toast.error("Logged locally but not synced to Governance Hub", {
                description: (err as Error).message,
              });
            }
          },
          onRedRequested: (description, owner, meta) => {
            setVerbalPending({
              description,
              owner,
              occurredAt: meta.occurredAt,
            });
          },
        }}
      />

      {/* Canonical RED path — Verbal Consultation & Log */}
      <VerbalConsultationDialog
        open={!!verbalPending}
        onOpenChange={(o) => {
          if (!o) setVerbalPending(null);
        }}
        ledgerCategory="VEHICLE"
        subjectLabel={`${asset.name} · ${asset.regoPlate}`}
        sourceId={null}
        actionType="RED_VERBAL_CONSULTATION"
        titleOverride="RED Verbal Consultation & Log"
        descriptionOverride="A RED anomaly was identified on the walkaround. Select the manager you contacted (or attempted to reach), record the outcome, and sign with your operator PIN. This ticket lands in the Governance Hub immediately; the manager confirms later."
        onAccepted={async (payload) => {
          if (!verbalPending) return;
          const prefixed = formatVerbalWorkaroundDescription(
            verbalPending.description,
            payload,
          );
          const localId = freshId();
          // Use "red-verbal-cleared" sentinel so hasRed stays false and the
          // final submit unblocks immediately (GUARDRAILS §3 — "local module
          // unblocks immediately" after verbal consultation is on record).
          setIssues((prev) => [
            ...prev,
            { id: localId, severity: "red-verbal-cleared", text: prefixed, fresh: true },
          ]);
          try {
            const { data, error } = await supabase
              .from("operational_incidents")
              .insert({
                incident_type: "mechanical",
                severity: "sev1",
                description: `${PRE_TRIP_TAG} ${prefixed}`,
                vehicle_id: asset.id,
                reported_by: driverName || "driver",
                status: "pending",
                occurred_at: verbalPending.occurredAt,
              })
              .select("id")
              .single();
            if (error) throw error;
            const incidentId = String(data.id);
            setIssues((prev) =>
              prev.map((i) =>
                i.id === localId ? { ...i, incidentId } : i,
              ),
            );
          } catch (err) {
            console.error(
              "[IssueAccumulatorPanel] verbal-workaround incident insert failed",
              err,
            );
            toast.error("Verbal workaround logged to ledger, but Hub sync failed", {
              description: (err as Error).message,
            });
          }
          setVerbalPending(null);
        }}
      />
    </div>
  );
}

export { COMFORT_DECLARATION_TEXT };
export type { DraftIssue };
