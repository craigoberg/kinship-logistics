import { useEffect, useMemo, useState } from "react";
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
import { VerbalAuthOverrideDialog } from "@/components/issue-engine/verbal-auth-override-dialog";
import { supabase } from "@/integrations/supabase/client";

import type {
  AssetCheckpoint,
  ClearanceIssueSeverity,
  NewClearanceItemInput,
  TransportAsset,
} from "@/lib/data-store";
import {
  DEFAULT_STAFF_UUID,
  getStaffId,
  insertAssetClearanceWithItems,
  submitDriverAuthorization,
} from "@/lib/data-store";
import { triggerInspectionAlert, toSeverity } from "@/hooks/use-notification-router";
// RedHandshakeWaitingPanel removed — single-user verbal flow replaces the
// multi-device handshake; RED issues now route through VerbalAuthOverrideDialog.

const COMFORT_DECLARATION_TEXT =
  "I confirm that all issues have been cleanly recorded, appropriate workarounds are deployed, and I am personally comfortable, oriented, and acting in accordance with my signed Organization Onboarding Guidelines to operate safely today.";

const PRE_TRIP_TAG = "[Pre-trip]";

interface DraftIssue {
  id: string;
  /** Backing operational_incidents.id when persisted (Green/Yellow). */
  incidentId?: string;
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
}

export function IssueAccumulatorPanel({
  asset,
  startOdometer,
  dateStr,
  checkpoints,
  driverName,
  onCleared,
  onBack,
}: Props) {
  const [issues, setIssues] = useState<DraftIssue[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [comfortDeclared, setComfortDeclared] = useState(false);
  const [driverPin, setDriverPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Pending RED draft awaiting verbal authorization. When non-null, the
  // VerbalAuthOverrideDialog is open and gates the next ledger + incident
  // write.
  const [verbalPending, setVerbalPending] = useState<{
    description: string;
    owner: "internal" | "council";
  } | null>(null);

  const vehicleInfo = `${asset.name} · ${asset.regoPlate}`;
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
      setPinError("Incorrect PIN. Please try again.");
      toast.error("Incorrect PIN. Please try again.");
      return;
    }

    setSubmitting(true);
    setPinError(null);
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
      const msg = (err as Error).message;
      if (/pin/i.test(msg)) {
        setPinError("Incorrect PIN. Please try again.");
        setDriverPin("");
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
                onChange={(e) => {
                  setDriverPin(e.target.value.replace(/\D/g, "").slice(0, 4));
                  if (pinError) setPinError(null);
                }}
                onFocus={() => pinError && setPinError(null)}
                placeholder="----"
                aria-invalid={!!pinError}
                className={cn(
                  "h-12 max-w-[180px] text-center text-lg tracking-[0.6em] tabular-nums",
                  pinError && "border-2 border-destructive focus-visible:ring-destructive",
                )}
              />
              {pinError && (
                <p className="text-xs font-medium text-destructive">{pinError}</p>
              )}
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
          Green/Yellow → accumulator + operational_incidents write-through.
          Red          → open VerbalAuthOverrideDialog (single-user verbal
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
              { id: localId, severity, text },
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
          onRedRequested: (description, owner) => {
            setVerbalPending({ description, owner });
          },
        }}
      />

      {/* Canonical RED path — Verbal Consultation & Log */}
      <VerbalAuthOverrideDialog
        open={!!verbalPending}
        onOpenChange={(o) => {
          if (!o) setVerbalPending(null);
        }}
        ledgerCategory="VEHICLE"
        subjectLabel={`${asset.name} · ${asset.regoPlate}`}
        sourceId={null}
        actionType="RED_VERBAL_WORKAROUND"
        titleOverride="RED Verbal Consultation & Log"
        descriptionOverride="A RED anomaly was identified on the walkaround. Document the manager you spoke with offline, the agreed safety workaround, and sign with your operator PIN. This ticket lands in the Governance Hub immediately as 'Open — Operating via Verbal Workaround' and your local workspace unblocks straight away."
        onAccepted={async ({ managerName, reason }) => {
          if (!verbalPending) return;
          const prefixed = `[VERBAL WORKAROUND] ${verbalPending.description} — Authorising Manager: ${managerName}. Plan: ${reason}`;
          const localId = freshId();
          setIssues((prev) => [
            ...prev,
            { id: localId, severity: "red", text: prefixed },
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
