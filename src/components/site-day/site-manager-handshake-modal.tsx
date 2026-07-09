import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import { verifyManagerPin } from "@/components/auth/pin-verify";
import { Textarea } from "@/components/ui/textarea";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { ClientTime } from "@/components/ui/client-time";
import { usePersistedForm } from "@/hooks/use-persisted-form";
import {
  submitManagerHandshake,
  type HandshakeDecision,
  type SiteDaySession,
} from "@/lib/api/site-day-sessions";
import type { SiteIssue } from "@/lib/api/site-issues";
import { useMandatedChecks } from "@/hooks/use-system-parameters";
import {
  DEFAULT_STAFF_UUID,
  getStaffId,
} from "@/lib/data-store";
import { SITE_SESSION_QUERY_KEY } from "@/hooks/use-site-session";

export interface SiteEscalationContext {
  kind: "site_session";
  sessionId: string;
  issue: SiteIssue | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: SiteEscalationContext;
  session: SiteDaySession;
}

interface ManagerDraft {
  plan: string;
}

export function SiteManagerHandshakeModal({
  open,
  onOpenChange,
  context,
  session,
}: Props) {
  const queryClient = useQueryClient();
  const checks = useMandatedChecks();

  const form = usePersistedForm<ManagerDraft>(
    `site-handshake-manager:${context.sessionId}`,
    { plan: "" },
  );
  const [decision, setDecision] = useState<HandshakeDecision | "">("");
  const [managerPinVerified, setManagerPinVerified] = useState(false);
  const verifiedManagerPinRef = useRef("");

  // Reset PIN whenever the dialog opens. Plan is persisted across mounts.
  useEffect(() => {
    if (open) {
      setManagerPinVerified(false);
      verifiedManagerPinRef.current = "";
    }
  }, [open]);

  // If the session already has a manager decision, treat the modal as
  // post-submit (read-only) so realtime updates don't clobber the form.
  const managerCleared = !!session.managerAuthAt;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!decision) throw new Error("Choose GO or NO-GO.");
      if (!managerPinVerified) throw new Error("Manager PIN required.");
      const managerStaffId = getStaffId() || DEFAULT_STAFF_UUID;
      return submitManagerHandshake({
        sessionId: context.sessionId,
        plan: form.values.plan.trim(),
        decision,
        managerStaffId,
        pin: verifiedManagerPinRef.current,
      });
    },
    onSuccess: (next) => {
      queryClient.setQueryData(SITE_SESSION_QUERY_KEY, next);
      form.reset();
      toast.success("Manager handshake recorded.", {
        description:
          decision === "go"
            ? "Awaiting on-site Leader counter-signature."
            : "Day will close as NO-GO once the Leader confirms.",
      });
    },
    onError: (e: Error) => {
      const msg = e.message ?? "";
      if (/pin/i.test(msg)) {
        setManagerPinVerified(false);
        verifiedManagerPinRef.current = "";
      }
      toast.error("Could not submit handshake", { description: msg });
    },
  });

  const planTooShort = form.values.plan.trim().length < 10;
  const canSubmit =
    !managerCleared &&
    !!decision &&
    !planTooShort &&
    managerPinVerified &&
    !mutation.isPending;

  const managerStaffId = getStaffId() || DEFAULT_STAFF_UUID;

  const headerTone = useMemo(() => {
    if (managerCleared && session.managerDecision === "no_go")
      return "border-red-600/60 text-red-700";
    if (managerCleared) return "border-green-600/60 text-green-700";
    return "border-red-600/50 text-red-700";
  }, [managerCleared, session.managerDecision]);

  return (
    <Dialog open={open} onOpenChange={(o) => (mutation.isPending ? null : onOpenChange(o))}>
      <DialogContent className={cn("max-w-lg border-2", headerTone)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5" />
            Site Escalation — Manager Joint Review
          </DialogTitle>
          <DialogDescription>
            {session.sessionDate} · Red anomaly logged by the Check Leader.
            Confirm the action plan + sign with your Manager PIN.
          </DialogDescription>
        </DialogHeader>

        {/* Context block */}
        <div className="space-y-3 rounded-md border border-border bg-background/60 p-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Logged anomaly
            </div>
            {context.issue ? (
              <div className="mt-1 space-y-1 text-sm">
                <div className="font-medium">{context.issue.issueDescription}</div>
                {context.issue.workaroundPlan && (
                  <div className="rounded bg-muted/40 p-2 text-xs text-muted-foreground">
                    <span className="font-semibold">Leader workaround:</span>{" "}
                    {context.issue.workaroundPlan}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-1 text-xs text-muted-foreground">
                Issue details unavailable — refresh the page if this persists.
              </div>
            )}
          </div>

          {checks.length > 0 && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Mandated checks ({checks.length})
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {checks.slice(0, 4).map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
                {checks.length > 4 && <li>+{checks.length - 4} more…</li>}
              </ul>
            </div>
          )}
        </div>

        {managerCleared ? (
          <div
            className={cn(
              "flex items-start gap-2 rounded-md border p-3 text-sm",
              session.managerDecision === "no_go"
                ? "border-red-600/40 bg-red-600/5"
                : "border-green-600/40 bg-green-600/5",
            )}
          >
            {session.managerDecision === "no_go" ? (
              <ShieldAlert className="mt-0.5 h-4 w-4 text-red-600" />
            ) : (
              <ShieldCheck className="mt-0.5 h-4 w-4 text-green-600" />
            )}
            <div className="space-y-1">
              <div className="font-medium">
                Manager decision:{" "}
                <span className="uppercase">{session.managerDecision}</span> ·{" "}
                <ClientTime iso={session.managerAuthAt} />
              </div>
              {session.managerPlanText && (
                <div className="whitespace-pre-wrap rounded bg-muted/40 p-2 text-xs text-muted-foreground">
                  {session.managerPlanText}
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                Awaiting Check Leader counter-signature on-site.
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {form.hasDraft && (
              <div className="flex items-start justify-between gap-3 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">Resume draft?</span> Unsaved
                  action plan from a previous session.
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
                htmlFor="mgr-plan"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Action Plan / Workaround{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="mgr-plan"
                rows={4}
                placeholder="Negotiated over the phone with the on-site Leader. Min 10 chars."
                value={form.values.plan}
                onChange={(e) => form.setValues({ plan: e.target.value })}
                className={cn(
                  planTooShort &&
                    form.values.plan.length > 0 &&
                    "border-destructive focus-visible:ring-destructive",
                )}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Decision
              </Label>
              <RadioGroup
                value={decision}
                onValueChange={(v) => setDecision(v as HandshakeDecision)}
                className="flex gap-3"
              >
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium",
                    decision === "go"
                      ? "border-green-600 bg-green-600/10 text-green-700"
                      : "border-border",
                  )}
                >
                  <RadioGroupItem value="go" id="mgr-go" />
                  GO — Open Centre
                </label>
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium",
                    decision === "no_go"
                      ? "border-red-600 bg-red-600/10 text-red-700"
                      : "border-border",
                  )}
                >
                  <RadioGroupItem value="no_go" id="mgr-nogo" />
                  NO-GO — Close Day
                </label>
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Manager PIN
              </Label>
              <PinEntryTrigger
                label="Tap to enter manager PIN"
                verified={managerPinVerified}
                verifiedLabel="Manager PIN verified"
                length={6}
                title="Sign manager handshake"
                description="Confirms the negotiated action plan and GO/NO-GO decision."
                onVerify={async (pin) => {
                  await verifyManagerPin(managerStaffId, pin);
                }}
                onSuccess={(pin) => {
                  verifiedManagerPinRef.current = pin;
                  setManagerPinVerified(true);
                }}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Close
          </Button>
          {!managerCleared && (
            <Button
              onClick={() => mutation.mutate()}
              disabled={!canSubmit}
              className={cn(
                decision === "no_go"
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-green-600 hover:bg-green-700",
              )}
            >
              {mutation.isPending && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              Submit Manager Handshake
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
