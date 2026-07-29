/**
 * Two-step terminal auth (BL-099 thin day login + existing PIN):
 *   1) Supabase Auth email + password (day session)
 *   2) Operator PIN (floor identity / role)
 */
import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { DayLoginForm } from "@/components/auth/day-login-form";
import { PinPad } from "@/components/auth/pin-pad";
import { verifyLoginPin } from "@/components/auth/pin-verify";
import { useAuthReady } from "@/hooks/use-auth-ready";
import { signOutDaySession } from "@/lib/api/day-auth";
import {
  clearActiveUserSession,
  getActiveUserRole,
  type UserRole,
} from "@/lib/data-store";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Yada Connect" },
      {
        name: "description",
        content: "Day login then PIN terminal for drivers and office coordinators.",
      },
    ],
  }),
  component: AuthTerminal,
});

function destinationForRole(role: UserRole): "/" | "/manifest" {
  return role === "driver" ? "/manifest" : "/";
}

function AuthTerminal() {
  const navigate = useNavigate();
  const { user, isReady } = useAuthReady();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [endingDay, setEndingDay] = useState(false);
  const submittedRef = useRef(false);

  // Day session missing → drop stale PIN profile so step 2 always runs after login.
  // Day session + PIN profile → leave /auth.
  useEffect(() => {
    if (!isReady) return;
    if (!user) {
      if (getActiveUserRole()) clearActiveUserSession();
      return;
    }
    const role = getActiveUserRole();
    if (role) navigate({ to: destinationForRole(role), replace: true });
  }, [navigate, isReady, user]);

  const submitPin = async (value: string) => {
    if (busy || submittedRef.current) return;
    submittedRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const profile = await verifyLoginPin(value);
      toast.success(`Welcome, ${profile.fullName}`, {
        description:
          profile.role === "driver"
            ? "Driver terminal active."
            : "Coordinator console active.",
      });
      navigate({ to: destinationForRole(profile.role), replace: true });
    } catch (e) {
      submittedRef.current = false;
      setError(
        e instanceof Error
          ? e.message
          : "Sign-in failed. Check your connection and retry.",
      );
      setPin("");
      setShake(true);
      setTimeout(() => setShake(false), 400);
    } finally {
      setBusy(false);
    }
  };

  const endDaySession = async () => {
    setEndingDay(true);
    try {
      await signOutDaySession();
      toast.message("Day session ended", {
        description: "Sign in with email and password to continue.",
      });
    } catch (e) {
      toast.error("Could not end day session", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setEndingDay(false);
    }
  };

  if (!isReady) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking day session…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center px-4 pb-[env(safe-area-inset-bottom)]">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-lg sm:p-8">
          <DayLoginForm onSignedIn={() => { /* useAuthReady picks up session */ }} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4 pb-[env(safe-area-inset-bottom)]">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-lg sm:p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="rounded-full bg-primary/10 p-3 text-primary">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Operator PIN</h1>
          <p className="text-sm text-muted-foreground">
            Day session:{" "}
            <span className="font-medium text-foreground">
              {user.email ?? "signed in"}
            </span>
            . Enter your 4-digit operator PIN.
          </p>
        </div>

        <div className={`mt-6 ${shake ? "animate-[shake_0.4s_ease-in-out]" : ""}`}>
          <PinPad
            value={pin}
            onChange={(v) => {
              setPin(v);
              setError(null);
              submittedRef.current = false;
            }}
            length={4}
            onComplete={(v) => void submitPin(v)}
            disabled={busy}
          />
        </div>

        {busy && (
          <div className="mt-3 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Verifying…
          </div>
        )}
        {error && (
          <p className="mt-3 text-center text-sm font-medium text-destructive">
            {error}
          </p>
        )}

        <Button
          type="button"
          variant="ghost"
          className="mt-4 w-full text-xs text-muted-foreground"
          disabled={endingDay}
          onClick={() => void endDaySession()}
        >
          {endingDay ? "Ending…" : "End day session (switch account)"}
        </Button>

        <p className="mt-2 text-center text-xs text-muted-foreground">
          Drivers route to the live manifest. Coordinators land on the office
          dashboard.
        </p>
      </div>
    </div>
  );
}
