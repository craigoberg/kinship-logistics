import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { CalendarIcon, Loader2, ShieldCheck } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

import {
  resolveVehicleMaintenance,
  type VehicleResolutionType,
  type VehicleFlagKind,
} from "@/lib/api/ledger";

const MIN_NOTES = 20;
const MIN_EVIDENCE = 6;
const MAX_DEFER_DAYS = 30;

export interface ResolveVehicleSubject {
  assetId: string;
  assetName: string;
  regoPlate: string;
  flagKind: VehicleFlagKind;
  /** Current rego expiry / last_service_odo (for context display). */
  previousValue: string | number | null;
  /** Latest known odometer reading — used to pre-fill "Serviced". */
  latestOdo: number | null;
}

interface Props {
  subject: ResolveVehicleSubject | null;
  onClose: () => void;
  onResolved?: () => void;
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}
function startOfToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function ResolveVehicleMaintenanceModal({
  subject,
  onClose,
  onResolved,
}: Props) {
  // Defaults derive from the flag kind: rego → renewed, service → serviced.
  const initialType: VehicleResolutionType = useMemo(() => {
    if (subject?.flagKind === "service") return "serviced";
    return "renewed";
  }, [subject]);

  const [resType, setResType] = useState<VehicleResolutionType>(initialType);
  const [newExpiry, setNewExpiry] = useState<Date | undefined>(undefined);
  const [serviceOdo, setServiceOdo] = useState<string>("");
  const [actionDate, setActionDate] = useState<Date | undefined>(() => startOfToday());
  const [deferredUntil, setDeferredUntil] = useState<Date | undefined>(undefined);
  const [evidenceRef, setEvidenceRef] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const currentExpiry = useMemo<Date | null>(() => {
    if (!subject || subject.flagKind !== "rego") return null;
    if (typeof subject.previousValue !== "string") return null;
    const d = new Date(subject.previousValue);
    return Number.isFinite(d.getTime()) ? d : null;
  }, [subject]);

  useEffect(() => {
    if (!subject) {
      setNewExpiry(undefined);
      setServiceOdo("");
      setActionDate(startOfToday());
      setDeferredUntil(undefined);
      setEvidenceRef("");
      setNotes("");
      return;
    }
    setResType(initialType);
    setActionDate(startOfToday());
    setServiceOdo(subject.latestOdo != null ? String(subject.latestOdo) : "");
    // Smart seed: New Expiry = current_expiry + 1 year (or today + 1 year fallback).
    const base = currentExpiry ?? startOfToday();
    const seeded = new Date(base.getFullYear() + 1, base.getMonth(), base.getDate());
    setNewExpiry(seeded);
  }, [subject, initialType, currentExpiry]);


  useEffect(() => {
    // Clear evidence when switching to a resolution that doesn't require it.
    if (resType !== "renewed" && resType !== "serviced" && evidenceRef !== "") {
      setEvidenceRef("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resType]);

  const today = startOfToday();
  const maxDefer = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + MAX_DEFER_DAYS);
    return d;
  }, [today]);

  const trimmedNotes = notes.trim();
  const trimmedEvidence = evidenceRef.trim();
  const notesTooShort = trimmedNotes.length < MIN_NOTES;
  const evidenceRequired = resType === "renewed" || resType === "serviced";
  const evidenceTooShort = trimmedEvidence.length < MIN_EVIDENCE;

  const odoNum = serviceOdo.trim() === "" ? NaN : Number(serviceOdo);
  const odoInvalid =
    resType === "serviced" && (!Number.isFinite(odoNum) || odoNum < 0);

  const actionDateRequired = resType === "renewed" || resType === "serviced";
  const actionDateMissing = actionDateRequired && !actionDate;
  const actionDateInvalid =
    actionDateRequired && !!actionDate && actionDate.getTime() > today.getTime();

  const renewedLowerBound = currentExpiry ?? today;
  const dateMissing =
    (resType === "renewed" && !newExpiry) ||
    (resType === "deferred" && !deferredUntil);
  const dateInvalid =
    (resType === "renewed" &&
      newExpiry &&
      newExpiry.getTime() <= renewedLowerBound.getTime()) ||
    (resType === "deferred" &&
      deferredUntil &&
      (deferredUntil.getTime() <= today.getTime() ||
        deferredUntil.getTime() > maxDefer.getTime()));

  const canSubmit =
    !submitting &&
    !notesTooShort &&
    !(evidenceRequired && evidenceTooShort) &&
    !dateMissing &&
    !dateInvalid &&
    !odoInvalid &&
    !actionDateMissing &&
    !actionDateInvalid;


  const progress = Math.min(100, Math.round((trimmedNotes.length / MIN_NOTES) * 100));

  const submit = async () => {
    if (!subject || !canSubmit) return;
    setSubmitting(true);
    try {
      await resolveVehicleMaintenance({
        assetId: subject.assetId,
        assetName: subject.assetName,
        regoPlate: subject.regoPlate,
        flagKind: subject.flagKind,
        resolutionType: resType,
        newRegistrationExpiry:
          resType === "renewed" && newExpiry ? toISODate(newExpiry) : null,
        newServiceOdo: resType === "serviced" ? odoNum : null,
        newServiceDate:
          resType === "serviced" && actionDate ? toISODate(actionDate) : null,
        deferredUntil:
          resType === "deferred" && deferredUntil ? toISODate(deferredUntil) : null,
        actionDate: actionDateRequired && actionDate ? toISODate(actionDate) : null,

        previousValue: subject.previousValue,
        evidenceRef: evidenceRequired ? trimmedEvidence : null,
        justification: trimmedNotes,
      });
      toast.success("Vehicle resolution recorded", {
        description: `${subject.assetName} · ${resType}`,
      });
      onResolved?.();
      onClose();
    } catch (err) {
      toast.error("Could not resolve vehicle item", {
        description: (err as Error).message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const open = !!subject;
  const flagLabel: Record<VehicleFlagKind, string> = {
    rego: "Registration",
    service: "Service Due",
    vin_missing: "VIN Missing",
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !submitting) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md gap-3 p-5">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Resolve Vehicle Maintenance
          </DialogTitle>
          <DialogDescription className="text-xs">
            Manager action. Permanently logged to the operational ledger.
          </DialogDescription>
        </DialogHeader>

        {subject && (
          <div className="space-y-3">
            <div className="grid gap-1.5 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
              <Row label="Vehicle" value={`${subject.assetName} · ${subject.regoPlate}`} />
              <Row label="Flag" value={flagLabel[subject.flagKind]} />
              <Row
                label="Current"
                value={
                  subject.previousValue == null
                    ? "—"
                    : String(subject.previousValue)
                }
              />
            </div>

            <div className="grid gap-1.5">
              <Label className="text-sm font-semibold">Resolution Type</Label>
              <RadioGroup
                value={resType}
                onValueChange={(v) => setResType(v as VehicleResolutionType)}
                className="grid grid-cols-2 gap-2"
              >
                {(
                  [
                    { v: "renewed", label: "Renewed Rego" },
                    { v: "serviced", label: "Serviced" },
                    { v: "deferred", label: "Defer" },
                    { v: "decommissioned", label: "Decommission" },
                  ] as { v: VehicleResolutionType; label: string }[]
                ).map((opt) => (
                  <label
                    key={opt.v}
                    htmlFor={`vrt-${opt.v}`}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs",
                      resType === opt.v
                        ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30"
                        : "border-border",
                    )}
                  >
                    <RadioGroupItem id={`vrt-${opt.v}`} value={opt.v} />
                    {opt.label}
                  </label>
                ))}
              </RadioGroup>
            </div>

            {resType === "renewed" && (
              <>
                <div className="grid gap-1">
                  <DateField
                    label="Payment / Renewal Date"
                    value={actionDate}
                    onChange={setActionDate}
                    helper="When the rego payment actually occurred. Past dates allowed; future dates are not."
                    disabledFn={(d) => d.getTime() > today.getTime()}
                  />
                </div>
                <div className="grid gap-1">
                  <DateField
                    label="New Registration Expiry"
                    value={newExpiry}
                    onChange={setNewExpiry}
                    helper="Back-dating allowed for evidence entry, but the resulting expiry must be after today."
                  />
                  {newExpiry && newExpiry.getTime() <= today.getTime() && (
                    <span className="text-[11px] font-medium text-destructive">
                      Expiry must be after today — renewals with an already-expired date cannot resolve the flag.
                    </span>
                  )}
                </div>
              </>
            )}

            {resType === "serviced" && (
              <>
                <div className="grid gap-1">
                  <DateField
                    label="Service Date"
                    value={actionDate}
                    onChange={setActionDate}
                    helper="When the service actually occurred. Past dates allowed; future dates are not."
                    disabledFn={(d) => d.getTime() > today.getTime()}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="service-odo" className="text-sm font-semibold">
                    Odometer at Service (km)
                  </Label>
                  <Input
                    id="service-odo"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={serviceOdo}
                    onChange={(e) => setServiceOdo(e.target.value)}
                    className="text-sm"
                  />
                </div>
              </>
            )}


            {resType === "deferred" && (
              <DateField
                label="Defer Until"
                value={deferredUntil}
                onChange={setDeferredUntil}
                helper={`Max ${MAX_DEFER_DAYS} days from today.`}
                disabledFn={(d) =>
                  d.getTime() <= today.getTime() || d.getTime() > maxDefer.getTime()
                }
              />
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="v-evidence" className="flex items-center gap-1.5 text-sm font-semibold">
                Evidence Reference
                <span
                  className={cn(
                    "text-[10px] font-medium uppercase tracking-wide",
                    evidenceRequired ? "text-rose-600" : "text-muted-foreground",
                  )}
                >
                  {evidenceRequired ? "Required" : "Optional"}
                </span>
              </Label>
              <Input
                id="v-evidence"
                value={evidenceRef}
                onChange={(e) => setEvidenceRef(e.target.value)}
                placeholder={
                  evidenceRequired
                    ? "Rego paper #, service invoice #, SharePoint link…"
                    : "Not required for defer/decommission"
                }
                className="text-sm"
              />
              {evidenceRequired && evidenceTooShort && (
                <span className="text-[11px] text-muted-foreground">
                  {MIN_EVIDENCE - trimmedEvidence.length} more chars required.
                </span>
              )}
            </div>

            <div className="grid gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="v-notes" className="text-sm font-semibold">
                  Manager Justification
                </Label>
                <span
                  className={cn(
                    "text-[11px] tabular-nums",
                    notesTooShort ? "text-muted-foreground" : "text-emerald-600",
                  )}
                >
                  {notesTooShort ? `${MIN_NOTES - trimmedNotes.length} more` : "Ready"}
                </span>
              </div>
              <Textarea
                id="v-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What was verified? Who signed off? Reason for defer/decommission?"
                className="resize-none text-sm"
              />
              <Progress
                value={progress}
                className={cn("h-1", !notesTooShort && "[&>div]:bg-emerald-600")}
              />
            </div>

            <Button
              type="button"
              disabled={!canSubmit}
              onClick={submit}
              className="h-11 w-full bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-700"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <ShieldCheck className="mr-1.5 h-4 w-4" />
                  Append Resolution Receipt
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DateField({
  label,
  value,
  onChange,
  helper,
  disabledFn,
}: {
  label: string;
  value: Date | undefined;
  onChange: (d: Date | undefined) => void;
  helper: string;
  disabledFn?: (d: Date) => boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-sm font-semibold">{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              "h-9 w-full justify-start text-left text-sm font-normal",
              !value && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {value ? format(value, "dd/MM/yyyy") : "Select a date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            onSelect={onChange}
            disabled={disabledFn}
            initialFocus
          />
        </PopoverContent>
      </Popover>
      <span className="text-[11px] text-muted-foreground">{helper}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-16 shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-xs font-medium text-foreground">{value}</span>
    </div>
  );
}
