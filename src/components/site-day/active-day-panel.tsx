import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ClipboardCheck, Loader2, PlusCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ClientTime } from "@/components/ui/client-time";
import { useActiveSiteIssues } from "@/hooks/use-site-issues";
import { closeSession, resetStartOfDay, type SiteDaySession } from "@/lib/api/site-day-sessions";
import { TestOnly } from "@/components/dev/test-only";
import { SITE_SESSION_QUERY_KEY } from "@/hooks/use-site-session";
import { finalizeTodaysBilling } from "@/lib/api/myob-export";
import { IssuesRegisterCard } from "./issues-register-card";
import { LogAnomalyModal } from "./log-anomaly-modal";
import { VerbalAuthOverrideDialog } from "@/components/issue-engine/verbal-auth-override-dialog";
import { createIssue, type ResponsibilityOwner } from "@/lib/api/site-issues";
import { activeSiteIssuesKey, siteIssuesKey } from "@/hooks/use-site-issues";
import { isAuthError } from "@/lib/api/auth-errors";
import { PinReauthDialog } from "@/components/auth/pin-reauth-dialog";
import { useAuthReady } from "@/hooks/use-auth-ready";
import { AttendanceRollPanel } from "./attendance-roll-panel";
import { DayCentreClosureModal } from "./day-centre-closure-modal";



interface Props {
  session: SiteDaySession;
}

export function ActiveDayPanel({ session }: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuthReady();
  const issuesQ = useActiveSiteIssues(session.id);
  const reauthRetryRef = useRef(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [anomalyOpen, setAnomalyOpen] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [authRecoveryMessage, setAuthRecoveryMessage] = useState<string | null>(null);
  // Pending RED draft awaiting verbal-consultation log.
  const [verbalPending, setVerbalPending] = useState<{
    description: string;
    owner: ResponsibilityOwner;
  } | null>(null);


  const resetMut = useMutation({
    mutationFn: () => resetStartOfDay("test: rewind to start of day"),
    onSuccess: (next) => {
      queryClient.setQueryData(SITE_SESSION_QUERY_KEY, next);
      queryClient.invalidateQueries({ queryKey: SITE_SESSION_QUERY_KEY });
      toast.success("Session reset to Start of Day", {
        description: "Issues, escalations, attendance and billing are preserved.",
      });
    },
    onError: (e: Error) => {
      toast.error("Reset failed", { description: e.message });
    },
  });

  const closeMut = useMutation({
    mutationFn: async () => {
      const finalized = await finalizeTodaysBilling().catch(() => 0);
      const next = await closeSession("");
      return { next, finalized };
    },
    onSuccess: ({ next, finalized }) => {
      reauthRetryRef.current = false;
      setAuthRecoveryMessage(null);
      queryClient.setQueryData(SITE_SESSION_QUERY_KEY, next);
      toast.success("Day closed orderly.", {
        description: `${finalized} attendance row${finalized === 1 ? "" : "s"} flipped to billing-ready.`,
      });
      setCloseOpen(false);
    },
    onError: (e: Error) => {
      if (isAuthError(e)) {
        setCloseOpen(false);
        if (reauthRetryRef.current) {
          reauthRetryRef.current = false;
          setReauthOpen(false);
          setAuthRecoveryMessage(
            "Your PIN was accepted, but the Day Centre close request is still being rejected. Use Retry now for an immediate retry, or re-enter PIN again if a different authorised operator needs to take over.",
          );
          toast.error("Close still blocked after PIN re-entry", {
            description: "Retry now, or re-enter an authorised PIN and try again.",
          });
          return;
        }
        setAuthRecoveryMessage(null);
        setReauthOpen(true);
        toast.message("Authorisation check required — please re-enter your PIN.");
        return;
      }
      toast.error("Could not close the day", { description: e.message });
    },
  });

  const issues = issuesQ.data ?? [];
  const openIssues = issues.filter((i) => i.status !== "resolved");

  return (
    <section className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">
            Day Centre — Active
          </h2>
          {session.openDeclaredAt && (
            <p className="text-xs text-muted-foreground">
              Opened <ClientTime iso={session.openDeclaredAt} />
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAnomalyOpen(true)}
            className="gap-1.5"
          >
            <PlusCircle className="h-4 w-4" /> Log anomaly
          </Button>
          <Button
            onClick={() => setCloseOpen(true)}
            size="sm"
            className="gap-1.5 bg-primary"
          >
            <ClipboardCheck className="h-4 w-4" /> Initiate Day Centre Closure
          </Button>

          <TestOnly>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-dashed border-amber-500/60 text-amber-700 hover:bg-amber-500/10"
              onClick={() => resetMut.mutate()}
              disabled={resetMut.isPending}
              title="TEST ONLY — rewind today's session to Start of Day. Issues, attendance and billing are preserved."
            >
              {resetMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              Reset Start of Day
              <span className="ml-1 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                Test
              </span>
            </Button>
          </TestOnly>
        </div>
      </div>

      {authRecoveryMessage && (
        <Card className="border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-2">
              <p className="font-semibold">Authorisation still required</p>
              <p>{authRecoveryMessage}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setAuthRecoveryMessage(null);
                    closeMut.mutate();
                  }}
                  disabled={closeMut.isPending}
                >
                  Retry now
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setAuthRecoveryMessage(null);
                    setReauthOpen(true);
                  }}
                  disabled={closeMut.isPending}
                >
                  Re-enter PIN
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Issues Register {openIssues.length > 0 && `(${openIssues.length} open)`}
          </h3>
          {issuesQ.isFetching && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
        </div>

        {issuesQ.isError && (
          <Card className="border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              <div>
                <div className="font-medium">
                  Could not load issues register.
                </div>
                <div className="text-xs">
                  {(issuesQ.error as Error).message}
                </div>
              </div>
            </div>
          </Card>
        )}

        {!issuesQ.isError && issues.length === 0 && (
          <Card className="border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
            No active issues. Use <span className="font-semibold">Log anomaly</span>{" "}
            above when something needs flagging. This list also surfaces any
            unresolved issues carried over from prior days.
          </Card>
        )}

        <div className="space-y-2">
          {issues.map((i) => (
            <IssuesRegisterCard key={i.id} issue={i} />
          ))}
        </div>
      </div>

      <AlertDialog open={closeOpen} onOpenChange={setCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close the Day Centre?</AlertDialogTitle>
            <AlertDialogDescription>
              Today's finalised attendance rows will flip to{" "}
              <code>audited_ready_for_billing</code> and become available to the
              MYOB Export workspace. This action is logged in the operational
              ledger.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closeMut.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                closeMut.mutate();
              }}
              disabled={closeMut.isPending}
            >
              {closeMut.isPending ? "Closing…" : "Confirm Close"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {user && (
        <LogAnomalyModal
          open={anomalyOpen}
          onOpenChange={setAnomalyOpen}
          context={{
            kind: "site-day",
            sessionId: session.id,
            onRedRequested: (description, owner) => {
              setVerbalPending({ description, owner });
            },
          }}
        />
      )}

      <VerbalAuthOverrideDialog
        open={!!verbalPending}
        onOpenChange={(o) => {
          if (!o) setVerbalPending(null);
        }}
        ledgerCategory="CENTRE"
        subjectLabel={`Day Centre · Session ${session.id.slice(0, 8)}`}
        sourceId={session.id}
        actionType="RED_VERBAL_WORKAROUND"
        titleOverride="RED Verbal Consultation & Log"
        descriptionOverride="A RED Day Centre anomaly was identified. Document the manager you spoke with offline, the agreed safety workaround, and sign with your operator PIN. The ticket lands in the Governance Hub immediately as 'Open — Operating via Verbal Workaround' and the session keeps running."
        onAccepted={async ({ managerName, reason }) => {
          if (!verbalPending) return;
          const prefixed = `[VERBAL WORKAROUND] ${verbalPending.description} — Authorising Manager: ${managerName}. Plan: ${reason}`;
          try {
            await createIssue({
              sessionId: session.id,
              severity: "red",
              issueDescription: prefixed,
              workaroundPlan: reason,
              owner: verbalPending.owner,
            });
            queryClient.invalidateQueries({ queryKey: siteIssuesKey(session.id) });
            queryClient.invalidateQueries({ queryKey: activeSiteIssuesKey(session.id) });
            queryClient.invalidateQueries({ queryKey: ["governance-unified-issues"] });
          } catch (err) {
            console.error("[ActiveDayPanel] verbal-workaround issue insert failed", err);
            toast.error("Verbal workaround logged to ledger, but Hub sync failed", {
              description: (err as Error).message,
            });
          }
          setVerbalPending(null);
        }}
      />

      <PinReauthDialog
        open={reauthOpen}
        onOpenChange={setReauthOpen}
        reason="Re-authenticate to close the Day Centre."
        onAuthenticated={() => {
          reauthRetryRef.current = true;
          setAuthRecoveryMessage(null);
          setReauthOpen(false);
          closeMut.mutate();
        }}
      />
    </section>
  );
}
