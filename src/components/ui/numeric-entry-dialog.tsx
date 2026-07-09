import { useEffect, useState } from "react";
import { ChevronRight, Gauge } from "lucide-react";

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
import {
  NumericEntryPad,
  parseNumericEntry,
  snapToStep,
  type NumericEntryPadProps,
} from "@/components/ui/numeric-entry-pad";

export interface NumericEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Seed value when the dialog opens. */
  initialValue?: string;
  step?: number;
  allowDecimal?: boolean;
  min?: number;
  max?: number;
  unit?: string;
  stepLabel?: string;
  /** Called with the confirmed numeric value (snapped to step when decimal). */
  onConfirm: (value: number) => void;
  disabled?: boolean;
}

function NumericEntryBody({
  title,
  description,
  draft,
  setDraft,
  error,
  onConfirm,
  onCancel,
  disabled,
  padProps,
}: {
  title: string;
  description?: string;
  draft: string;
  setDraft: (v: string) => void;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
  padProps: Pick<
    NumericEntryPadProps,
    "step" | "allowDecimal" | "min" | "max" | "unit" | "stepLabel"
  >;
}) {
  return (
    <>
      <div className="mx-auto mb-2 flex justify-center">
        <div className="rounded-full bg-primary/10 p-2.5 text-primary">
          <Gauge className="h-6 w-6" />
        </div>
      </div>
      <div className="text-center">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="mt-4">
        <NumericEntryPad
          value={draft}
          onChange={(v) => setDraft(v)}
          disabled={disabled}
          {...padProps}
        />
      </div>
      {error && (
        <p className="mt-2 text-center text-sm font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-12 touch-manipulation text-base font-semibold"
          disabled={disabled}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          className="h-12 touch-manipulation text-base font-semibold"
          disabled={disabled}
          onClick={onConfirm}
        >
          Confirm
        </Button>
      </div>
    </>
  );
}

/**
 * Numeric entry overlay — bottom sheet on phone, centred dialog on tablet/desktop.
 * Use for km / odometer capture in the field (not PIN auth).
 */
export function NumericEntryDialog({
  open,
  onOpenChange,
  title,
  description,
  initialValue = "",
  step = 0.5,
  allowDecimal = true,
  min,
  max,
  unit = "km",
  stepLabel,
  onConfirm,
  disabled,
}: NumericEntryDialogProps) {
  const isMobile = useIsMobile();
  const [draft, setDraft] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(initialValue);
      setError(null);
    }
  }, [open, initialValue]);

  const handleConfirm = () => {
    const parsed = parseNumericEntry(draft);
    if (parsed == null) {
      setError("Enter a valid number.");
      return;
    }
    let final = parsed;
    if (allowDecimal) final = snapToStep(final, step);
    else final = Math.round(final);
    if (min != null && final < min) {
      setError(`Minimum is ${min} ${unit}.`);
      return;
    }
    if (max != null && final > max) {
      setError(`Maximum is ${max} ${unit}.`);
      return;
    }
    onConfirm(final);
    onOpenChange(false);
  };

  const padProps = { step, allowDecimal, min, max, unit, stepLabel };
  const body = (
    <NumericEntryBody
      title={title}
      description={description}
      draft={draft}
      setDraft={(v) => {
        setDraft(v);
        setError(null);
      }}
      error={error}
      onConfirm={handleConfirm}
      onCancel={() => onOpenChange(false)}
      disabled={disabled}
      padProps={padProps}
    />
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(o) => !disabled && onOpenChange(o)}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]"
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
    <Dialog open={open} onOpenChange={(o) => !disabled && onOpenChange(o)}>
      <DialogContent className="max-w-sm">
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

export type NumericEntryTriggerVariant = "default" | "dark";

export interface NumericEntryTriggerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  title: string;
  description?: string;
  step?: number;
  allowDecimal?: boolean;
  min?: number;
  max?: number;
  unit?: string;
  stepLabel?: string;
  disabled?: boolean;
  className?: string;
  variant?: NumericEntryTriggerVariant;
  id?: string;
}

function formatTriggerValue(value: string, unit: string, allowDecimal: boolean): string {
  const parsed = parseNumericEntry(value);
  if (parsed == null) return "";
  if (allowDecimal) return `${parsed} ${unit}`;
  return `${Math.round(parsed)} ${unit}`;
}

/** Touch-friendly numeric affordance: tap → NumericEntryDialog → confirm → update field. */
export function NumericEntryTrigger({
  label,
  value,
  onChange,
  placeholder = "Tap to enter",
  title,
  description,
  step = 0.5,
  allowDecimal = true,
  min,
  max,
  unit = "km",
  stepLabel,
  disabled,
  className,
  variant = "default",
  id,
}: NumericEntryTriggerProps) {
  const [open, setOpen] = useState(false);
  const display = formatTriggerValue(value, unit, allowDecimal);

  return (
    <>
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          "flex w-full min-h-14 touch-manipulation select-none items-center justify-between gap-3 rounded-xl border-2 px-4 py-3 text-left transition active:scale-[0.99] disabled:opacity-50",
          variant === "dark"
            ? "border-slate-600 bg-slate-950 text-white hover:border-slate-500 hover:bg-slate-900"
            : "border-border bg-card text-foreground hover:bg-muted/50",
          className,
        )}
      >
        <div className="min-w-0">
          <div
            className={cn(
              "text-xs font-bold uppercase tracking-wider",
              variant === "dark" ? "text-slate-400" : "text-muted-foreground",
            )}
          >
            {label}
          </div>
          <div
            className={cn(
              "mt-0.5 truncate text-lg font-semibold tabular-nums",
              !display && "text-muted-foreground font-normal text-base",
              variant === "dark" && display && "text-white",
            )}
          >
            {display || placeholder}
          </div>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
      </button>
      <NumericEntryDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        initialValue={value}
        step={step}
        allowDecimal={allowDecimal}
        min={min}
        max={max}
        unit={unit}
        stepLabel={stepLabel}
        onConfirm={(n) => {
          const decimals = allowDecimal ? (String(step).split(".")[1]?.length ?? 1) : 0;
          onChange(decimals > 0 ? String(Number(n.toFixed(decimals))) : String(Math.round(n)));
        }}
      />
    </>
  );
}
