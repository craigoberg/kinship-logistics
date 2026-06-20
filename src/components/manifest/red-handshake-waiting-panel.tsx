import { useEffect, useState } from "react";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
  /** Route-guard escalation object rendered directly before hooks. */
  escalation?: any;
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
}: Props) {
  // Branch by mode. Escalation mode (Sev 1) is purely office-resolved; the
  // clearance mode is the original dual-PIN walkaround handshake.
  if (escalationId) {
    return (
      <EscalationWaitingPanel
        asset={asset}
        driverName={driverName}
        escalationId={escalationId}
        onAuthorized={onAuthorized}
        onBack={onBack}
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
      asset={asset}
      clearance={clearance}
      issues={issues ?? []}
      driverName={driverName}
      onAuthorized={onAuthorized}
      onBack={onBack}
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
      <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
        <ShieldAlert className="h-6 w-6" />
        <h2 className="text-lg font-extrabold">Awaiting Manager Joint Review</h2>
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
  onAuthorized,
  onBack,
}: {
  asset: TransportAsset;
  driverName: string;
  escalationId: string;
  onAuthorized: () => void;
  onBack: () => void;
}) {
  const [live, setLive] = useState<OperationalEscalation | null>(null);
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const off = subscribeToEscalation(escalationId, (next) => setLive(next));
    return off;
  }, [escalationId]);

  const status = live?.status ?? "pending";
  const claimed = status === "claimed";
  const approved = status === "resolved_approved";
  const denied = status === "resolved_denied";

  useEffect(() => {
    if (denied) {
      toast.error("Office denied escalation", {
        description: "Resolve the underlying gate before attempting again.",
      });
      onBack();
    }
  }, [denied, onBack]);

  const submitDeclaration = async () => {
    if (submitting) return;
    if (!/^\d{4}$/.test(pin)) {
      toast.error("Enter your 4-digit onboarding PIN.");
      return;
    }
    setSubmitting(true);
    try {
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

  if (approved) {
    return (
      <Card className="border-2 border-emerald-600/70 bg-slate-950 p-5 text-slate-100">
        <div className="flex items-center gap-2 text-emerald-300">
          <ShieldCheck className="h-6 w-6" />
          <h2 className="text-lg font-extrabold">
            ✅ Manager Workaround Authorized
          </h2>
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
      <div className="flex items-center gap-2 text-rose-700 dark:text-rose-300">
        <ShieldAlert className="h-6 w-6" />
        <h2 className="text-lg font-extrabold">Sev 1 Escalation — Office Review</h2>
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
