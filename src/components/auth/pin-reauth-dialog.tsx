import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { PinPad } from "@/components/auth/pin-pad";
import { verifyLoginPin } from "@/components/auth/pin-verify";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason?: string;
  onAuthenticated: () => void;
}

/** Session re-auth — on-screen PinPad (GUARDRAILS §2.3). */
export function PinReauthDialog({ open, onOpenChange, reason, onAuthenticated }: Props) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (open) {
      setPin("");
      setError(null);
      setBusy(false);
      setShake(false);
    }
  }, [open]);

  const submit = async (value: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyLoginPin(value);
      onAuthenticated();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed. Check your connection and retry.");
      setPin("");
      setShake(true);
      setTimeout(() => setShake(false), 400);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent className="max-w-sm pb-[max(1rem,env(safe-area-inset-bottom))]">
        <AlertDialogHeader>
          <div className="mx-auto mb-1 rounded-full bg-primary/10 p-2.5 text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <AlertDialogTitle className="text-center">
            Session expired — please re-enter your PIN
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            Your terminal sign-in has timed out.
            {reason ? ` ${reason}` : ""} Your mandated checks and notes are preserved.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className={cn(shake && "animate-[shake_0.4s_ease-in-out]")}>
          <PinPad
            value={pin}
            onChange={(v) => {
              setPin(v);
              setError(null);
            }}
            length={4}
            onComplete={(v) => void submit(v)}
            disabled={busy}
          />
        </div>

        {busy && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Verifying…
          </div>
        )}
        {error && (
          <p className="text-center text-sm font-medium text-destructive">{error}</p>
        )}

        <AlertDialogFooter>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
