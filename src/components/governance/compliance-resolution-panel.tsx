import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import { verifyManagerPin } from "@/components/auth/pin-verify";
import { DatePicker } from "@/components/ui/date-picker";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ComplianceAsset } from "@/lib/api/compliance-assets";
import type { ComplianceResolutionContext } from "@/hooks/use-compliance-resolution-context";
import { CharacterCountedInput } from "@/components/ui/character-counted-input";
import { MIN_EVIDENCE } from "@/lib/governance/constants";
import type { ChecklistItem } from "@/lib/api/checklists";
import {
  FormalAuditChecklist,
  buildFormalAuditPayload,
  emptyFormalAuditState,
  type FormalAuditState,
} from "@/components/dashboard/formal-audit-checklist";
import type { CertResolutionType, VehicleResolutionType } from "@/lib/api/ledger";
import { listStaffRegistry, type StaffMember } from "@/lib/data-store";
import {
  NextExpiryDateField,
  NextExpiryDateFieldIso,
} from "@/components/governance/next-expiry-date-field";
import { parseExpiryBase, parseISODateLocal, startOfDay, toISODate } from "@/lib/governance/next-expiry";

const FORMAL_AUDIT_CATEGORY = "VEHICLE_FORMAL_AUDIT";

function startOfToday(): Date {
  return startOfDay();
}

function todayISO(): string {
  return toISODate(startOfToday());
}

export type ComplianceResolutionPayload =
  | {
      kind: "vehicle";
      resolutionType: VehicleResolutionType;
      newRegistrationExpiry: string | null;
      newServiceOdo: number | null;
      newServiceDate: string | null;
      nextServiceDue: string | null;
      actionDate: string | null;
      evidenceRef: string | null;
      auditorStaffId: string | null;
      auditorPin: string | null;
      witnessStaffId: string | null;
      witnessPin: string | null;
      checklistResponses?: ReturnType<typeof buildFormalAuditPayload>["rows"];
    }
  | {
      kind: "cert";
      resolutionType: CertResolutionType;
      newExpiry: string | null;
      actionDate: string | null;
      evidenceRef: string | null;
    }
  | {
      kind: "generic";
      newExpiry: string;
      actionDate: string;
      evidenceRef: string;
      managerStaffId: string;
      managerPin: string;
      witnessStaffId: string | null;
      witnessPin: string | null;
    }
  | {
      kind: "generic_fallback";
      newExpiry: string;
      actionDate: string;
      evidenceRef: string;
    };

interface Props {
  asset: ComplianceAsset;
  context: ComplianceResolutionContext;
  /** When subject is missing, allow generic fallback fields. */
  allowGenericFallback?: boolean;
  /** Expiry is set on the Manage shell — panel collects domain fields only. */
  hideExpiryFields?: boolean;
  /** Shell-owned expiry ISO — used for validation when hideExpiryFields. */
  externalExpiryIso?: string;
  onValidityChange?: (valid: boolean) => void;
}

export interface ComplianceResolutionPanelHandle {
  validate: (newExpiryIso?: string) => boolean;
  getPayload: (newExpiryIso?: string) => ComplianceResolutionPayload | null;
  /** Formal audit uses embedded dual-PIN — skip shell PIN when true. */
  usesEmbeddedPin: boolean;
}

export const ComplianceResolutionPanel = forwardRef<
  ComplianceResolutionPanelHandle,
  Props
>(function ComplianceResolutionPanel(
  {
    asset,
    context,
    allowGenericFallback = true,
    hideExpiryFields = false,
    externalExpiryIso,
    onValidityChange,
  },
  ref,
) {
  const module = asset.action_module;
  const isVehicle =
    module === "vehicle_rego" ||
    module === "vehicle_service" ||
    module === "formal_audit";
  const isCert = module === "staff_cert";
  const isGeneric =
    module === "insurance_renewal" || module === "generic_resolve";

  const useGenericFallback =
    allowGenericFallback && context.subjectMissing && (isVehicle || isCert);

  const subject = context.vehicleSubject;
  const certSubject = context.certSubject;

  const initialVehicleType: VehicleResolutionType = useMemo(() => {
    if (module === "formal_audit") return "formal_audit";
    if (subject?.flagKind === "service") return "serviced";
    return "renewed";
  }, [module, subject?.flagKind]);

  const [vehicleResType, setVehicleResType] =
    useState<VehicleResolutionType>(initialVehicleType);
  const [certResType, setCertResType] = useState<CertResolutionType>("renewed");
  const [newExpiry, setNewExpiry] = useState<Date | undefined>(undefined);
  const [nextServiceDue, setNextServiceDue] = useState<Date | undefined>(undefined);
  const [serviceOdo, setServiceOdo] = useState("");
  const [actionDate, setActionDate] = useState<Date | undefined>(() =>
    startOfToday(),
  );
  const [evidenceRef, setEvidenceRef] = useState("");
  const [genericNewExpiry, setGenericNewExpiry] = useState("");
  const [genericActionDate, setGenericActionDate] = useState(todayISO());
  const [managerStaffId, setManagerStaffId] = useState("");
  const [managerPinVerified, setManagerPinVerified] = useState(false);
  const verifiedManagerPinRef = useRef("");
  const [witnessStaffId, setWitnessStaffId] = useState("");
  const [witnessPinVerified, setWitnessPinVerified] = useState(false);
  const verifiedWitnessPinRef = useRef("");
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [auditState, setAuditState] =
    useState<FormalAuditState>(emptyFormalAuditState);
  const [auditItems, setAuditItems] = useState<ChecklistItem[]>([]);

  const handshake = asset.config?.handshake === "dual" ? "dual" : "single";

  const currentExpiry = useMemo<Date | null>(() => {
    if (!subject || subject.flagKind !== "rego") return null;
    if (typeof subject.previousValue !== "string") return null;
    const d = new Date(subject.previousValue);
    return Number.isFinite(d.getTime()) ? d : null;
  }, [subject]);

  const expiryBase = asset.expiry_date ?? null;

  useEffect(() => {
    setVehicleResType(initialVehicleType);
    setCertResType("renewed");
    setActionDate(startOfToday());
    setEvidenceRef("");
    setGenericNewExpiry("");
    setGenericActionDate(todayISO());
    setManagerStaffId("");
    setManagerPinVerified(false);
    verifiedManagerPinRef.current = "";
    setWitnessStaffId("");
    setWitnessPinVerified(false);
    verifiedWitnessPinRef.current = "";
    setAuditState(emptyFormalAuditState);
    setServiceOdo(subject?.latestOdo != null ? String(subject.latestOdo) : "");
    setNewExpiry(undefined);
    setNextServiceDue(undefined);
    if (isGeneric || useGenericFallback) {
      listStaffRegistry()
        .then((s) => setStaff(s.filter((x) => x.active)))
        .catch(() => setStaff([]));
    }
  }, [asset.id, initialVehicleType, subject, isGeneric, useGenericFallback]);

  const today = startOfToday();
  const isFormalAudit =
    module === "formal_audit" || (isVehicle && vehicleResType === "formal_audit");

  const auditPayload = useMemo(
    () => buildFormalAuditPayload(auditItems, auditState),
    [auditItems, auditState],
  );

  const trimmedEvidence = evidenceRef.trim();
  const evidenceRequired =
    (isVehicle &&
      !useGenericFallback &&
      (vehicleResType === "renewed" || vehicleResType === "serviced")) ||
    (isCert && !useGenericFallback && certResType === "renewed") ||
    isGeneric ||
    useGenericFallback;

  const odoNum = serviceOdo.trim() === "" ? NaN : Number(serviceOdo);
  const regoExpiryBase =
    currentExpiry ??
    parseExpiryBase(
      typeof subject?.previousValue === "string" ? subject.previousValue : expiryBase,
    );
  const certExpiryBase = parseExpiryBase(certSubject?.expiry ?? expiryBase);
  const genericExpiryBase = parseExpiryBase(expiryBase);
  const serviceDueBase = parseExpiryBase(expiryBase);

  const regoRenewalMin = useMemo(
    () =>
      new Date(Math.max(today.getTime(), regoExpiryBase.getTime())),
    [today, regoExpiryBase],
  );
  const certRenewalMin = useMemo(
    () => new Date(Math.max(today.getTime(), certExpiryBase.getTime())),
    [today, certExpiryBase],
  );
  const genericRenewalMin = useMemo(
    () => new Date(Math.max(today.getTime(), genericExpiryBase.getTime())),
    [today, genericExpiryBase],
  );
  const serviceRenewalMin = useMemo(
    () => new Date(Math.max(today.getTime(), serviceDueBase.getTime())),
    [today, serviceDueBase],
  );

  const vehicleValid = useMemo(() => {
    if (!isVehicle || useGenericFallback) return false;
    if (module === "formal_audit") return !!subject && auditPayload.valid;
    if (!subject) return false;
    if (isFormalAudit) return auditPayload.valid;
    if (vehicleResType === "renewed") {
      return (
        !!actionDate &&
        actionDate.getTime() <= today.getTime() &&
        !!newExpiry &&
        newExpiry.getTime() > regoRenewalMin.getTime() &&
        trimmedEvidence.length >= MIN_EVIDENCE
      );
    }
    if (vehicleResType === "serviced") {
      return (
        !!actionDate &&
        actionDate.getTime() <= today.getTime() &&
        Number.isFinite(odoNum) &&
        odoNum >= 0 &&
        !!nextServiceDue &&
        nextServiceDue.getTime() > serviceRenewalMin.getTime() &&
        trimmedEvidence.length >= MIN_EVIDENCE
      );
    }
    if (vehicleResType === "decommissioned") return true;
    return false;
  }, [
    isVehicle,
    useGenericFallback,
    module,
    subject,
    isFormalAudit,
    auditPayload.valid,
    vehicleResType,
    actionDate,
    today,
    newExpiry,
    regoRenewalMin,
    trimmedEvidence,
    odoNum,
    nextServiceDue,
    serviceRenewalMin,
  ]);

  const certValid = useMemo(() => {
    if (!isCert || useGenericFallback || !certSubject) return false;
    if (certResType === "renewed") {
      return (
        !!actionDate &&
        actionDate.getTime() <= today.getTime() &&
        !!newExpiry &&
        newExpiry.getTime() > certRenewalMin.getTime() &&
        trimmedEvidence.length >= MIN_EVIDENCE
      );
    }
    return certResType === "revoked";
  }, [
    isCert,
    useGenericFallback,
    certSubject,
    certResType,
    actionDate,
    today,
    newExpiry,
    certRenewalMin,
    trimmedEvidence,
  ]);

  const genericValid = useMemo(() => {
    if (!isGeneric && !useGenericFallback) return false;
    if (!hideExpiryFields) {
      if (!genericNewExpiry || genericNewExpiry <= toISODate(genericRenewalMin)) {
        return false;
      }
    }
    if (genericActionDate > todayISO()) return false;
    if (trimmedEvidence.length < MIN_EVIDENCE) return false;
    if (isGeneric && !hideExpiryFields) {
      if (!managerStaffId || !managerPinVerified) return false;
      if (handshake === "dual") {
        if (!witnessStaffId || !witnessPinVerified) return false;
        if (witnessStaffId === managerStaffId) return false;
      }
    }
    return true;
  }, [
    isGeneric,
    useGenericFallback,
    hideExpiryFields,
    genericNewExpiry,
    genericActionDate,
    genericRenewalMin,
    trimmedEvidence,
    managerStaffId,
    managerPinVerified,
    handshake,
    witnessStaffId,
    witnessPinVerified,
  ]);

  const validate = (newExpiryIso?: string): boolean => {
    if (context.loading) return false;
    if (hideExpiryFields && isGeneric) return false;
    if (hideExpiryFields && newExpiryIso) {
      const ext = parseISODateLocal(newExpiryIso);
      const min = genericRenewalMin;
      if (!ext || ext.getTime() <= min.getTime()) return false;
    }
    if (useGenericFallback || isGeneric) return genericValid;
    if (isVehicle) {
      if (hideExpiryFields) {
        if (!newExpiryIso) return false;
        const ext = parseISODateLocal(newExpiryIso);
        if (!ext) return false;
        if (module === "formal_audit") return !!subject && auditPayload.valid;
        if (vehicleResType === "renewed" && ext.getTime() <= regoRenewalMin.getTime()) {
          return false;
        }
        if (vehicleResType === "serviced" && ext.getTime() <= serviceRenewalMin.getTime()) {
          return false;
        }
        return validateDomainOnly();
      }
      return vehicleValid;
    }
    if (isCert) {
      if (hideExpiryFields) {
        if (certResType === "revoked") return true;
        if (!newExpiryIso) return false;
        const ext = parseISODateLocal(newExpiryIso);
        if (!ext || ext.getTime() <= certRenewalMin.getTime()) return false;
        return (
          !!actionDate &&
          actionDate.getTime() <= today.getTime() &&
          trimmedEvidence.length >= MIN_EVIDENCE
        );
      }
      return certValid;
    }
    return genericValid;
  };

  function validateDomainOnly(): boolean {
    if (module === "formal_audit") return !!subject && auditPayload.valid;
    if (!subject) return false;
    if (vehicleResType === "renewed" || vehicleResType === "serviced") {
      return (
        !!actionDate &&
        actionDate.getTime() <= today.getTime() &&
        trimmedEvidence.length >= MIN_EVIDENCE &&
        (vehicleResType !== "serviced" || (Number.isFinite(odoNum) && odoNum >= 0))
      );
    }
    return vehicleResType === "decommissioned";
  }

  const getPayload = (newExpiryIso?: string): ComplianceResolutionPayload | null => {
    if (!validate(newExpiryIso)) return null;
    const ext = newExpiryIso ?? genericNewExpiry;

    if (useGenericFallback) {
      return {
        kind: "generic_fallback",
        newExpiry: ext,
        actionDate: genericActionDate,
        evidenceRef: trimmedEvidence,
      };
    }

    if (isGeneric) {
      return {
        kind: "generic",
        newExpiry: ext,
        actionDate: genericActionDate,
        evidenceRef: trimmedEvidence,
        managerStaffId,
        managerPin: verifiedManagerPinRef.current,
        witnessStaffId: handshake === "dual" ? witnessStaffId : null,
        witnessPin: handshake === "dual" ? verifiedWitnessPinRef.current : null,
      };
    }

    if (isVehicle && (subject || module === "formal_audit")) {
      if (!subject) return null;
      const evidenceRequiredLocal =
        vehicleResType === "renewed" || vehicleResType === "serviced";
      const expiryFromShell = hideExpiryFields ? ext : undefined;
      return {
        kind: "vehicle",
        resolutionType: module === "formal_audit" ? "formal_audit" : vehicleResType,
        newRegistrationExpiry:
          vehicleResType === "renewed"
            ? expiryFromShell ?? (newExpiry ? toISODate(newExpiry) : null)
            : null,
        newServiceOdo: vehicleResType === "serviced" ? odoNum : null,
        newServiceDate:
          vehicleResType === "serviced" && actionDate ? toISODate(actionDate) : null,
        nextServiceDue:
          vehicleResType === "serviced"
            ? expiryFromShell ?? (nextServiceDue ? toISODate(nextServiceDue) : null)
            : null,
        actionDate:
          (vehicleResType === "renewed" || vehicleResType === "serviced") &&
          actionDate
            ? toISODate(actionDate)
            : null,
        evidenceRef: evidenceRequiredLocal ? trimmedEvidence : null,
        auditorStaffId: isFormalAudit ? auditState.auditorStaffId : null,
        auditorPin: isFormalAudit ? auditState.auditorPin : null,
        witnessStaffId: isFormalAudit ? auditState.witnessStaffId : null,
        witnessPin: isFormalAudit ? auditState.witnessPin : null,
        checklistResponses: isFormalAudit ? auditPayload.rows : undefined,
      };
    }

    if (isCert && certSubject) {
      const expiryFromShell = hideExpiryFields ? ext : undefined;
      return {
        kind: "cert",
        resolutionType: certResType,
        newExpiry:
          certResType === "renewed"
            ? expiryFromShell ?? (newExpiry ? toISODate(newExpiry) : null)
            : null,
        actionDate:
          certResType === "renewed" && actionDate ? toISODate(actionDate) : null,
        evidenceRef: certResType === "renewed" ? trimmedEvidence : null,
      };
    }

    return null;
  };

  useImperativeHandle(ref, () => ({
    validate,
    getPayload,
    usesEmbeddedPin: isFormalAudit,
  }));

  const shellExpiryIso = hideExpiryFields ? externalExpiryIso : undefined;
  const panelValid = useMemo(
    () => validate(shellExpiryIso),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      shellExpiryIso,
      hideExpiryFields,
      context.loading,
      genericValid,
      vehicleValid,
      certValid,
      vehicleResType,
      certResType,
      actionDate,
      trimmedEvidence,
      auditPayload.valid,
      managerStaffId,
      managerPinVerified,
      witnessStaffId,
      witnessPinVerified,
      genericNewExpiry,
      genericActionDate,
      newExpiry,
      nextServiceDue,
      serviceOdo,
      odoNum,
      subject,
      module,
    ],
  );

  useEffect(() => {
    onValidityChange?.(panelValid);
  }, [panelValid, onValidityChange]);

  if (context.loading) {
    return (
      <p className="text-xs text-muted-foreground">Loading linked subject…</p>
    );
  }

  if (hideExpiryFields && isGeneric) {
    return null;
  }

  if (context.subjectMissing && !allowGenericFallback) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{context.subjectMissingLabel}</p>
      </div>
    );
  }

  if (useGenericFallback) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{context.subjectMissingLabel}</p>
        </div>
        <GenericFields
          baseDate={expiryBase}
          resetKey={asset.id}
          newExpiry={genericNewExpiry}
          onNewExpiry={setGenericNewExpiry}
          actionDate={genericActionDate}
          onActionDate={setGenericActionDate}
          evidenceRef={evidenceRef}
          onEvidenceRef={setEvidenceRef}
          showPin={false}
          hideExpiryFields={hideExpiryFields}
        />
      </div>
    );
  }

  if (isGeneric) {
    return (
      <GenericFields
        baseDate={expiryBase}
        resetKey={asset.id}
        newExpiry={genericNewExpiry}
        onNewExpiry={setGenericNewExpiry}
        actionDate={genericActionDate}
        onActionDate={setGenericActionDate}
        evidenceRef={evidenceRef}
        onEvidenceRef={setEvidenceRef}
        showPin
        handshake={handshake}
        staff={staff}
        managerStaffId={managerStaffId}
        onManagerStaffId={(id) => {
          setManagerStaffId(id);
          setManagerPinVerified(false);
          verifiedManagerPinRef.current = "";
        }}
        managerPinVerified={managerPinVerified}
        onManagerPinVerified={(pin) => {
          verifiedManagerPinRef.current = pin;
          setManagerPinVerified(true);
        }}
        witnessStaffId={witnessStaffId}
        onWitnessStaffId={(id) => {
          setWitnessStaffId(id);
          setWitnessPinVerified(false);
          verifiedWitnessPinRef.current = "";
        }}
        witnessPinVerified={witnessPinVerified}
        onWitnessPinVerified={(pin) => {
          verifiedWitnessPinRef.current = pin;
          setWitnessPinVerified(true);
        }}
      />
    );
  }

  if (isVehicle && (subject || module === "formal_audit")) {
    return (
      <div className="space-y-3">
        {subject && (
          <div className="grid gap-1.5 rounded-md border bg-muted/40 px-3 py-2 text-xs">
            <Row label="Vehicle" value={`${subject.assetName} · ${subject.regoPlate}`} />
            <Row
              label="Flag"
              value={subject.flagKind === "service" ? "Service Due" : "Registration"}
            />
          </div>
        )}

        {module !== "formal_audit" ? (
          <div className="grid gap-1.5">
            <Label className="text-sm font-semibold">Resolution type</Label>
            <RadioGroup
              value={vehicleResType}
              onValueChange={(v) => setVehicleResType(v as VehicleResolutionType)}
              className="grid grid-cols-2 gap-2"
            >
              {(
                [
                  ...(subject.flagKind === "rego"
                    ? [{ v: "renewed" as const, label: "Renewed Rego" }]
                    : []),
                  ...(subject.flagKind === "service"
                    ? [{ v: "serviced" as const, label: "Serviced" }]
                    : []),
                  { v: "decommissioned", label: "Decommission" },
                ] as { v: VehicleResolutionType; label: string }[]
              ).map((opt) => (
                <label
                  key={opt.v}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs",
                    vehicleResType === opt.v
                      ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30"
                      : "border-border",
                  )}
                >
                  <RadioGroupItem value={opt.v} />
                  {opt.label}
                </label>
              ))}
            </RadioGroup>
          </div>
        ) : null}

        {module === "formal_audit" && (
          <FormalAuditChecklist
            category={FORMAL_AUDIT_CATEGORY}
            value={auditState}
            onChange={setAuditState}
            onItemsLoaded={setAuditItems}
          />
        )}

        {module !== "formal_audit" && vehicleResType === "renewed" && (
          <>
            <DateField
              label="Payment / renewal date"
              value={actionDate}
              onChange={setActionDate}
              disabledFn={(d) => d.getTime() > today.getTime()}
            />
            {!hideExpiryFields && (
              <NextExpiryDateField
                baseDate={
                  typeof subject?.previousValue === "string"
                    ? subject.previousValue
                    : expiryBase
                }
                resetKey={`${asset.id}:rego-renewed`}
                value={newExpiry}
                onChange={setNewExpiry}
                minDate={regoRenewalMin}
                label="Next registration expiry"
              />
            )}
          </>
        )}

        {module !== "formal_audit" && vehicleResType === "serviced" && (
          <>
            <DateField
              label="Service date"
              value={actionDate}
              onChange={setActionDate}
              disabledFn={(d) => d.getTime() > today.getTime()}
            />
            <div className="space-y-1">
              <Label className="text-sm font-semibold">Odometer at service (km)</Label>
              <Input
                type="number"
                min={0}
                value={serviceOdo}
                onChange={(e) => setServiceOdo(e.target.value)}
              />
            </div>
            {!hideExpiryFields && (
              <NextExpiryDateField
                baseDate={expiryBase ?? (actionDate ? toISODate(actionDate) : null)}
                resetKey={`${asset.id}:service-due`}
                value={nextServiceDue}
                onChange={setNextServiceDue}
                minDate={serviceRenewalMin}
                label="Next service due"
              />
            )}
          </>
        )}

        {module !== "formal_audit" && !isFormalAudit && evidenceRequired && (
          <EvidenceField value={evidenceRef} onChange={setEvidenceRef} required />
        )}
      </div>
    );
  }

  if (isCert && certSubject) {
    return (
      <div className="space-y-3">
        <div className="grid gap-1.5 rounded-md border bg-muted/40 px-3 py-2 text-xs">
          <Row label="Staff" value={certSubject.staffName} />
          <Row label="Cert" value={certSubject.certName} />
        </div>

        <RadioGroup
          value={certResType}
          onValueChange={(v) => setCertResType(v as CertResolutionType)}
          className="grid grid-cols-2 gap-2"
        >
          {(
            [
              { v: "renewed", label: "Renewed" },
              { v: "revoked", label: "Revoke" },
            ] as { v: CertResolutionType; label: string }[]
          ).map((opt) => (
            <label
              key={opt.v}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs",
                certResType === opt.v
                  ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30"
                  : "border-border",
              )}
            >
              <RadioGroupItem value={opt.v} />
              {opt.label}
            </label>
          ))}
        </RadioGroup>

        {certResType === "renewed" && (
          <>
            <DateField
              label="Renewal date"
              value={actionDate}
              onChange={setActionDate}
              disabledFn={(d) => d.getTime() > today.getTime()}
            />
            {!hideExpiryFields && (
              <NextExpiryDateField
                baseDate={certSubject.expiry ?? expiryBase}
                resetKey={`${asset.id}:cert-renewed`}
                value={newExpiry}
                onChange={setNewExpiry}
                minDate={certRenewalMin}
                label="Next certification expiry"
              />
            )}
            <EvidenceField value={evidenceRef} onChange={setEvidenceRef} required />
          </>
        )}
      </div>
    );
  }

  return null;
});

function GenericFields({
  baseDate,
  resetKey,
  newExpiry,
  onNewExpiry,
  actionDate,
  onActionDate,
  evidenceRef,
  onEvidenceRef,
  showPin,
  hideExpiryFields = false,
  handshake = "single",
  staff = [],
  managerStaffId = "",
  onManagerStaffId,
  managerPinVerified = false,
  onManagerPinVerified,
  witnessStaffId = "",
  onWitnessStaffId,
  witnessPinVerified = false,
  onWitnessPinVerified,
}: {
  baseDate: string | null;
  resetKey: string;
  newExpiry: string;
  onNewExpiry: (v: string) => void;
  actionDate: string;
  onActionDate: (v: string) => void;
  evidenceRef: string;
  onEvidenceRef: (v: string) => void;
  showPin: boolean;
  hideExpiryFields?: boolean;
  handshake?: "single" | "dual";
  staff?: StaffMember[];
  managerStaffId?: string;
  onManagerStaffId?: (v: string) => void;
  managerPinVerified?: boolean;
  onManagerPinVerified?: (pin: string) => void;
  witnessStaffId?: string;
  onWitnessStaffId?: (v: string) => void;
  witnessPinVerified?: boolean;
  onWitnessPinVerified?: (pin: string) => void;
}) {
  const minIso = toISODate(
    new Date(Math.max(Date.now(), parseExpiryBase(baseDate).getTime())),
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label>Action date</Label>
        <Input type="date" value={actionDate} max={todayISO()} onChange={(e) => onActionDate(e.target.value)} />
      </div>
      {!hideExpiryFields && (
        <div className="space-y-1 sm:col-span-2">
          <NextExpiryDateFieldIso
            baseDate={baseDate}
            resetKey={resetKey}
            value={newExpiry}
            onChange={onNewExpiry}
            minDate={minIso}
            label="Next expiry / renewal date"
          />
        </div>
      )}
      <div className="space-y-1 sm:col-span-2">
        <EvidenceField value={evidenceRef} onChange={onEvidenceRef} required />
      </div>
      {showPin && onManagerStaffId && onManagerPinVerified && (
        <>
          <div className="space-y-1">
            <Label>Manager</Label>
            <Select value={managerStaffId} onValueChange={onManagerStaffId}>
              <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
              <SelectContent>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Manager PIN</Label>
            <PinEntryTrigger
              label="Tap to enter manager PIN"
              verified={managerPinVerified}
              verifiedLabel="Manager PIN verified"
              length={6}
              title="Resolve compliance item"
              description="Manager PIN required to sign off this resolution."
              disabled={!managerStaffId}
              onVerify={async (pin) => {
                await verifyManagerPin(managerStaffId, pin);
              }}
              onSuccess={onManagerPinVerified}
            />
          </div>
          {handshake === "dual" && onWitnessStaffId && onWitnessPinVerified && (
            <>
              <div className="space-y-1">
                <Label>Witness</Label>
                <Select value={witnessStaffId} onValueChange={onWitnessStaffId}>
                  <SelectTrigger><SelectValue placeholder="Select witness" /></SelectTrigger>
                  <SelectContent>
                    {staff.filter((s) => s.id !== managerStaffId).map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.fullName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Witness PIN</Label>
                <PinEntryTrigger
                  label="Tap to enter witness PIN"
                  verified={witnessPinVerified}
                  verifiedLabel="Witness PIN verified"
                  length={6}
                  title="Witness compliance resolution"
                  description="Witness PIN required for dual-handshake assets."
                  disabled={!witnessStaffId}
                  onVerify={async (pin) => {
                    await verifyManagerPin(witnessStaffId, pin);
                  }}
                  onSuccess={onWitnessPinVerified}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function EvidenceField({
  value,
  onChange,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <CharacterCountedInput
      label="Evidence reference"
      value={value}
      onValueChange={onChange}
      minChars={MIN_EVIDENCE}
      required={required ?? false}
      placeholder="Invoice #, policy ref, SharePoint link…"
    />
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
  helper?: string;
  disabledFn?: (d: Date) => boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-sm font-semibold">{label}</Label>
      <DatePicker
        value={value}
        onChange={onChange}
        placeholder="Select a date"
        disabledDates={disabledFn}
        dateFormat="dd/MM/yyyy"
        className="h-9 text-sm"
      />
      {helper && <span className="text-[11px] text-muted-foreground">{helper}</span>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-16 shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-xs font-medium">{value}</span>
    </div>
  );
}
