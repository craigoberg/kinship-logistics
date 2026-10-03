/**
 * Manager password confirm, after that person's PIN has already matched.
 * Email + password Inputs. Not a PIN pad (GUARDRAILS §2.3).
 */
import { useState } from "react";
import { Loader2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requiredFieldOutline } from "@/lib/ui/required-field";

interface Props {
  personName: string;
  defaultEmail: string;
  onConfirm: (email: string, password: string) => Promise<void>;
  onBack: () => void;
}

export function DayLoginForm({ personName, defaultEmail, onConfirm, onBack }: Props) {
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailOk = email.trim().includes("@");
  const passwordOk = password.length > 0;
  const canSubmit = emailOk && passwordOk && !busy;
  const missing = [
    !emailOk ? "email" : null,
    !passwordOk ? "password" : null,
  ].filter((item): item is string => !!item);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
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
        <h1 className="text-2xl font-semibold tracking-tight">Confirm it's you</h1>
        <p className="text-sm text-muted-foreground">
          {personName}, this PIN belongs to a manager. Enter the email and password for this person.
          This does not sign you in as someone else.
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
          className={requiredFieldOutline(!emailOk)}
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
          className={requiredFieldOutline(!passwordOk)}
          disabled={busy}
        />
      </div>

      {missing.length > 0 && !busy && (
        <p className="text-center text-sm font-medium text-destructive">
          Enter {missing.join(" and ")}.
        </p>
      )}

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
          "Sign in"
        )}
      </Button>

      <Button type="button" variant="ghost" className="w-full text-xs" disabled={busy} onClick={onBack}>
        Back to PIN
      </Button>
    </form>
  );
}
