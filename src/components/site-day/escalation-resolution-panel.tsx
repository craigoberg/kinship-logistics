import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ClientTime } from "@/components/ui/client-time";
import { usePersistedForm } from "@/hooks/use-persisted-form";
import { SITE_SESSION_QUERY_KEY } from "@/hooks/use-site-session";
import {
  submitLeaderHandshake,
  submitManagerHandshake,
  type SiteDaySession,
} from "@/lib/api/site-day-sessions";
import { writeToLedger, tryGetGps } from "@/lib/api/ledger";
import {
  getEscalationBySourceIssue,
  getStaffDisplayName,
  resolveOperationalEscalation,
  subscribeToEscalation,
  verifyStaffPin,
  type OperationalEscalation,
} from "@/lib/data-store";
import type { SiteIssue } from "@/lib/api/site-issues";

interface Props {
  session: SiteDaySession;
  redIssue: SiteIssue | null;
}

interface Draft {
  notes: string;
}

/**
 * On-screen replacement for the legacy SiteLeaderHandshakePanel +
 * SiteManagerHandshakeModal combo. Drives the `escalated_lock` phase from
 * the live `operational_escalations` row:
 *
 *   pending → "Awaiting Manager pickup…"
 *   claimed → "Escalation claimed by {name}." + dual-PIN resolution form
 *             (GO finalises & opens, NO-GO cancels the day)
 *
 * Both GO and NO-GO require the same fields: ≥10 char written
 * plan/reason + Opener PIN + Reviewing Manager PIN entered on this
 * terminal.
 */
export function EscalationResolutionPanel({ session, redIssue }: Props) {
  const queryClient = useQueryClient();

  // ── Live escalation row ────────────────────────────────────────────────
  const escQ = useQuery({
    queryKey: ["site-escalation", redIssue?.id ?? "none"],
    queryFn: () =>
      redIssue ? getEscalationBySourceIssue(redIssue.id) : Promise.resolve(null),
    enabled: !!redIssue,
    staleTime: 10_000,
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

  // ── Claiming manager name lookup (cached) ──────────────────────────────
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

  // ── Form state (persisted across realtime re-renders) ──────────────────
  const form = usePersistedForm<Draft>(
    `site-escalation-resolution:${session.id}`,
    { notes: "" },
  );
  const [openerPin, setOpenerPin] = useState("");
  const [managerPin, setManagerPin] = useState("");

  const notesTooShort = form.values.notes.trim().length < 10;
  const pinsValid = /^\d{4,}$/.test(openerPin) && /^\d{4,}$/.test(managerPin);

  const finaliseMutation = useMutation({
    mutationFn: async (approved: boolean) => {
      if (!escalation) throw new Error("No escalation to resolve.");
      if (!escalation.claimedBy)
        throw new Error("Escalation has not been claimed yet.");
      if (notesTooShort)
        throw new Error(
          approved
            ? "Action plan must be at least 10 characters."
            : "NO-GO reason must be at least 10 characters.",
        );
      if (!pinsValid) throw new Error("Both PINs must be 4 digits.");

      // Pre-flight PIN checks so we fail before mutating any state.
      const managerStaffId = escalation.claimedBy;
      const mgrOk = await verifyStaffPin(managerStaffId, managerPin);
      if (!mgrOk)
        throw new Error("Manager PIN does not match the claiming Manager.");

      // 1. Manager handshake (plan + decision).
      const decision = approved ? "go" : "no_go";
      await submitManagerHandshake({
        sessionId: session.id,
        plan: form.values.notes.trim(),
        decision,
        managerStaffId,
        pin: managerPin,
      });

      // 2. Leader handshake — opener PIN identifies the opener; we resolve
      //    the opener staff id via verify_operator_pin downstream.
      //    submitLeaderHandshake requires a leaderStaffId; the original
      //    opener_id on the session is the right party.
      const leaderStaffId = session.openedById;
      if (!leaderStaffId)
        throw new Error(
          "Session has no recorded opener — cannot complete leader sign-off.",
        );
      const ldrOk = await verifyStaffPin(leaderStaffId, openerPin);
      if (!ldrOk)
        throw new Error("Opener PIN does not match the staff who opened the day.");

      const nextSession = await submitLeaderHandshake({
        sessionId: session.id,
        decision,
        leaderStaffId,
        pin: openerPin,
      });

      // 3. Resolve escalation row.
      await resolveOperationalEscalation({
        id: escalation.id,
        approved,
        managerStaffId,
        notes: form.values.notes.trim(),
      });

      // 4. Ledger receipt.
      const gps = await tryGetGps();
      await writeToLedger({
        staff_id: managerStaffId,
        category: "CENTRE",
        severity: approved ? "GREEN" : "RED",
        action_type: approved
          ? "governance.escalation_resolved"
          : "governance.escalation_failed",
        gps_lat: gps?.lat ?? null,
        gps_lng: gps?.lng ?? null,
        metadata: {
          escalation_id: escalation.id,
          session_id: session.id,
          source_issue_id: escalation.sourceIssueId,
          manager_staff_id: managerStaffId,
          opener_staff_id: leaderStaffId,
          decision,
          notes: form.values.notes.trim(),
        },
      });

      return { approved, nextSession };
    },
    onSuccess: ({ approved, nextSession }) => {
      queryClient.setQueryData(SITE_SESSION_QUERY_KEY, nextSession);
      queryClient.invalidateQueries({ queryKey: ["site-escalation"] });
      form.reset();
      setOpenerPin("");
      setManagerPin("");
      if (approved) {
        toast.success("Resolution recorded — Centre is open.");
      } else {
        toast.error("Session declared NO-GO.", {
          description: "Centre will remain closed for the day.",
        });
      }
    },
    onError: (e: Error) => {
      toast.error("Could not finalise resolution", { description: e.message });
    },
  });

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

  // claimed → render dual-PIN resolution form on the same screen.
  const submitting = finaliseMutation.isPending;

  return (
    <Card className="space-y-5 border-2 border-red-600/50 p-4">
      <div className="flex items-start gap-3 rounded-md border border-yellow-500/60 bg-yellow-500/10 p-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 text-yellow-700" />
        <div className="space-y-1 text-sm">
          <div className="font-semibold text-yellow-900 dark:text-yellow-200">
            Escalation claimed by {claimedByName}. Awaiting offline
            consultation and dual-PIN sign-off.
          </div>
          <div className="text-xs text-muted-foreground">
            Claimed <ClientTime iso={escalation.claimedAt} />. Once you and
            the claiming Manager have agreed the response, type the plan
            below and both enter your PINs on this terminal.
          </div>
        </div>
      </div>

      {form.hasDraft && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <span>
            <span className="font-medium">Resume draft?</span> Unsaved
            plan/reason from earlier.
          </span>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="ghost" onClick={form.discardDraft}>
              Discard
            </Button>
            <Button size="sm" onClick={form.resumeDraft}>
              Resume
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label
          htmlFor="esc-notes"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Negotiated Action Plan / Solution{" "}
          <span className="text-destructive">*</span>
        </Label>
        <Textarea
          id="esc-notes"
          rows={4}
          placeholder="For GO: the agreed mitigations to open the centre safely. For NO-GO: why the centre must remain closed. Minimum 10 characters."
          value={form.values.notes}
          onChange={(e) => form.setValues({ notes: e.target.value })}
          className={cn(
            notesTooShort &&
              form.values.notes.length > 0 &&
              "border-destructive focus-visible:ring-destructive",
          )}
        />
        {notesTooShort && form.values.notes.length > 0 && (
          <p className="text-xs text-destructive">
            Minimum 10 characters required.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label
            htmlFor="esc-opener-pin"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Opener (Site Leader) PIN{" "}
            <span className="text-destructive">*</span>
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
            placeholder="••••"
            className="h-12 text-center text-lg tracking-[0.6em] tabular-nums"
          />
        </div>
        <div className="space-y-2">
          <Label
            htmlFor="esc-manager-pin"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Reviewing Manager PIN{" "}
            <span className="text-destructive">*</span>
          </Label>
          <Input
            id="esc-manager-pin"
            type="password"
            inputMode="numeric"
            maxLength={6}
            autoComplete="off"
            value={managerPin}
            onChange={(e) =>
              setManagerPin(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            placeholder="••••"
            className="h-12 text-center text-lg tracking-[0.6em] tabular-nums"
          />
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button
          type="button"
          variant="outline"
          disabled={submitting || notesTooShort || !pinsValid}
          onClick={() => finaliseMutation.mutate(false)}
          className="border-red-600 text-red-700 hover:bg-red-600/10"
        >
          {submitting && finaliseMutation.variables === false && (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          )}
          <ShieldAlert className="mr-1.5 h-4 w-4" />
          Declare NO-GO / Cancel Session
        </Button>
        <Button
          type="button"
          disabled={submitting || notesTooShort || !pinsValid}
          onClick={() => finaliseMutation.mutate(true)}
          className="bg-green-600 hover:bg-green-700"
        >
          {submitting && finaliseMutation.variables === true && (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          )}
          <ShieldCheck className="mr-1.5 h-4 w-4" />
          Finalise Resolution &amp; Open Centre
        </Button>
      </div>
    </Card>
  );
}
