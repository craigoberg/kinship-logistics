import { useEffect, useRef, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { GuardianPinError, loginWithPin } from "@/lib/data-store";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Short context line, e.g. "Re-authenticate to open the Day Centre." */
  reason?: string;
  /** Fired after loginWithPin succeeds. Parent should trigger its retry. */
  onAuthenticated: () => void;
}

/**
 * Modal PIN re-entry dialog used when a privileged API call returns 401 /
 * RLS-denied. Mirrors the auth route's 4-digit numeric pad and auto-submits
 * once the fourth digit lands. State is fully local — the parent only owns
 * `open` and the success callback.
 */
export function PinReauthDialog({
  open,
  onOpenChange,
  reason,
  onAuthenticated,
}: Props) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state every time the dialog re-opens so a previous error/PIN doesn't
  // linger between unrelated 401s.
  useEffect(() => {
    if (open) {
      setPin("");
      setError(null);
      setBusy(false);
      // Focus after the dialog mount animation settles.
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open]);

  const submit = async (value: string) => {
    if (busy) return;
    if (!/^\d{4}$/.test(value)) {
      setError("Enter your 4-digit PIN.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const profile = await loginWithPin(value);
      if (!profile) {
        setError("PIN not recognised. Try again.");
        setPin("");
        inputRef.current?.focus();
        return;
      }
      onAuthenticated();
    } catch (e) {
      if (e instanceof GuardianPinError) {
        setError(e.message);
      } else {
        console.error("[PinReauthDialog] loginWithPin failed", e);
        setError("Sign-in failed. Check your connection and retry.");
      }
      setPin("");
      inputRef.current?.focus();
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
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <div className="mx-auto mb-1 rounded-full bg-primary/10 p-2.5 text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <AlertDialogTitle className="text-center">
            Session expired — please re-enter your PIN
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            Your terminal sign-in has timed out.
            {reason ? ` ${reason}` : ""} Your mandated checks and notes are
            preserved.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(pin);
          }}
        >
          <Input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            value={pin}
            onChange={(e) => {
              const next = e.target.value.replace(/\D/g, "").slice(0, 4);
              setPin(next);
              setError(null);
              if (next.length === 4) void submit(next);
            }}
            className="h-14 text-center text-2xl tracking-[1em] font-mono"
            placeholder="••••"
            aria-label="4-digit PIN"
            disabled={busy}
          />
          {error && (
            <p className="text-center text-sm font-medium text-destructive">
              {error}
            </p>
          )}
        </form>

        <AlertDialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={() => void submit(pin)}
            disabled={busy || pin.length !== 4}
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying…
              </>
            ) : (
              "Re-enter PIN"
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
