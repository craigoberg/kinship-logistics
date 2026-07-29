/**
 * BL-099 — thin day session login (email + password).
 * Distinct from PIN terminal (GUARDRAILS §2.3): this is Auth, not PinPad.
 */
import { useState } from "react";
import { Loader2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  findStaffIdForAuthEmail,
  signInDaySession,
} from "@/lib/api/day-auth";
import { requiredFieldOutline } from "@/lib/ui/required-field";

interface Props {
  onSignedIn: (info: { email: string; staffName: string | null }) => void;
}

export function DayLoginForm({ onSignedIn }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailOk = email.trim().includes("@");
  const passwordOk = password.length > 0;
  const canSubmit = emailOk && passwordOk && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const session = await signInDaySession(email, password);
      const staff = await findStaffIdForAuthEmail(session.email).catch(() => null);
      if (!staff) {
        toast.message("Day session started", {
          description:
            "No matching staff email in the registry — PIN login still works. Link auth_user_id in Supabase when ready.",
        });
      } else {
        toast.success("Day session started", {
          description: `Signed in as ${staff.fullName}. Enter operator PIN next.`,
        });
      }
      onSignedIn({
        email: session.email,
        staffName: staff?.fullName ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Day login failed.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="rounded-full bg-primary/10 p-3 text-primary">
          <KeyRound className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Yada Connect</h1>
        <p className="text-sm text-muted-foreground">
          Day login — email and password for this device. Operator PIN comes next.
        </p>
      </div>

      <div className="space-y-2 text-left">
        <Label htmlFor="day-email">Email</Label>
        <Input
          id="day-email"
          type="email"
          autoComplete="username"
          inputMode="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          className={requiredFieldOutline(!emailOk && email.length > 0)}
          placeholder="you@yada.org.au"
          disabled={busy}
        />
      </div>

      <div className="space-y-2 text-left">
        <Label htmlFor="day-password">Password</Label>
        <Input
          id="day-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
          className={requiredFieldOutline(!passwordOk && password.length > 0)}
          disabled={busy}
        />
      </div>

      {error && (
        <p className="text-center text-sm font-medium text-destructive">{error}</p>
      )}

      <Button type="submit" className="h-12 w-full text-base" disabled={!canSubmit}>
        {busy ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Signing in…
          </>
        ) : (
          "Start day session"
        )}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        Create users in Supabase → Authentication (same email as staff registry).
        Passwords are managed by Supabase — not stored in Yada.
      </p>
    </form>
  );
}
