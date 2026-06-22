import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ElapsedTimer } from "@/components/ui/elapsed-timer";

import {
  resolveStaffIdWithFallback,
  type OperationalEscalation,
} from "@/lib/data-store";
import { supabase } from "@/integrations/supabase/client";
import { prettyGateLabel } from "@/lib/operational-forms";
import { writeToLedger, tryGetGps } from "@/lib/api/ledger";
import { submitManagerHandshake } from "@/lib/api/site-day-sessions";
import { SITE_SESSION_QUERY_KEY } from "@/hooks/use-site-session";

interface Props {
  escalation: OperationalEscalation | null;
  onClose: () => void;
}

export function EscalationConsultationModal({ escalation, onClose }: Props) {
  const isSiteDay = escalation?.sourceKind === "site_day_red";

  // Look up the linked site session id for site_day_red escalations so we
  // can route the proposal through submitManagerHandshake (which writes
  // manager_plan_text + manager_decision without changing phase).
  const sessionQ = useQuery({
    queryKey: ["site-issue-session", escalation?.sourceIssueId ?? "none"],
    queryFn: async () => {
      if (!escalation?.sourceIssueId) return null;
      const { data, error } = await supabase
        .from("site_issues_register")
        .select("session_id")
        .eq("id", escalation.sourceIssueId)
        .maybeSingle();
      if (error) throw error;
      return (data as { session_id: string } | null)?.session_id ?? null;
    },
    enabled: !!escalation && isSiteDay,
    staleTime: 30_000,
  });

  if (isSiteDay) {
    return (
      <SiteDayProposalModal
        escalation={escalation}
        sessionId={sessionQ.data ?? null}
        sessionLoading={sessionQ.isLoading}
        onClose={onClose}
      />
    );
  }

  return <VehicleConsultationModal escalation={escalation} onClose={onClose} />;
}

// ──────────────────────────── Vehicle (legacy) ────────────────────────────

function VehicleConsultationModal({
  escalation,
  onClose,
}: {
  escalation: OperationalEscalation | null;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState<
    null | "resolved_approved" | "resolved_denied"
  >(null);

  useEffect(() => {
    if (!escalation) setNotes("");
  }, [escalation]);

  const resolve = async (status: "resolved_approved" | "resolved_denied") => {
    if (!escalation || submitting) return;
    if (!notes.trim()) {
      toast.error("Add a workaround note for the driver before resolving.");
      return;
    }
    setSubmitting(status);
    try {
      const staffId = await resolveStaffIdWithFallback();
      const { error } = await supabase
        .from("operational_escalations")
        .update({
          status,
          resolution_notes: notes.trim(),
          resolved_by: staffId,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", escalation.id);
      if (error) throw error;
      if (status === "resolved_approved") {
        const gps = await tryGetGps();
        void writeToLedger({
          staff_id: staffId,
          category: "VEHICLE",
          severity: "GREEN",
          action_type: "VEHICLE_RELEASED",
          gps_lat: gps?.lat ?? null,
          gps_lng: gps?.lng ?? null,
          metadata: {
            escalation_id: escalation.id,
            vehicle_info: escalation.vehicleInfo ?? null,
            driver_name: escalation.driverName ?? null,
            resolution_notes: notes.trim(),
          },
        });
      }
      toast.success(
        status === "resolved_approved"
          ? "Workaround sent — driver cleared to roll."
          : "Escalation denied — driver instructed to hold.",
      );
      onClose();
    } catch (err) {
      toast.error("Could not resolve escalation", {
        description: (err as Error).message,
      });
    } finally {
      setSubmitting(null);
    }
  };

  const open = !!escalation;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !submitting) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            Sev 1 Consultation — Workaround Decision
          </DialogTitle>
          <DialogDescription>
            Communicate a clear instruction back to the driver. Their tablet is
            paused on the handshake screen.
          </DialogDescription>
        </DialogHeader>

        {escalation && (
          <div className="space-y-4">
            <div className="grid gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
              <Row label="Driver" value={escalation.driverName} />
              <Row label="Vehicle" value={escalation.vehicleInfo} />
              <Row
                label="Failed Gate"
                value={prettyGateLabel(escalation.gateId)}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="esc-notes" className="text-xs uppercase tracking-wide text-muted-foreground">
                Workaround instructions to driver
              </Label>
              <Textarea
                id="esc-notes"
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Proceed without missing passenger — confirmed with coordinator at 0830. Log absence on return."
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                disabled={!!submitting}
                onClick={() => resolve("resolved_approved")}
                className={cn(
                  "h-14 w-full bg-emerald-600 text-base font-bold text-white hover:bg-emerald-700",
                )}
              >
                {submitting === "resolved_approved" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <ShieldCheck className="mr-1.5 h-5 w-5" /> Approve &amp; Send Workaround
                  </>
                )}
              </Button>
              <Button
                type="button"
                disabled={!!submitting}
                onClick={() => resolve("resolved_denied")}
                className="h-14 w-full bg-rose-600 text-base font-bold text-white hover:bg-rose-700"
              >
                {submitting === "resolved_denied" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>🛑 Deny — Do Not Roll</>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── Site Day (new flow) ───────────────────────────

function SiteDayProposalModal({
  escalation,
  sessionId,
  sessionLoading,
  onClose,
}: {
  escalation: OperationalEscalation | null;
  sessionId: string | null;
  sessionLoading: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState<null | "go" | "no_go">(null);
  const [attempted, setAttempted] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Only reset typed input when the modal actually closes or a different
  // escalation id is opened — NOT on every realtime rehydrate of the same row.
  const escId = escalation?.id ?? null;
  useEffect(() => {
    if (!escId) {
      setNotes("");
      setPin("");
      setAttempted(false);
      setLastError(null);
    }
  }, [escId]);


  const notesValid = notes.trim().length >= 10;
  const pinValid = /^\d{4,6}$/.test(pin);
  const sessionMissing = !sessionLoading && !sessionId;
  const showNotesError = attempted && !notesValid;
  const showPinError = attempted && !pinValid;

  const propose = async (decision: "go" | "no_go") => {
    console.debug("[propose] entry", {
      decision,
      escalationId: escalation?.id,
      sessionId,
      claimedBy: escalation?.claimedBy,
      notesLen: notes.trim().length,
      pinLen: pin.length,
      submitting,
    });
    if (!escalation || submitting) {
      console.debug("[propose] early-return: no escalation or already submitting");
      return;
    }
    setAttempted(true);
    setLastError(null);
    if (!notesValid) {
      console.debug("[propose] early-return: notes invalid");
      setLastError("Plan / reason must be at least 10 characters.");
      toast.error("Plan / reason must be at least 10 characters.");
      return;
    }
    if (!pinValid) {
      console.debug("[propose] early-return: pin invalid");
      setLastError("Enter your 4–6 digit Manager PIN.");
      toast.error("Enter your 4–6 digit Manager PIN.");
      return;
    }
    if (!sessionId) {
      console.debug("[propose] early-return: sessionId missing");
      setLastError("Cannot find the linked site session.");
      toast.error("Cannot find the linked site session.");
      return;
    }
    let resolvedClaimedBy: string | null = escalation.claimedBy ?? null;
    if (!resolvedClaimedBy) {
      console.debug("[propose] claimedBy missing on prop — refetching row");
      const { data, error } = await supabase
        .from("operational_escalations")
        .select("claimed_by")
        .eq("id", escalation.id)
        .maybeSingle();
      if (error) console.error("[propose] refetch error", error);
      resolvedClaimedBy =
        ((data?.claimed_by as string | null) ?? null) || null;
      if (!resolvedClaimedBy) {
        console.debug("[propose] early-return: claimedBy still missing after refetch");
        setLastError("Escalation must be claimed before proposing a resolution.");
        toast.error("Escalation must be claimed before proposing a resolution.");
        return;
      }
    }

    setSubmitting(decision);
    try {
      // 1. Persist plan + decision on the site session (verifies PIN inside).
      const nextSession = await submitManagerHandshake({
        sessionId,
        plan: notes.trim(),
        decision,
        managerStaffId: resolvedClaimedBy,
        pin,
      });

      // 2. Mirror the notes onto the escalation row but KEEP status = claimed
      //    so the opener panel re-renders into "review the manager's proposal".
      const { error } = await supabase
        .from("operational_escalations")
        .update({ resolution_notes: notes.trim() })
        .eq("id", escalation.id);
      if (error) throw error;

      // 3. Push the fresh session row to the opener's cache + invalidate
      //    related queries so Craig's "Awaiting Manager" panel flips to
      //    Accept/Reject without waiting for the next poll.
      queryClient.setQueryData(SITE_SESSION_QUERY_KEY, nextSession);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SITE_SESSION_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["site-escalation"] }),
        queryClient.invalidateQueries({
          queryKey: ["my-claimed-awaiting-proposal"],
        }),
      ]);

      // 4. Ledger — best-effort.
      try {
        const gps = await tryGetGps();
        await writeToLedger({
          staff_id: resolvedClaimedBy,
          category: "CENTRE",
          severity: decision === "go" ? "YELLOW" : "RED",
          action_type: "governance.escalation_manager_proposed",
          gps_lat: gps?.lat ?? null,
          gps_lng: gps?.lng ?? null,
          metadata: {
            escalation_id: escalation.id,
            session_id: sessionId,
            decision,
            plan: notes.trim(),
          },
        });
      } catch (e) {
        console.warn("[SiteDayProposalModal] ledger write failed", e);
      }

      toast.success(
        decision === "go"
          ? "Proposal sent — awaiting Opener acceptance."
          : "NO-GO proposal sent — awaiting Opener acknowledgement.",
      );
      onClose();
    } catch (err) {
      const msg = (err as Error).message;
      console.error("[propose:caught]", err);
      setLastError(msg);
      toast.error("Could not send proposal", { description: msg });
    } finally {
      setSubmitting(null);
    }
  };


  const open = !!escalation;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !submitting) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            Day Centre Escalation — Propose Resolution
          </DialogTitle>
          <DialogDescription>
            Type the agreed action plan (GO) or the reason the centre must
            remain closed (NO-GO). The Opener will review and accept or reject
            your proposal on their terminal.
          </DialogDescription>
        </DialogHeader>

        {escalation && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-amber-800 dark:text-amber-200">
              <ElapsedTimer since={escalation.createdAt} label="Open" />
              {escalation.claimedAt && (
                <ElapsedTimer
                  since={escalation.claimedAt}
                  label="Claimed"
                  className="opacity-80"
                />
              )}
            </div>
            <div className="grid gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
              <Row label="Raised by" value={escalation.driverName || "—"} />
              <Row label="Site" value={escalation.vehicleInfo || "Day Centre"} />
            </div>

            {sessionLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Locating site
                session…
              </div>
            )}

            {sessionMissing && (
              <div className="rounded-md border-2 border-rose-600 bg-rose-600/10 p-2 text-xs font-semibold text-rose-700">
                Linked site session could not be found — refresh and retry.
              </div>
            )}

            <div className="grid gap-1.5">
              <Label
                htmlFor="esc-notes"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                Negotiated Action Plan / NO-GO Reason{" "}
                <span className="text-rose-600">*</span>
              </Label>
              <Textarea
                id="esc-notes"
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="For GO: the agreed mitigations to open the centre safely. For NO-GO: why the centre must remain closed. Minimum 10 characters."
                className={cn(
                  showNotesError &&
                    "border-2 border-rose-600 focus-visible:ring-rose-600",
                )}
              />
              <div className="flex items-center justify-between text-[11px]">
                <span
                  className={cn(
                    "text-muted-foreground",
                    showNotesError && "font-semibold text-rose-600",
                  )}
                >
                  {notes.trim().length}/10 minimum
                </span>
                {showNotesError && (
                  <span className="font-semibold text-rose-600">
                    Required — add more detail
                  </span>
                )}
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label
                htmlFor="mgr-pin"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                Manager PIN <span className="text-rose-600">*</span>
              </Label>
              <Input
                id="mgr-pin"
                type="password"
                inputMode="numeric"
                maxLength={6}
                autoComplete="off"
                value={pin}
                onChange={(e) =>
                  setPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder=""
                className={cn(
                  "h-12 max-w-[180px] text-center text-lg tracking-[0.6em] tabular-nums",
                  showPinError &&
                    "border-2 border-rose-600 focus-visible:ring-rose-600",
                )}
              />
              {showPinError && (
                <span className="text-[11px] font-semibold text-rose-600">
                  Enter your 4–6 digit Manager PIN
                </span>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                disabled={!!submitting || sessionLoading}
                onClick={() => propose("go")}
                className="h-auto min-h-[3.25rem] w-full whitespace-normal break-words bg-emerald-600 px-3 py-2 text-center text-sm font-bold leading-tight text-white hover:bg-emerald-700 sm:text-base"
              >
                {submitting === "go" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <span className="flex items-center justify-center gap-1.5">
                    <ShieldCheck className="h-5 w-5 shrink-0" />
                    <span>Propose GO — Send</span>
                  </span>
                )}
              </Button>
              <Button
                type="button"
                disabled={!!submitting || sessionLoading}
                onClick={() => propose("no_go")}
                className="h-auto min-h-[3.25rem] w-full whitespace-normal break-words bg-rose-600 px-3 py-2 text-center text-sm font-bold leading-tight text-white hover:bg-rose-700 sm:text-base"
              >
                {submitting === "no_go" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <span className="flex items-center justify-center gap-1.5">
                    <span className="shrink-0">🛑</span>
                    <span>Propose NO-GO — Send</span>
                  </span>
                )}
              </Button>
            </div>

            {lastError && (
              <div className="rounded-md border border-rose-600 bg-rose-600/10 p-2 text-xs font-semibold text-rose-700">
                {lastError}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>

  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-24 shrink-0 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

