import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { PinPad } from "@/components/auth/pin-pad";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { changeMyPin } from "@/lib/auth/pin-session";
import { trivialPinReason } from "@/lib/auth/pin-role";
import { useHideGlobalFabs } from "@/lib/ui/global-fab-visibility";

type Step = "current" | "next" | "confirm";

const STEP_COPY: Record<Step, { title: string; hint: string }> = {
  current: {
    title: "Current PIN",
    hint: "Enter the PIN you use now.",
  },
  next: {
    title: "New PIN",
    hint: "Choose a 6-digit PIN. Not 123456, 000000, or a straight run.",
  },
  confirm: {
    title: "Confirm new PIN",
    hint: "Enter the new PIN again.",
  },
};

export function ChangePinDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  useHideGlobalFabs(open);
  const [step, setStep] = useState<Step>("current");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("current");
    setCurrent("");
    setNext("");
    setPin("");
    setBusy(false);
    setError(null);
  }, [open]);

  const copy = STEP_COPY[step];
  const accepts = step === "current" ? [4, 6] : [6];
  const trivial = step === "next" && pin.length === 6 ? trivialPinReason(pin) : null;
  const mismatch = step === "confirm" && pin.length === 6 && pin !== next;
  const canContinue =
    accepts.includes(pin.length) && !trivial && !mismatch && !busy;

  const missing = !canContinue
    ? [
        !accepts.includes(pin.length) &&
          (step === "current" ? "Current PIN (4 or 6 digits)" : "6-digit PIN"),
        trivial,
        mismatch && "New PINs must match",
      ].filter(Boolean)
    : [];

  const advance = async (value: string) => {
    if (busy) return;
    setError(null);
    if (step === "current") {
      setCurrent(value);
      setPin("");
      setStep("next");
      return;
    }
    if (step === "next") {
      const reason = trivialPinReason(value);
      if (reason) {
        setError(reason);
        return;
      }
      setNext(value);
      setPin("");
      setStep("confirm");
      return;
    }
    if (value !== next) {
      setError("The new PINs do not match.");
      setPin("");
      return;
    }
    setBusy(true);
    try {
      await changeMyPin(current, next, value);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change PIN.");
      setStep("current");
      setCurrent("");
      setNext("");
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <div className="space-y-3">
      <div className="text-center">
        <h2 className="text-lg font-semibold">{copy.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{copy.hint}</p>
      </div>
      <PinPad
        value={pin}
        onChange={(v) => {
          setPin(v);
          setError(null);
        }}
        length={6}
        submitLengths={accepts}
        confirmLabel={step === "confirm" ? "Save" : "Continue"}
        onComplete={(v) => void advance(v)}
        disabled={busy}
      />
      {missing.length > 0 && (
        <p className="text-center text-[11px] text-destructive">{missing.join(", ")}</p>
      )}
      {busy && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Saving…
        </div>
      )}
      {error && (
        <p className="text-center text-sm font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={busy}
        onClick={() => onOpenChange(false)}
      >
        Cancel
      </Button>
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
        <SheetContent side="bottom" hideTicket className="z-[120] rounded-t-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <SheetHeader className="sr-only">
            <SheetTitle>Change PIN</SheetTitle>
            <SheetDescription>{copy.hint}</SheetDescription>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent hideTicket className="z-[120] max-w-sm">
        <DialogHeader className="sr-only">
          <DialogTitle>Change PIN</DialogTitle>
          <DialogDescription>{copy.hint}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
