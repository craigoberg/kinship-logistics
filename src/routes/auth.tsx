/**
 * Go-live sign-in.
 *   Everyone enters a PIN first.
 *   Floor PIN (driver, support worker, volunteer, carer) opens that person's session.
 *   Manager or Assistant Manager PIN then asks for that person's email and password.
 */
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { DayLoginForm } from "@/components/auth/day-login-form";
import { PinPad } from "@/components/auth/pin-pad";
import { useAuthReady } from "@/hooks/use-auth-ready";
import {
  applySessionTokens,
  confirmManagerPassword,
  finishManagerPinUpgrade,
  finishPinUpgrade,
  rememberProfile,
  signInWithPin,
} from "@/lib/auth/pin-session";
import { homeForRole } from "@/lib/auth/pin-role";
import {
  clearActiveUserSession,
  getActiveUserRole,
} from "@/lib/data-store";
import { clearOperationalClockOnOperatorLogin } from "@/lib/operational-clock";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Yada Connect" },
      {
        name: "description",
        content: "Enter your PIN. Managers then confirm with their email and password.",
      },
    ],
  }),
  component: AuthTerminal,
});

type UpgradeState = {
  token: string;
  personName: string;
  door: "pin" | "manager";
  accessToken?: string;
  refreshToken?: string;
};

type ManagerConfirm = {
  token: string;
  personName: string;
  email: string;
};

function AuthTerminal() {
  const navigate = useNavigate();
  const { user, isReady } = useAuthReady();
  const [pin, setPin] = useState("");
  const [nextPin, setNextPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [upgradeStep, setUpgradeStep] = useState<"next" | "confirm">("next");
  const [upgrade, setUpgrade] = useState<UpgradeState | null>(null);
  const [managerConfirm, setManagerConfirm] = useState<ManagerConfirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (!isReady) return;
    if (!user) {
      if (getActiveUserRole()) clearActiveUserSession();
      return;
    }
    const role = getActiveUserRole();
    if (role) {
      void navigate({ to: homeForRole(role), replace: true });
    }
  }, [navigate, isReady, user]);

  const fail = (e: unknown) => {
    setError(e instanceof Error ? e.message : "Sign-in failed. Check your connection and retry.");
    setPin("");
    setShake(true);
    setTimeout(() => setShake(false), 400);
  };

  const enterApp = (profile: { fullName: string; role: "driver" | "coordinator" | "carer" }) => {
    clearOperationalClockOnOperatorLogin();
    toast.success(`Welcome, ${profile.fullName}`);
    void navigate({ to: homeForRole(profile.role), replace: true });
  };

  const submitPin = async (value: string) => {
    if (busy) return;
    if (value.length !== 4 && value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const result = await signInWithPin(value);
      if (result.status === "manager-password") {
        setManagerConfirm({
          token: result.confirmToken,
          personName: result.personName,
          email: result.email,
        });
        setPin("");
        return;
      }
      if (result.status === "upgrade") {
        setUpgrade({ token: result.upgradeToken, personName: result.personName, door: "pin" });
        setUpgradeStep("next");
        setNextPin("");
        setConfirmPin("");
        return;
      }
      await applySessionTokens(result.accessToken, result.refreshToken);
      const profile = rememberProfile(result.profile);
      enterApp(profile);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const submitManagerPassword = async (email: string, password: string) => {
    if (!managerConfirm) return;
    const result = await confirmManagerPassword(managerConfirm.token, email, password);
    setManagerConfirm(null);
    if (result.status === "upgrade") {
      setUpgrade({
        token: result.upgradeToken,
        personName: result.personName,
        door: "manager",
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
      setUpgradeStep("next");
      setNextPin("");
      setConfirmPin("");
      return;
    }
    await applySessionTokens(result.accessToken, result.refreshToken);
    const profile = rememberProfile(result.profile);
    enterApp(profile);
  };

  const submitUpgrade = async (value: string) => {
    if (!upgrade || busy) return;
    if (upgradeStep === "next") {
      setNextPin(value);
      setConfirmPin("");
      setUpgradeStep("confirm");
      setError(null);
      return;
    }
    if (value !== nextPin) {
      setError("The new PINs do not match.");
      setConfirmPin("");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const profile =
        upgrade.door === "manager"
          ? await finishManagerPinUpgrade({
              accessToken: upgrade.accessToken ?? "",
              refreshToken: upgrade.refreshToken ?? "",
              upgradeToken: upgrade.token,
              newPin: nextPin,
              confirmPin: value,
            })
          : await finishPinUpgrade(upgrade.token, nextPin, value);
      setUpgrade(null);
      enterApp(profile);
    } catch (e) {
      fail(e);
      setUpgradeStep("next");
      setNextPin("");
    } finally {
      setBusy(false);
    }
  };

  if (!isReady) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking sign-in…
      </div>
    );
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4 pb-[env(safe-area-inset-bottom)]">
      <div className={`w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-lg sm:p-8 ${shake ? "animate-[shake_0.4s_ease-in-out]" : ""}`}>
        {upgrade ? (
          <UpgradeCard
            name={upgrade.personName}
            step={upgradeStep}
            value={upgradeStep === "next" ? nextPin : confirmPin}
            onChange={upgradeStep === "next" ? setNextPin : setConfirmPin}
            busy={busy}
            error={error}
            onSubmit={(v) => void submitUpgrade(v)}
          />
        ) : managerConfirm ? (
          <DayLoginForm
            personName={managerConfirm.personName}
            defaultEmail={managerConfirm.email}
            onConfirm={submitManagerPassword}
            onBack={() => {
              setManagerConfirm(null);
              setPin("");
              setError(null);
            }}
          />
        ) : (
          <PinDoor
            pin={pin}
            busy={busy}
            error={error}
            onChange={(v) => {
              setPin(v);
              setError(null);
            }}
            onSubmit={(v) => void submitPin(v)}
          />
        )}
      </div>
    </div>
  );
}

function PinDoor({
  pin,
  busy,
  error,
  onChange,
  onSubmit,
}: {
  pin: string;
  busy: boolean;
  error: string | null;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
}) {
  const ready = pin.length === 4 || pin.length === 6;
  return (
    <>
      <Header
        title="Sign in"
        body="Enter your PIN. If it belongs to a manager, email and password come next."
      />
      <PinPad
        value={pin}
        onChange={onChange}
        length={6}
        submitLengths={[4, 6]}
        confirmLabel="Sign in"
        onComplete={onSubmit}
        disabled={busy}
      />
      {!ready && !busy && (
        <p className="mt-3 text-center text-[11px] text-destructive">
          Enter your 4-digit PIN once, or your 6-digit PIN.
        </p>
      )}
      {busy && <Busy label="Checking PIN…" />}
      {error && <Err text={error} />}
    </>
  );
}

function UpgradeCard({
  name,
  step,
  value,
  onChange,
  busy,
  error,
  onSubmit,
}: {
  name: string;
  step: "next" | "confirm";
  value: string;
  onChange: (v: string) => void;
  busy: boolean;
  error: string | null;
  onSubmit: (v: string) => void;
}) {
  return (
    <>
      <Header
        title={step === "next" ? "Choose a 6-digit PIN" : "Enter it again"}
        body={
          step === "next"
            ? `${name}, PINs are now 6 digits. Your current PIN was accepted. Choose a new one.`
            : "Enter the new PIN again to finish signing in."
        }
      />
      <PinPad
        value={value}
        onChange={onChange}
        length={6}
        confirmLabel={step === "confirm" ? "Save and sign in" : "Continue"}
        showConfirmKey
        onComplete={onSubmit}
        disabled={busy}
      />
      {value.length > 0 && value.length < 6 && (
        <p className="mt-3 text-center text-[11px] text-destructive">PIN must be 6 digits.</p>
      )}
      {busy && <Busy label="Saving PIN…" />}
      {error && <Err text={error} />}
    </>
  );
}

function Header({ title, body }: { title: string; body: string }) {
  return (
    <div className="mb-6 flex flex-col items-center gap-3 text-center">
      <div className="rounded-full bg-primary/10 p-3 text-primary">
        <ShieldCheck className="h-7 w-7" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function Busy({ label }: { label: string }) {
  return (
    <div className="mt-3 flex items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

function Err({ text }: { text: string }) {
  return <p className="mt-3 text-center text-sm font-medium text-destructive">{text}</p>;
}
