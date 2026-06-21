import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ClipboardCheck, Loader2, PlusCircle } from "lucide-react";
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
import { canManageSystemParameters } from "@/lib/api/system-parameters";
import { useQuery } from "@tanstack/react-query";
import { getActiveUserProfile } from "@/lib/data-store";
import { useSiteIssues } from "@/hooks/use-site-issues";
import { closeSession, type SiteDaySession } from "@/lib/api/site-day-sessions";
import { SITE_SESSION_QUERY_KEY } from "@/hooks/use-site-session";
import { finalizeTodaysBilling } from "@/lib/api/myob-export";
import { IssuesRegisterCard } from "./issues-register-card";
import { LogAnomalyModal } from "./log-anomaly-modal";
import { isAuthError } from "@/lib/api/auth-errors";
import { PinReauthDialog } from "@/components/auth/pin-reauth-dialog";
import { useAuthReady } from "@/hooks/use-auth-ready";

interface Props {
  session: SiteDaySession;
}

export function ActiveDayPanel({ session }: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuthReady();
  const issuesQ = useSiteIssues(session.id);
  const reauthRetryRef = useRef(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [anomalyOpen, setAnomalyOpen] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [authRecoveryMessage, setAuthRecoveryMessage] = useState<string | null>(null);

  const profile = useMemo(() => getActiveUserProfile(), []);
  const permissionQ = useQuery({
    queryKey: ["site-day", "can-manage", profile?.staffId ?? "auth-user"],
    queryFn: () => canManageSystemParameters(profile?.staffId),
    staleTime: 60_000,
  });
  const canManage = permissionQ.data === true;

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
            <ClipboardCheck className="h-4 w-4" /> Close Day
          </Button>
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
            {issues.length > 0 && (
              <span className="ml-2 text-[10px] normal-case font-normal text-muted-foreground/70">
                Including notes
              </span>
            )}
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
            No issues or notes logged today. Use <span className="font-semibold">Log anomaly</span>{" "}
            above when something needs flagging.
          </Card>
        )}

        <div className="space-y-2">
          {issues.map((i) => (
            <IssuesRegisterCard key={i.id} issue={i} canManage={canManage} />
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

      <LogAnomalyModal
        open={anomalyOpen}
        onOpenChange={setAnomalyOpen}
        sessionId={session.id}
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
