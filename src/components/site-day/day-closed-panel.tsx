import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Loader2, RotateCcw, ShieldOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import { verifyManagerPin } from "@/components/auth/pin-verify";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ClientTime } from "@/components/ui/client-time";
import { reopenSession, resetStartOfDay, type SiteDaySession } from "@/lib/api/site-day-sessions";
import { SITE_SESSION_QUERY_KEY } from "@/hooks/use-site-session";
import { getActiveUserProfile, isActiveUserManager } from "@/lib/data-store";
import { TestOnly } from "@/components/dev/test-only";
import { cn } from "@/lib/utils";

interface Props {
  session: SiteDaySession;
}

export function DayClosedPanel({ session }: Props) {
  const noGo = session.phase === "closed_no_go";
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [managerPinVerified, setManagerPinVerified] = useState(false);
  const verifiedManagerPinRef = useRef("");
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);

  const profile = getActiveUserProfile();
  const isManager = isActiveUserManager();
  const managerStaffId = profile?.staffId ?? null;

  const pinValid = managerPinVerified;
  const reasonValid = reason.trim().length >= 10;

  const reopenMut = useMutation({
    mutationFn: async () => {
      if (!isManager) throw new Error("Only a Manager can reopen the Centre.");
      if (!managerStaffId)
        throw new Error("No signed-in Manager staff record — sign in again.");
      if (!managerPinVerified) throw new Error("Manager PIN required.");
      return reopenSession({
        managerStaffId,
        pin: verifiedManagerPinRef.current,
        reason: reason.trim(),
      });
    },
    onSuccess: (next) => {
      queryClient.setQueryData(SITE_SESSION_QUERY_KEY, next);
      queryClient.invalidateQueries({ queryKey: SITE_SESSION_QUERY_KEY });
      toast.success("Centre reopened", {
        description:
          "Re-closing later will only flip newly finalised attendance rows. Existing issues, billing, and ledger entries are preserved.",
      });
      setOpen(false);
      setManagerPinVerified(false);
      verifiedManagerPinRef.current = "";
      setReason("");
      setAttempted(false);
    },
    onError: (e: Error) => {
      toast.error("Could not reopen the Centre", { description: e.message });
    },
  });

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

  return (
    <>
      <Card
        className={cn(
          "flex items-start gap-3 border-2 p-4",
          noGo
            ? "border-red-600/60 bg-red-600/5"
            : "border-green-600/40 bg-green-600/5",
        )}
      >
        {noGo ? (
          <ShieldOff className="mt-0.5 h-6 w-6 text-red-600" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-6 w-6 text-green-600" />
        )}
        <div className="flex-1 space-y-2">
          <div className="text-base font-semibold">
            {noGo ? "Centre Closed — NO-GO" : "Day Closed Orderly"}
          </div>
          <p className="text-sm text-muted-foreground">
            {noGo
              ? "Dual-PIN handshake ended in NO-GO. Centre is hard-locked for clients today. Notify any expected attendees."
              : "Today's attendance has been finalised and flipped to billing-ready. The MYOB Export workspace in Admin can now pick up these rows."}
          </p>
          {session.closeDeclaredAt && (
            <p className="text-xs text-muted-foreground">
              Closed <ClientTime iso={session.closeDeclaredAt} />
              {session.closeLeaderNotes ? ` · "${session.closeLeaderNotes}"` : ""}
            </p>
          )}

          {!noGo && (
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 border-amber-500/60 text-amber-700 hover:bg-amber-500/10"
                onClick={() => {
                  setAttempted(false);
                  setManagerPinVerified(false);
                  verifiedManagerPinRef.current = "";
                  setReason("");
                  setOpen(true);
                }}
                disabled={!isManager}
                title={
                  isManager
                    ? "Reopen the Centre (Manager only)"
                    : "Only a signed-in Manager can reopen the Centre"
                }
              >
                <RotateCcw className="h-4 w-4" /> Reopen Centre
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
              {!isManager && (
                <p className="mt-1 w-full text-[11px] text-muted-foreground">
                  Sign in as a Manager to reopen.
                </p>
              )}
            </div>
          )}
        </div>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (reopenMut.isPending) return;
          setOpen(o);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-amber-600" />
              Reopen the Day Centre
            </DialogTitle>
            <DialogDescription>
              This is a Manager-only override. Attendance, issues, billing
              rows and ledger history from earlier today are preserved — only
              this reopen event will be logged.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Manager PIN <span className="text-rose-600">*</span>
              </Label>
              <PinEntryTrigger
                label="Tap to enter manager PIN"
                verified={managerPinVerified}
                verifiedLabel="Manager PIN verified"
                length={6}
                title="Reopen Day Centre"
                description="Manager-only override to reopen today's session."
                disabled={!managerStaffId}
                required
                onVerify={async (pin) => {
                  if (!managerStaffId) throw new Error("Sign in as a Manager first.");
                  await verifyManagerPin(managerStaffId, pin);
                }}
                onSuccess={(pin) => {
                  verifiedManagerPinRef.current = pin;
                  setManagerPinVerified(true);
                }}
              />
              {attempted && !pinValid && (
                <span className="text-[11px] font-semibold text-rose-600">
                  Enter your Manager PIN to continue
                </span>
              )}
            </div>

            <CharacterCountedTextarea
              id="reopen-reason"
              label="Reason for reopen"
              value={reason}
              onValueChange={setReason}
              minChars={10}
              maxChars={500}
              counterMode="minimum"
              rows={4}
              placeholder="Why the Centre needs to be reopened. Minimum 10 characters."
              required
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={reopenMut.isPending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={reopenMut.isPending}
              onClick={() => {
                setAttempted(true);
                if (!pinValid || !reasonValid) return;
                reopenMut.mutate();
              }}
              className="bg-amber-600 text-white hover:bg-amber-700"
            >
              {reopenMut.isPending && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              Confirm Reopen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
