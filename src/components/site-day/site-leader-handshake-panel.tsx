import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldAlert, ShieldCheck, Clock } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import { verifyOperatorPin } from "@/components/auth/pin-verify";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { ClientTime } from "@/components/ui/client-time";
import {
  submitLeaderHandshake,
  type HandshakeDecision,
  type SiteDaySession,
} from "@/lib/api/site-day-sessions";
import {
  DEFAULT_STAFF_UUID,
  getStaffId,
} from "@/lib/data-store";
import { SITE_SESSION_QUERY_KEY } from "@/hooks/use-site-session";

interface Props {
  session: SiteDaySession;
}

/**
 * On-site Leader counter-signature panel. Renders once the Manager has
 * submitted their handshake (manager_auth_at present). The Leader sees the
 * Manager's action plan + GO/NO-GO decision, then signs with their PIN.
 *
 * Final outcome logic lives in `submitLeaderHandshake`:
 *   - both GO  → phase=active_day
 *   - either NO-GO → phase=closed_no_go
 */
export function SiteLeaderHandshakePanel({ session }: Props) {
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<HandshakeDecision | "">("");
  const [leaderPinVerified, setLeaderPinVerified] = useState(false);
  const verifiedLeaderPinRef = useRef("");

  const waitingForManager = !session.managerAuthAt;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!decision) throw new Error("Choose GO or NO-GO.");
      if (!leaderPinVerified) throw new Error("Leader PIN required.");
      const leaderStaffId = getStaffId() || DEFAULT_STAFF_UUID;
      return submitLeaderHandshake({
        sessionId: session.id,
        decision,
        leaderStaffId,
        pin: verifiedLeaderPinRef.current,
      });
    },
    onSuccess: (next) => {
      queryClient.setQueryData(SITE_SESSION_QUERY_KEY, next);
      if (next.phase === "active_day") {
        toast.success("Dual-PIN handshake complete — Centre is open.");
      } else {
        toast.error("Day closed NO-GO.", {
          description:
            "Centre will remain locked for clients. Notify any expected attendees.",
        });
      }
    },
    onError: (e: Error) => {
      const msg = e.message ?? "";
      if (/pin/i.test(msg)) {
        setLeaderPinVerified(false);
        verifiedLeaderPinRef.current = "";
      }
      toast.error("Could not submit leader signature", {
        description: msg,
      });
    },
  });

  const canSubmit =
    !waitingForManager &&
    !!decision &&
    leaderPinVerified &&
    !mutation.isPending;

  if (waitingForManager) {
    return (
      <Card className="flex items-start gap-3 border-yellow-500/60 bg-yellow-500/5 p-4">
        <Clock className="mt-0.5 h-5 w-5 text-yellow-600" />
        <div className="space-y-1">
          <div className="font-semibold">Awaiting Manager handshake</div>
          <p className="text-sm text-muted-foreground">
            A Red anomaly has been logged. The on-call Manager has been
            notified to enter the negotiated action plan and Manager PIN. This
            panel will update automatically when their signature comes through.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="space-y-4 border-2 border-red-600/50 p-4">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-5 w-5 text-red-600" />
        <div className="space-y-1">
          <div className="font-semibold">
            Leader Counter-Signature Required
          </div>
          <p className="text-sm text-muted-foreground">
            The Manager has submitted their handshake — review the action plan
            below and provide your on-site final signature.
          </p>
        </div>
      </div>

      <div
        className={cn(
          "space-y-2 rounded-md border p-3",
          session.managerDecision === "no_go"
            ? "border-red-600/40 bg-red-600/5"
            : "border-green-600/40 bg-green-600/5",
        )}
      >
        <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Manager decision · <ClientTime iso={session.managerAuthAt} />
        </div>
        <div className="text-sm font-semibold uppercase">
          {session.managerDecision}
        </div>
        {session.managerPlanText && (
          <div className="whitespace-pre-wrap rounded bg-background/50 p-2 text-sm">
            {session.managerPlanText}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Your decision
        </Label>
        <RadioGroup
          value={decision}
          onValueChange={(v) => setDecision(v as HandshakeDecision)}
          className="flex flex-wrap gap-3"
        >
          <label
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium",
              decision === "go"
                ? "border-green-600 bg-green-600/10 text-green-700"
                : "border-border",
            )}
          >
            <RadioGroupItem value="go" id="ldr-go" />
            <ShieldCheck className="h-4 w-4" />
            Accept Plan & Open (GO)
          </label>
          <label
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium",
              decision === "no_go"
                ? "border-red-600 bg-red-600/10 text-red-700"
                : "border-border",
            )}
          >
            <RadioGroupItem value="no_go" id="ldr-nogo" />
            <ShieldAlert className="h-4 w-4" />
            Reject / Unsafe (NO-GO)
          </label>
        </RadioGroup>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Leader PIN
        </Label>
        <PinEntryTrigger
          label="Tap to sign with your PIN"
          verified={leaderPinVerified}
          verifiedLabel="Leader PIN verified"
          length={6}
          title="Sign leader counter-signature"
          description="Confirms you accept or reject the manager's proposed plan."
          onVerify={verifyOperatorPin}
          onSuccess={(pin) => {
            verifiedLeaderPinRef.current = pin;
            setLeaderPinVerified(true);
          }}
        />
      </div>

      <div className="flex justify-end">
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
          Submit Leader Signature
        </Button>
      </div>
    </Card>
  );
}
