import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

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
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { PinPad, type PinLength } from "@/components/auth/pin-pad";

export interface PinEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  length?: PinLength;
  /** Verify PIN; throw Error with user-facing message on failure. */
  onVerify: (pin: string) => Promise<void>;
  /** Called after successful verification (before close). */
  onSuccess?: (pin: string) => void;
  busy?: boolean;
}

function PinEntryBody({
  title,
  description,
  length,
  pin,
  setPin,
  error,
  busy,
  onComplete,
  shake,
}: {
  title: string;
  description?: string;
  length: PinLength;
  pin: string;
  setPin: (v: string) => void;
  error: string | null;
  busy: boolean;
  onComplete: (p: string) => void;
  shake: boolean;
}) {
  return (
    <>
      <div className="mx-auto mb-2 flex justify-center">
        <div className="rounded-full bg-primary/10 p-2.5 text-primary">
          <ShieldCheck className="h-6 w-6" />
        </div>
      </div>
      <div className="text-center">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className={cn("mt-4", shake && "animate-[shake_0.4s_ease-in-out]")}>
        <PinPad
          value={pin}
          onChange={(v) => setPin(v)}
          length={length}
          onComplete={onComplete}
          disabled={busy}
          keyboardActive
        />
      </div>
      {busy && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Verifying…
        </div>
      )}
      {error && (
        <p className="text-center text-sm font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/**
 * Canonical PIN entry overlay — bottom sheet on phone, centred dialog on tablet/desktop.
 * GUARDRAILS §2.3: all new PIN capture must use this component (or PinPad inline on
 * dedicated login screens).
 */
export function PinEntryDialog({
  open,
  onOpenChange,
  title,
  description,
  length = 4,
  onVerify,
  onSuccess,
  busy: externalBusy,
}: PinEntryDialogProps) {
  const isMobile = useIsMobile();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  const isBusy = busy || !!externalBusy;

  useEffect(() => {
    if (open) {
      setPin("");
      setError(null);
      setBusy(false);
      setShake(false);
    }
  }, [open]);

  const handleComplete = async (value: string) => {
    if (isBusy) return;
    setBusy(true);
    setError(null);
    try {
      await onVerify(value);
      onSuccess?.(value);
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Incorrect PIN. Please try again.";
      setError(msg);
      setPin("");
      setShake(true);
      setTimeout(() => setShake(false), 400);
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <PinEntryBody
      title={title}
      description={description}
      length={length}
      pin={pin}
      setPin={(v) => {
        setPin(v);
        setError(null);
      }}
      error={error}
      busy={isBusy}
      onComplete={(p) => void handleComplete(p)}
      shake={shake}
    />
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(o) => !isBusy && onOpenChange(o)}>
        <SheetContent
          side="bottom"
          className="z-[110] rounded-t-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{title}</SheetTitle>
            {description && <SheetDescription>{description}</SheetDescription>}
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !isBusy && onOpenChange(o)}>
      <DialogContent className="z-[110] max-w-sm">
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

export interface PinEntryTriggerProps {
  label?: string;
  verified?: boolean;
  verifiedLabel?: string;
  length?: PinLength;
  title: string;
  description?: string;
  onVerify: (pin: string) => Promise<void>;
  onSuccess?: (pin: string) => void;
  disabled?: boolean;
  className?: string;
  required?: boolean;
}

/**
 * Touch-friendly PIN affordance for forms: tap → PinEntryDialog → verify → continue.
 */
export function PinEntryTrigger({
  label = "Tap to enter PIN",
  verified = false,
  verifiedLabel = "PIN verified",
  length = 4,
  title,
  description,
  onVerify,
  onSuccess,
  disabled,
  className,
  required,
}: PinEntryTriggerProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant={verified ? "outline" : "default"}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          "h-14 w-full touch-manipulation text-base font-semibold",
          verified && "border-green-600 text-green-700 hover:bg-green-50",
          className,
        )}
      >
        {verified ? `✓ ${verifiedLabel}` : label}
        {required && !verified && <span className="ml-1 text-destructive">*</span>}
      </Button>
      <PinEntryDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        length={length}
        onVerify={onVerify}
        onSuccess={(pin) => {
          onSuccess?.(pin);
          toast.success(verifiedLabel);
        }}
      />
    </>
  );
}
