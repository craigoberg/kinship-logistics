import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  getActiveUserRole,
  loginWithPin,
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
  const inputRef = useRef<HTMLInputElement>(null);

  // If already signed in, bounce straight to the role's home surface.
  useEffect(() => {
    const role = getActiveUserRole();
    if (role) navigate({ to: destinationForRole(role), replace: true });
  }, [navigate]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
      toast.success(`Welcome, ${profile.fullName}`, {
        description:
          profile.role === "driver"
            ? "Driver terminal active."
            : "Coordinator console active.",
      });
      navigate({ to: destinationForRole(profile.role), replace: true });
    } catch (e) {
      console.error("[auth] loginWithPin failed", e);
      setError("Sign-in failed. Check your connection and retry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-lg">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="rounded-full bg-primary/10 p-3 text-primary">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Yada Terminal</h1>
          <p className="text-sm text-muted-foreground">
            Enter your 4-digit operator PIN to sign in.
          </p>
        </div>

        <form
          className="mt-6 flex flex-col gap-4"
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
            autoFocus
            value={pin}
            onChange={(e) => {
              const next = e.target.value.replace(/\D/g, "").slice(0, 4);
              setPin(next);
              setError(null);
              if (next.length === 4) void submit(next);
            }}
            className="h-16 text-center text-3xl tracking-[1.2em] font-mono"
            placeholder="••••"
            aria-label="4-digit PIN"
            disabled={busy}
          />
          {error && (
            <p className="text-center text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <Button
            type="submit"
            className="h-12 text-base"
            disabled={busy || pin.length !== 4}
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying…
              </>
            ) : (
              "Sign in"
            )}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Drivers route to the live manifest. Coordinators land on the office dashboard.
          </p>
        </form>
      </div>
    </div>
  );
}
