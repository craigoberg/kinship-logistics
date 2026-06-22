import { useEffect, useState } from "react";
import { Loader2, PhoneCall, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ElapsedTimer } from "@/components/ui/elapsed-timer";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { VerbalAuthOverrideDialog } from "@/components/issue-engine/verbal-auth-override-dialog";
import { writeToLedger, tryGetGps } from "@/lib/api/ledger";

import type {
  AssetDailyClearance,
  OperationalEscalation,
  TransportAsset,
} from "@/lib/data-store";
import {
  DEFAULT_STAFF_UUID,
  getStaffId,
  submitDriverAuthorization,
  subscribeToClearance,
  subscribeToEscalation,
  verifyStaffPin,
} from "@/lib/data-store";
import type { DraftIssue } from "./issue-accumulator-panel";

interface Props {
  asset?: TransportAsset;
  driverName?: string;
  onAuthorized?: () => void;
  onBack?: () => void;
  /** Clearance-based dual-PIN handshake (RED walkaround issue). */
  clearance?: AssetDailyClearance;
  issues?: DraftIssue[];
  /** Office-pool escalation handshake (Sev 1 raised from a missing gate). */
  escalationId?: string;
  /** Full escalation row used to surface details + gate metadata. */
  escalation?: OperationalEscalation | null;
}

function issueChip(
  s: DraftIssue["severity"],
): { tone: string; emoji: string; label: string } {
  if (s === "red") return { tone: "bg-red-600 text-white", emoji: "🛑", label: "RED" };
  if (s === "yellow")
    return { tone: "bg-yellow-400 text-black", emoji: "🟡", label: "YELLOW" };
  return { tone: "bg-green-600 text-white", emoji: "🟢", label: "GREEN" };
}

export function RedHandshakeWaitingPanel({
  asset,
  clearance,
  issues,
  driverName,
  onAuthorized,
  onBack,
  escalationId,
  escalation,
}: Props) {
  // Branch by mode. Escalation mode (Sev 1) is purely office-resolved; the
  // clearance mode is the original dual-PIN walkaround handshake.
  if (escalationId) {
    return (
      <EscalationWaitingPanel
        asset={asset!}
        driverName={driverName!}
        escalationId={escalationId}
        escalation={escalation ?? null}
        issues={issues ?? []}
        onAuthorized={onAuthorized!}
        onBack={onBack!}
      />
    );
  }
  if (!clearance) {
    return (
      <Card className="p-5">
        <p className="text-sm text-muted-foreground">
          Missing handshake context.
        </p>
        <Button onClick={onBack} className="mt-4" variant="outline">
          ← Back
        </Button>
      </Card>
    );
  }
  return (
    <ClearanceWaitingPanel
      asset={asset!}
      clearance={clearance}
      issues={issues ?? []}
      driverName={driverName!}
      onAuthorized={onAuthorized!}
      onBack={onBack!}
    />
  );
}

// ───────────────────────── Clearance dual-PIN ─────────────────────────

function ClearanceWaitingPanel({
  asset,
  clearance,
  issues,
  driverName,
  onAuthorized,
  onBack,
}: {
  asset: TransportAsset;
  clearance: AssetDailyClearance;
  issues: DraftIssue[];
  driverName: string;
  onAuthorized: () => void;
  onBack: () => void;
}) {
  const [live, setLive] = useState<AssetDailyClearance>(clearance);
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const off = subscribeToClearance(clearance.id, (next) => setLive(next));
    return off;
  }, [clearance.id]);

  const managerCleared = !!live.managerAuthPinVerifiedAt;
  const fullyAuthorized = live.status === "authorized_override";

  useEffect(() => {
    if (fullyAuthorized) {
      toast.success("Joint review complete", {
        description: "Dual PINs confirmed — vehicle authorized to proceed.",
      });
      onAuthorized();
    }
  }, [fullyAuthorized, onAuthorized]);

  const submitDriver = async () => {
    if (submitting) return;
    if (!/^\d{4}$/.test(pin)) {
      toast.error("Enter your 4-digit onboarding PIN.");
      return;
    }
    setSubmitting(true);
    try {
      const driverStaffId = getStaffId() || DEFAULT_STAFF_UUID;
      const next = await submitDriverAuthorization(clearance.id, driverStaffId, pin);
      setLive(next);
    } catch (err) {
      toast.error("Driver PIN rejected", {
        description: (err as Error).message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="border-2 border-red-600/70 bg-red-600/5 p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
          <ShieldAlert className="h-6 w-6" />
          <h2 className="text-lg font-extrabold">Awaiting Manager Joint Review</h2>
        </div>
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-800 dark:text-amber-200">
          <ElapsedTimer
            since={live.createdAt}
            label={managerCleared ? "Approved" : "Waiting"}
          />
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {asset.name} · {asset.regoPlate} · Driver {driverName}
      </p>


      <div className="mt-4 rounded-md border border-border bg-background/60 p-3">
        <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Accumulated issues sent to manager
        </div>
        <ol className="mt-2 space-y-2">
          {issues.map((i, idx) => {
            const c = issueChip(i.severity);
            return (
              <li key={i.id} className="flex items-start gap-2 text-sm">
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold",
                    c.tone,
                  )}
                >
                  #{idx + 1} {c.label}
                </span>
                <span>{i.text}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="mt-4 flex items-center gap-3 rounded-md border border-border bg-background/60 p-3">
        {managerCleared ? (
          <ShieldCheck className="h-5 w-5 text-green-600" />
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-amber-600" />
        )}
        <div className="text-sm">
          <div className="font-semibold">
            Manager authorization {managerCleared ? "confirmed" : "pending"}
          </div>
          <div className="text-xs text-muted-foreground">
            {managerCleared
              ? "Manager PIN verified. Enter your driver PIN to complete the handshake."
              : "Operations Dashboard has been notified. Awaiting supervisor PIN…"}
          </div>
        </div>
      </div>

      {managerCleared && (
        <div className="mt-4 rounded-md border-2 border-green-600/50 bg-green-600/5 p-3">
          <Label
            htmlFor="driver-pin-red"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Driver Onboarding PIN
          </Label>
          <div className="mt-1 flex items-center gap-2">
            <Input
              id="driver-pin-red"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              autoComplete="off"
              value={pin}
              onChange={(e) =>
                setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              placeholder="••••"
              className="h-12 max-w-[160px] text-center text-lg tracking-[0.6em] tabular-nums"
            />
            <Button
              type="button"
              onClick={submitDriver}
              disabled={submitting || pin.length !== 4}
              className="h-12 flex-1 bg-green-600 hover:bg-green-700"
            >
              {submitting ? "Confirming…" : "Confirm Driver PIN"}
            </Button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onBack}
        className="mt-4 h-10 w-full rounded-xl text-sm font-semibold text-muted-foreground transition hover:text-foreground"
      >
        ← Back to vehicle pick (cancels this attempt)
      </button>
    </Card>
  );
}

// ───────────────────────── Sev 1 escalation pool ─────────────────────────

function EscalationWaitingPanel({
  asset,
  driverName,
  escalationId,
  escalation,
  issues,
  onAuthorized,
  onBack,
}: {
  asset: TransportAsset;
  driverName: string;
  escalationId: string;
  escalation: OperationalEscalation | null;
  issues: DraftIssue[];
  onAuthorized: () => void;
  onBack: () => void;
}) {
  const [live, setLive] = useState<OperationalEscalation | null>(escalation);
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [verbalOpen, setVerbalOpen] = useState(false);
  const [sourceText, setSourceText] = useState<string | null>(null);

  useEffect(() => {
    const off = subscribeToEscalation(escalationId, (next) => setLive(next));
    return off;
  }, [escalationId]);

  // Best-effort: fetch the originating issue description so the driver sees
  // exactly what was sent to the office. Sourced from either
  // operational_incidents (bus walkaround) or site_issues_register (site day).
  useEffect(() => {
    const sourceId = live?.sourceIssueId ?? escalation?.sourceIssueId ?? null;
    const sourceKind = live?.sourceKind ?? escalation?.sourceKind ?? null;
    if (!sourceId) {
      setSourceText(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const table =
          sourceKind === "site_day_red" ? "site_issues_register" : "operational_incidents";
        const column = table === "site_issues_register" ? "issue_description" : "description";
        const { data, error } = await supabase
          .from(table)
          .select(`${column}`)
          .eq("id", sourceId)
          .maybeSingle();
        if (error) throw error;
        if (cancelled) return;
        const raw = (data as Record<string, unknown> | null)?.[column];
        setSourceText(raw ? String(raw).replace(/^\[Pre-trip\]\s*/i, "") : null);
      } catch (err) {
        console.warn("[EscalationWaitingPanel] source-issue fetch failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [live?.sourceIssueId, live?.sourceKind, escalation?.sourceIssueId, escalation?.sourceKind]);


  const status = live?.status ?? "pending";
  const claimed = status === "claimed";
  const approved = status === "resolved_approved";
  const denied = status === "resolved_denied";


  const submitDeclaration = async () => {
    if (submitting) return;
    if (!/^\d{4}$/.test(pin)) {
      toast.error("Enter your 4-digit onboarding PIN.");
      return;
    }
    setSubmitting(true);
    try {
      const driverStaffId = getStaffId() || DEFAULT_STAFF_UUID;

      // 1) Verify the driver's PIN before mutating anything.
      const pinOk = await verifyStaffPin(driverStaffId, pin);
      if (!pinOk) {
        throw new Error("Driver PIN does not match this account.");
      }

      // 2) Ledger receipt FIRST so the NDIS trail exists even if the
      //    escalation update races or fails.
      try {
        const gps = await tryGetGps();
        await writeToLedger({
          staff_id: driverStaffId,
          category: "VEHICLE",
          severity: "RED",
          action_type: "escalation.operator_acknowledged",
          gps_lat: gps?.lat ?? null,
          gps_lng: gps?.lng ?? null,
          metadata: {
            escalation_id: escalationId,
            asset_id: asset.id,
            vehicle_info: `${asset.name} · ${asset.regoPlate}`,
            driver_name: driverName,
            manager_notes: live?.resolutionNotes ?? null,
            acknowledged_by_staff_id: driverStaffId,
          },
        });
      } catch (ledgerErr) {
        console.warn(
          "[EscalationWaitingPanel] ledger write failed (continuing)",
          ledgerErr,
        );
      }

      // 3) Flip the escalation row to "operator acknowledged" so the
      //    manifest shield drops and the Hub row clears.
      const { error: updErr } = await supabase
        .from("operational_escalations")
        .update({
          operator_acknowledged_at: new Date().toISOString(),
          operator_acknowledged_by: driverStaffId,
        })
        .eq("id", escalationId);
      if (updErr) throw updErr;

      toast.success("Workaround declaration accepted", {
        description: "Driver PIN confirmed — you are cleared to roll.",
      });
      onAuthorized();
    } catch (err) {
      toast.error("Could not finalize declaration", {
        description: (err as Error).message,
      });
    } finally {
      setSubmitting(false);
    }
  };


  if (denied) {
    return (
      <Card className="border-2 border-destructive bg-destructive/5 p-5">
        <div className="flex items-center gap-2 text-destructive">
          <ShieldAlert className="h-6 w-6" />
          <h2 className="text-lg font-extrabold">❌ Workaround Denied</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          The office has reviewed and denied this Sev 1 escalation request.
        </p>
        {live?.resolutionNotes?.trim() && (
          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-destructive">
              Manager's denial notes
            </div>
            <blockquote className="mt-2 border-l-2 border-destructive/60 pl-3 text-sm italic">
              {live.resolutionNotes}
            </blockquote>
          </div>
        )}
        <Button className="w-full mt-4" variant="destructive" onClick={onBack}>
          Acknowledge & Change Vehicle
        </Button>
      </Card>
    );
  }

  if (approved) {
    return (
      <Card className="border-2 border-emerald-600/70 bg-slate-950 p-5 text-slate-100">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-emerald-300">
            <ShieldCheck className="h-6 w-6" />
            <h2 className="text-lg font-extrabold">
              ✅ Manager Workaround Authorized
            </h2>
          </div>
          <div className="rounded border border-emerald-600/40 bg-emerald-600/10 px-2 py-1 text-emerald-200">
            <ElapsedTimer
              since={live?.resolvedAt ?? live?.createdAt ?? null}
              label="Awaiting your PIN"
            />
          </div>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          {asset.name} · {asset.regoPlate} · Driver {driverName}
        </p>


        <div className="mt-4 rounded-md border border-emerald-600/40 bg-emerald-600/10 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-300">
            Manager's authorized workaround notes
          </div>
          <blockquote className="mt-2 border-l-2 border-emerald-500/60 pl-3 text-sm italic text-slate-100">
            {live?.resolutionNotes?.trim()
              ? live.resolutionNotes
              : "No additional notes were provided."}
          </blockquote>
        </div>

        <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          By submitting my PIN, I confirm that I have read the manager's
          authorized workaround instructions, accept the operational
          conditions, and am comfortable to proceed with this run safely
          today.
        </div>

        <div className="mt-4 rounded-md border-2 border-emerald-600/50 bg-slate-900 p-3">
          <Label
            htmlFor="driver-pin-escalation"
            className="text-xs uppercase tracking-wide text-slate-400"
          >
            Driver Onboarding PIN
          </Label>
          <div className="mt-1 flex items-center gap-2">
            <Input
              id="driver-pin-escalation"
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
              placeholder="••••"
              className="h-12 max-w-[160px] text-center text-lg tracking-[0.6em] tabular-nums"
            />
            <Button
              type="button"
              onClick={submitDeclaration}
              disabled={submitting || pin.length !== 4}
              className="h-12 flex-1 bg-emerald-600 hover:bg-emerald-700"
            >
              {submitting ? "Confirming…" : "Confirm & Release Run"}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-rose-600/70 bg-rose-600/5 p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-rose-700 dark:text-rose-300">
          <ShieldAlert className="h-6 w-6" />
          <h2 className="text-lg font-extrabold">Sev 1 Escalation — Office Review</h2>
        </div>
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-800 dark:text-amber-200">
          <ElapsedTimer
            since={live?.createdAt ?? null}
            label={claimed ? "Claimed" : "Waiting"}
          />
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {asset.name} · {asset.regoPlate} · Driver {driverName}
      </p>


      <div className="mt-4 flex items-center gap-3 rounded-md border border-border bg-background/60 p-3">
        <Loader2 className="h-5 w-5 animate-spin text-amber-600" />
        <div className="text-sm">
          <div className="font-semibold">
            Awaiting office authorization for Sev 1 escalation
          </div>
          <div className="text-xs text-muted-foreground">
            {claimed
              ? `Claimed by ${live?.claimedBy ?? "an operator"} — decision incoming…`
              : "Broadcast to the office dashboard pool. The first available operator will pick it up."}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        Do not roll until the office returns a decision. If this takes more than
        a few minutes, call the office on the direct line.
      </div>

      <Button
        type="button"
        variant="outline"
        className="mt-3 w-full border-amber-500/60 bg-amber-500/10 text-amber-800 hover:bg-amber-500/20 dark:text-amber-200"
        onClick={() => setVerbalOpen(true)}
      >
        <PhoneCall className="mr-1.5 h-4 w-4" />
        Manager unreachable — record verbal override
      </Button>

      <button
        type="button"
        onClick={onBack}
        className="mt-4 h-10 w-full rounded-xl text-sm font-semibold text-muted-foreground transition hover:text-foreground"
      >
        ← Back to vehicle pick (cancels this attempt)
      </button>

      <VerbalAuthOverrideDialog
        open={verbalOpen}
        onOpenChange={setVerbalOpen}
        ledgerCategory="VEHICLE"
        subjectLabel={`${asset.name} · ${asset.regoPlate}`}
        sourceId={escalationId}
        onAccepted={onAuthorized}
      />
    </Card>
  );
}
