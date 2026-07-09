import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { PinPad } from "@/components/auth/pin-pad";
import { verifyLoginPin } from "@/components/auth/pin-verify";
import {
  getActiveUserRole,
  type UserRole,
} from "@/lib/data-store";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Yada Connect" },
      { name: "description", content: "PIN terminal sign-in for drivers and office coordinators." },
    ],
  }),
  component: AuthTerminal,
});

function destinationForRole(role: UserRole): "/" | "/manifest" {
  return role === "driver" ? "/manifest" : "/";
}

function AuthTerminal() {
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const submittedRef = useRef(false);

  useEffect(() => {
    const role = getActiveUserRole();
    if (role) navigate({ to: destinationForRole(role), replace: true });
  }, [navigate]);

  const submit = async (value: string) => {
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
      setError(e instanceof Error ? e.message : "Sign-in failed. Check your connection and retry.");
      setPin("");
      setShake(true);
      setTimeout(() => setShake(false), 400);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4 pb-[env(safe-area-inset-bottom)]">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-lg sm:p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="rounded-full bg-primary/10 p-3 text-primary">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Yada Terminal</h1>
          <p className="text-sm text-muted-foreground">
            Enter your 4-digit operator PIN to sign in.
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
            onComplete={(v) => void submit(v)}
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
          <p className="mt-3 text-center text-sm font-medium text-destructive">{error}</p>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Drivers route to the live manifest. Coordinators land on the office dashboard.
        </p>
      </div>
    </div>
  );
}
