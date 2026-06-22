import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Loader2, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ClientTime } from "@/components/ui/client-time";
import { SITE_SESSION_QUERY_KEY } from "@/hooks/use-site-session";
import {
  submitLeaderHandshake,
  type SiteDaySession,
} from "@/lib/api/site-day-sessions";
import { writeToLedger, tryGetGps } from "@/lib/api/ledger";
import {
  getActiveUserProfile,
  getEscalationBySourceIssue,
  getStaffDisplayName,
  rejectEscalationProposal,
  resolveOperationalEscalation,
  subscribeToEscalation,
  verifyStaffPin,
} from "@/lib/data-store";
import type { SiteIssue } from "@/lib/api/site-issues";

interface Props {
  session: SiteDaySession;
  redIssue: SiteIssue | null;
}

/**
 * Opener-side panel for the Day Centre escalation handshake.
 *
 *   pending                                → "Awaiting Manager pickup…"
 *   claimed & no manager decision yet      → "Manager is reviewing…"
 *   claimed & manager_decision != null     → Opener review: Accept / Reject
 *   resolved_*                              → nothing rendered (parent collapses)
 *
 * Accept  → submitLeaderHandshake(decision = manager's) + resolveOperationalEscalation
 * Reject  → rejectEscalationProposal — clears manager fields, reverts phase
 *           to open_pending, leaves the RED site_issue open for the Hub.
 */
export function EscalationResolutionPanel({ session, redIssue }: Props) {
  const queryClient = useQueryClient();

  const escQ = useQuery({
    queryKey: ["site-escalation", redIssue?.id ?? "none"],
    queryFn: () =>
      redIssue ? getEscalationBySourceIssue(redIssue.id) : Promise.resolve(null),
    enabled: !!redIssue,
    staleTime: 5_000,
  });
  const escalation = escQ.data ?? null;

  // Realtime: refetch when the row flips pending → claimed → resolved.
  useEffect(() => {
    if (!escalation) return;
    const off = subscribeToEscalation(escalation.id, (next) => {
      queryClient.setQueryData(
        ["site-escalation", redIssue?.id ?? "none"],
        next,
      );
    });
    return off;
  }, [escalation?.id, queryClient, redIssue?.id]);

  // Claiming manager name lookup (cached).
  const managerNameQ = useQuery({
    queryKey: ["staff-name", escalation?.claimedBy ?? "none"],
    queryFn: () =>
      escalation?.claimedBy
        ? getStaffDisplayName(escalation.claimedBy)
        : Promise.resolve(null),
    enabled: !!escalation?.claimedBy,
    staleTime: 60_000,
  });
  const claimedByName = managerNameQ.data ?? "the on-call Manager";

  const [openerPin, setOpenerPin] = useState("");
  const [attempted, setAttempted] = useState(false);

  const acceptMutation = useMutation({
    mutationFn: async () => {
      if (!escalation) throw new Error("No escalation to resolve.");
      if (!escalation.claimedBy)
        throw new Error("Escalation has not been claimed yet.");
      if (!session.managerDecision)
        throw new Error("Manager has not proposed a decision yet.");
      if (!/^\d{4,6}$/.test(openerPin))
        throw new Error("Enter your 4–6 digit Opener PIN.");

      const leaderStaffId = session.openedById ?? getActiveUserProfile()?.staffId ?? null;
      if (!leaderStaffId)
        throw new Error(
          "No signed-in staff to authorise this action — please sign in again.",
        );

      const ok = await verifyStaffPin(leaderStaffId, openerPin);
      if (!ok)
        throw new Error("Opener PIN does not match the staff who opened the day.");

      // 1. Leader handshake matching the manager's decision.
      const nextSession = await submitLeaderHandshake({
        sessionId: session.id,
        decision: session.managerDecision,
        leaderStaffId,
        pin: openerPin,
      });

      // 2. Close out the escalation row.
      await resolveOperationalEscalation({
        id: escalation.id,
        approved: session.managerDecision === "go",
        managerStaffId: escalation.claimedBy,
        notes: session.managerPlanText ?? escalation.resolutionNotes ?? "",
      });

      // 3. Ledger receipt.
      try {
        const gps = await tryGetGps();
        await writeToLedger({
          staff_id: leaderStaffId,
          category: "CENTRE",
          severity: session.managerDecision === "go" ? "GREEN" : "RED",
          action_type:
            session.managerDecision === "go"
              ? "governance.escalation_resolved"
              : "governance.escalation_no_go",
          gps_lat: gps?.lat ?? null,
          gps_lng: gps?.lng ?? null,
          metadata: {
            escalation_id: escalation.id,
            session_id: session.id,
            source_issue_id: escalation.sourceIssueId,
            manager_staff_id: escalation.claimedBy,
            opener_staff_id: leaderStaffId,
            decision: session.managerDecision,
          },
        });
      } catch (e) {
        console.warn("[EscalationResolutionPanel:accept] ledger failed", e);
      }

      return { nextSession, approved: session.managerDecision === "go" };
    },
    onSuccess: ({ nextSession, approved }) => {
      queryClient.setQueryData(SITE_SESSION_QUERY_KEY, nextSession);
      queryClient.invalidateQueries({ queryKey: ["site-escalation"] });
      setOpenerPin("");
      if (approved) {
        toast.success("Manager plan accepted — Centre is open.");
      } else {
        toast.error("NO-GO accepted — Centre will remain closed for the day.");
      }
    },
    onError: (e: Error) => {
      toast.error("Could not accept the proposal", { description: e.message });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (reason: string) => {
      if (!escalation) throw new Error("No escalation to reject.");
      if (!/^\d{4,6}$/.test(openerPin))
        throw new Error("Enter your 4–6 digit Opener PIN.");
      const leaderStaffId = session.openedById ?? getActiveUserProfile()?.staffId ?? null;
      if (!leaderStaffId)
        throw new Error("No signed-in staff to authorise rejection — please sign in again.");

      await rejectEscalationProposal({
        escalationId: escalation.id,
        sessionId: session.id,
        openerStaffId: leaderStaffId,
        pin: openerPin,
        reason,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SITE_SESSION_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["site-escalation"] });
      queryClient.invalidateQueries({ queryKey: ["site-issues"] });
      setOpenerPin("");
      setRejectOpen(false);
      setRejectReason("");
      setRejectAttempted(false);
      toast.success("Proposal rejected.", {
        description:
          "Centre returned to Open Pending. RED issue stays in the Open Issues list until resolved in the Hub.",
      });
    },
    onError: (e: Error) => {
      toast.error("Could not reject the proposal", { description: e.message });
    },
  });

  // Reject reason mini-dialog state
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectAttempted, setRejectAttempted] = useState(false);
  const rejectReasonValid = rejectReason.trim().length >= 10;
  const showRejectReasonError = rejectAttempted && !rejectReasonValid;

  // ── States ─────────────────────────────────────────────────────────────
  if (escQ.isLoading) {
    return (
      <Card className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Locating the escalation
        record…
      </Card>
    );
  }

  if (!escalation) {
    return (
      <Card className="flex items-start gap-3 border-yellow-500/60 bg-yellow-500/5 p-4">
        <Clock className="mt-0.5 h-5 w-5 text-yellow-600" />
        <div className="space-y-1">
          <div className="font-semibold">Awaiting escalation pickup…</div>
          <p className="text-sm text-muted-foreground">
            A Red anomaly has been logged but no live escalation record was
            found yet. The on-call Manager has been notified — this panel
            will update automatically.
          </p>
        </div>
      </Card>
    );
  }

  if (escalation.status === "pending") {
    return (
      <Card className="flex items-start gap-3 border-yellow-500/60 bg-yellow-500/5 p-4">
        <Clock className="mt-0.5 h-5 w-5 text-yellow-600" />
        <div className="space-y-1">
          <div className="font-semibold">Awaiting Manager pickup</div>
          <p className="text-sm text-muted-foreground">
            Raised <ClientTime iso={escalation.createdAt} />. An on-call
            Manager will claim this incident and reach out to negotiate the
            response plan. This panel will update automatically when they
            claim it.
          </p>
        </div>
      </Card>
    );
  }

  // claimed but manager has not yet proposed a plan
  if (escalation.status === "claimed" && !session.managerDecision) {
    return (
      <Card className="flex items-start gap-3 border-yellow-500/60 bg-yellow-500/10 p-4">
        <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-amber-600" />
        <div className="space-y-1 text-sm">
          <div className="font-semibold text-yellow-900 dark:text-yellow-200">
            Escalation claimed by {claimedByName}
          </div>
          <p className="text-muted-foreground">
            Claimed <ClientTime iso={escalation.claimedAt} />. Awaiting the
            Manager's proposed action plan — this panel will update
            automatically when they send it.
          </p>
        </div>
      </Card>
    );
  }

  // claimed AND manager_decision present → Opener review.
  if (escalation.status !== "claimed") return null;

  const decision = session.managerDecision;
  const isGo = decision === "go";
  const busy = acceptMutation.isPending || rejectMutation.isPending;
  const pinValid = /^\d{4,6}$/.test(openerPin);
  const actorStaffId = session.openedById ?? getActiveUserProfile()?.staffId ?? null;
  const canAct = !!actorStaffId;

  return (
    <Card
      className={
        isGo
          ? "space-y-5 border-2 border-emerald-600/50 p-4"
          : "space-y-5 border-2 border-rose-600/50 p-4"
      }
    >
      <div
        className={
          isGo
            ? "flex items-start gap-3 rounded-md border border-emerald-600/40 bg-emerald-600/10 p-3"
            : "flex items-start gap-3 rounded-md border border-rose-600/40 bg-rose-600/10 p-3"
        }
      >
        {isGo ? (
          <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-700" />
        ) : (
          <ShieldAlert className="mt-0.5 h-5 w-5 text-rose-700" />
        )}
        <div className="space-y-1 text-sm">
          <div
            className={
              isGo
                ? "font-semibold text-emerald-900 dark:text-emerald-200"
                : "font-semibold text-rose-900 dark:text-rose-200"
            }
          >
            Manager {claimedByName} proposes{" "}
            <span className="font-extrabold">{isGo ? "GO" : "NO-GO"}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Submitted <ClientTime iso={session.managerAuthAt ?? escalation.claimedAt} />.
            Review the plan below, then Accept (with your PIN) to apply it, or
            Reject to send the centre back to Open Pending.
          </div>
        </div>
      </div>

      <div className="rounded-md border border-border bg-muted/30 p-3">
        <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Manager's plan / reason
        </div>
        <blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-border pl-3 text-sm italic">
          {session.managerPlanText?.trim() ||
            escalation.resolutionNotes ||
            "(no notes recorded — ask Manager to resubmit)"}
        </blockquote>
      </div>

      <div className="space-y-2">
        <Label
          htmlFor="esc-opener-pin"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Opener PIN <span className="text-destructive">*</span>
        </Label>
        <Input
          id="esc-opener-pin"
          type="password"
          inputMode="numeric"
          maxLength={6}
          autoComplete="off"
          value={openerPin}
          onChange={(e) =>
            setOpenerPin(e.target.value.replace(/\D/g, "").slice(0, 6))
          }
          placeholder=""
          className={
            "h-12 max-w-[180px] text-center text-lg tracking-[0.6em] tabular-nums" +
            (attempted && !pinValid
              ? " border-2 border-rose-600 focus-visible:ring-rose-600"
              : "")
          }
        />
        {attempted && !pinValid && (
          <span className="text-[11px] font-semibold text-rose-600">
            Enter your 4–6 digit Opener PIN
          </span>
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button
          type="button"
          variant="outline"
          disabled={busy || !pinValid}
          onClick={() => {
            setAttempted(true);
            if (!pinValid) return;
            setRejectAttempted(false);
            setRejectReason("");
            setRejectOpen(true);
          }}
          className="border-rose-600 text-rose-700 hover:bg-rose-600/10"
        >
          {rejectMutation.isPending && (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          )}
          <X className="mr-1.5 h-4 w-4" />
          Reject — Keep Closed
        </Button>
        <Button
          type="button"
          disabled={busy || !pinValid}
          onClick={() => {
            setAttempted(true);
            if (!pinValid) return;
            acceptMutation.mutate();
          }}
          className={
            isGo
              ? "bg-emerald-600 hover:bg-emerald-700"
              : "bg-rose-600 hover:bg-rose-700"
          }
        >
          {acceptMutation.isPending && (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          )}
          <ShieldCheck className="mr-1.5 h-4 w-4" />
          Accept Manager's {isGo ? "GO" : "NO-GO"}
        </Button>
      </div>

      <Dialog
        open={rejectOpen}
        onOpenChange={(o) => {
          if (rejectMutation.isPending) return;
          setRejectOpen(o);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-rose-600" />
              Reject Manager's Proposal
            </DialogTitle>
            <DialogDescription>
              Tell the Manager why you're rejecting their {isGo ? "GO" : "NO-GO"} proposal.
              The RED issue stays open in the Governance Hub.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <Label
              htmlFor="reject-reason"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Reason for rejection <span className="text-rose-600">*</span>
            </Label>
            <Textarea
              id="reject-reason"
              rows={4}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Why the proposed plan is not acceptable. Minimum 10 characters."
              className={cn(
                showRejectReasonError &&
                  "border-2 border-rose-600 focus-visible:ring-rose-600",
              )}
            />
            <div className="flex items-center justify-between text-[11px]">
              <span
                className={cn(
                  "text-muted-foreground",
                  showRejectReasonError && "font-semibold text-rose-600",
                )}
              >
                {rejectReason.trim().length}/10 minimum
              </span>
              {showRejectReasonError && (
                <span className="font-semibold text-rose-600">
                  Required — add more detail
                </span>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={rejectMutation.isPending}
              onClick={() => setRejectOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={rejectMutation.isPending || !rejectReasonValid}
              onClick={() => {
                setRejectAttempted(true);
                if (!rejectReasonValid) return;
                rejectMutation.mutate(rejectReason.trim());
              }}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              {rejectMutation.isPending && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              Confirm Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
