import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, Pencil, Plus, Trash2, Save } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IconActionButton } from "@/components/ui/icon-action-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { OnboardingSubjectPanel } from "@/components/onboarding/onboarding-subject-panel";
import { cn, formatDate, parseIsoDateLocal, toIsoDateString } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ServiceExitDialog } from "@/components/directory/service-exit-dialog";
import { exitReasonLabel, isDeceasedExit } from "@/lib/service-exit";
import { Checkbox } from "@/components/ui/checkbox";
import { PinPad } from "@/components/auth/pin-pad";
import { PinEntryDialog } from "@/components/auth/pin-entry-dialog";
import { verifyManagerPin } from "@/components/auth/pin-verify";
import {
  useInsertStaffMember,
  usePatchStaffMember,
  useUpdateStaffMember,
} from "@/hooks/use-supabase-data";
import { setStaffDayLoginPassword } from "@/lib/api/staff-auth";
import {
  listDutyRoles,
  listRequirementTypes,
  listStaffDutyRoleIds,
  replaceStaffDutyRoles,
} from "@/lib/api/duty-roles";
import {
  evaluateRequirementHolds,
  requirementTypeMatchesName,
  type RequirementType,
} from "@/lib/duty-roles";
import { getActiveUserProfile } from "@/lib/data-store";
import { managerSetPersonPin, managerUnlockPersonPin } from "@/lib/auth/pin-session";
import type { StaffMember, StaffCertification, StaffPayload } from "@/lib/data-store";
import { ACCESS_ROLES, normalizeAccessRoleKey } from "@/lib/access-roles";
import { listCarerLinksForStaff } from "@/lib/api/known-people";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import { SupportTransportDefaults } from "@/components/directory/support-transport-defaults";
import { PersonAddressList } from "@/components/address/person-address-list";
import { classifyWorkforceKind } from "@/lib/support-person";
import { supabase } from "@/integrations/supabase/client";




interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staff: StaffMember | null;
}

const EMPTY_CERT: StaffCertification = {
  name: "",
  number: "",
  expiry: null,
  deferredUntil: null,
  requirementTypeId: null,
};

/** Stored id, or the Lookups row the certificate name already matches. */
function catalogueTypeId(cert: StaffCertification, catalogue: RequirementType[]): string {
  const stored = (cert.requirementTypeId ?? "").trim();
  if (stored) return stored;
  return catalogue.find((t) => requirementTypeMatchesName(t, cert.name))?.id ?? "";
}

function certSignature(list: StaffCertification[], catalogue: RequirementType[]): string {
  return JSON.stringify(
    list.map((c) => {
      const requirementTypeId = catalogueTypeId(c, catalogue);
      const type = catalogue.find((t) => t.id === requirementTypeId);
      return {
        name: (c.name.trim() || type?.name || "").trim(),
        number: c.number.trim(),
        expiry: c.expiry || null,
        deferredUntil: c.deferredUntil || null,
        requirementTypeId: requirementTypeId || null,
      };
    }),
  );
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((id, i) => id === right[i]);
}

export function StaffFormSheet({ open, onOpenChange, staff }: Props) {
  const isEdit = !!staff;
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("");
  const [personnelType, setPersonnelType] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [streetAddress, setStreetAddress] = useState("");
  const [active, setActive] = useState(true);
  const [exitMode, setExitMode] = useState<"offboard" | "reactivate" | null>(null);
  const [exitSnapshot, setExitSnapshot] = useState<{
    active: boolean;
    exitReason: string | null;
    exitNotes: string | null;
    exitedAt: string | null;
  } | null>(null);
  const [notes, setNotes] = useState("");
  const [pin, setPin] = useState("");
  const [certs, setCerts] = useState<StaffCertification[]>([]);
  const [editingCert, setEditingCert] = useState<number | null>(null);
  const [dutyRoleIds, setDutyRoleIds] = useState<string[]>([]);
  const [dayPassword, setDayPassword] = useState("");
  const [dayPasswordConfirm, setDayPasswordConfirm] = useState("");
  const [passwordPinOpen, setPasswordPinOpen] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [openSections, setOpenSections] = useState<string[]>([]);
  const [pinNowUnlocked, setPinNowUnlocked] = useState(false);
  const [identityBaseline, setIdentityBaseline] = useState({
    fullName: "",
    role: "",
    personnelType: "",
  });
  const [contactBaseline, setContactBaseline] = useState({ phone: "", email: "", street: "" });
  const [notesBaseline, setNotesBaseline] = useState("");
  const [certBaseline, setCertBaseline] = useState<string | null>(null);
  const [savedDutyIds, setSavedDutyIds] = useState<string[] | null>(null);

  const insert = useInsertStaffMember();
  const update = useUpdateStaffMember();
  const patch = usePatchStaffMember();
  const [sectionBusy, setSectionBusy] = useState<string | null>(null);
  const busy = insert.isPending || update.isPending || passwordBusy || sectionBusy != null;

  const reqTypesQ = useQuery({
    queryKey: ["duty-roles", "types"],
    queryFn: () => listRequirementTypes(true),
    staleTime: 30_000,
    enabled: open,
  });
  const dutyRolesQ = useQuery({
    queryKey: ["duty-roles", "roles"],
    queryFn: () => listDutyRoles(false),
    staleTime: 30_000,
    enabled: open,
  });
  const carerLinksQ = useQuery({
    queryKey: ["staff-carer-links", staff?.id ?? "new"],
    queryFn: () => listCarerLinksForStaff(staff!.id),
    enabled: open && !!staff?.id,
    staleTime: 15_000,
  });
  const carerLinks = carerLinksQ.data ?? [];
  const assignedQ = useQuery({
    queryKey: ["staff-duty-roles", staff?.id ?? "new"],
    queryFn: () => listStaffDutyRoleIds(staff!.id),
    enabled: open && !!staff?.id,
    staleTime: 15_000,
  });
  const catalogue = reqTypesQ.data ?? [];
  const activeCatalogue = catalogue.filter((t) => t.active);
  const dutyRoles = dutyRolesQ.data ?? [];
  const pinLockQ = useQuery({
    queryKey: ["person-pin-lock", "staff", staff?.id ?? ""],
    enabled: open && !!staff?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_registry")
        .select("pin_locked_at")
        .eq("id", staff!.id)
        .maybeSingle();
      if (error) throw error;
      return Boolean((data as { pin_locked_at?: string | null } | null)?.pin_locked_at);
    },
  });

  useEffect(() => {
    if (!open) return;
    setFullName(staff?.fullName ?? "");
    setRole(staff?.role ?? "");
    setPersonnelType(normalizeAccessRoleKey(staff?.personnelType) ?? staff?.personnelType ?? "");
    setPhone(staff?.phone ?? "");
    setEmail(staff?.email ?? "");
    setStreetAddress(staff?.streetAddress ?? "");
    setActive(staff?.active ?? true);
    setExitSnapshot(null);
    setExitMode(null);
    setNotes(staff?.notes ?? "");
    setPin("");
    setCerts(staff?.certifications ?? []);
    setEditingCert(null);
    setDutyRoleIds([]);
    setDayPassword("");
    setDayPasswordConfirm("");
    setPasswordPinOpen(false);
    setOpenSections([]);
    setPinNowUnlocked(false);
    setIdentityBaseline({
      fullName: staff?.fullName?.trim() ?? "",
      role: (staff?.role ?? "").trim(),
      personnelType: normalizeAccessRoleKey(staff?.personnelType) ?? staff?.personnelType ?? "",
    });
    setContactBaseline({
      phone: (staff?.phone ?? "").trim(),
      email: (staff?.email ?? "").trim(),
      street: (staff?.streetAddress ?? "").trim(),
    });
    setNotesBaseline((staff?.notes ?? "").trim());
    setCertBaseline(null);
    setSavedDutyIds(null);
    // Refetch of this same person must not wipe unsaved edits in other sections.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, staff?.id]);

  useEffect(() => {
    if (!open || !assignedQ.data || savedDutyIds !== null) return;
    setDutyRoleIds(assignedQ.data);
    setSavedDutyIds(assignedQ.data);
  }, [open, assignedQ.data, savedDutyIds]);

  const updateCert = (i: number, patch: Partial<StaffCertification>) => {
    setCerts((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };

  const save = async () => {
    console.log("[staff-form] save() invoked", { isEdit, fullName, personnelType, pinLen: pin.length });
    try {
      if (!fullName.trim()) {
        toast.error("Full name is required", {
          className: "!bg-red-600 !text-white !border-red-700",
        });
        return;
      }
      if (!isEdit && !role.trim()) {
        toast.error("Role / title is required", {
          className: "!bg-red-600 !text-white !border-red-700",
        });
        return;
      }
      if (!isEdit && !personnelType) {
        toast.error("System access level is required", {
          className: "!bg-red-600 !text-white !border-red-700",
        });
        return;
      }
      const trimmedPin = pin.trim();
      if (!isEdit && !/^\d{6}$/.test(trimmedPin)) {
        toast.error("A 6-digit PIN is required for new personnel", {
          className: "!bg-red-600 !text-white !border-red-700",
        });
        return;
      }
      if (isEdit && trimmedPin && !/^\d{6}$/.test(trimmedPin)) {
        toast.error("PIN must be exactly 6 digits", {
          className: "!bg-red-600 !text-white !border-red-700",
        });
        return;
      }
      const payload = buildStaffPayload();
      console.log("[staff-form] sending mutation", payload);
      const saved =
        isEdit && staff
          ? await update.mutateAsync({ id: staff.id, payload })
          : await insert.mutateAsync(payload);
      if (trimmedPin) {
        try {
          await managerSetPersonPin({
            personKind: "staff",
            personId: saved.id,
            newPin: trimmedPin,
          });
        } catch (pinErr) {
          toast.error("Person saved, but the PIN was not set", {
            description: pinErr instanceof Error ? pinErr.message : String(pinErr),
            className: "!bg-red-600 !text-white !border-red-700",
            duration: 12_000,
          });
          onOpenChange(false);
          return;
        }
      }
      try {
        await replaceStaffDutyRoles(saved.id, dutyRoleIds);
      } catch (dutyErr) {
        console.warn("[staff-form] duty roles save skipped", dutyErr);
      }
      toast.success(isEdit ? "Personnel updated" : "Personnel added", {
        description:
          !isEdit && certTypeMissing
            ? `${payload.fullName}. A certificate still needs a Lookups name and was not saved.`
            : payload.fullName,
      });
      onOpenChange(false);
    } catch (err) {
      console.error("[staff-form] save failed", err);
      toast.error("Save failed", {
        description: (err as Error)?.message ?? String(err),
        className: "!bg-red-600 !text-white !border-red-700",
        duration: 12_000,
      });
    }
  };

  const trimmedName = fullName.trim();
  const trimmedPinLive = pin.trim();
  const pinValidLive = /^\d{6}$/.test(trimmedPinLive);
  const nameMissing = !trimmedName;
  const roleMissing = !isEdit && !role.trim();
  const personnelTypeMissing = !isEdit && !personnelType;
  const pinMissing = !isEdit && !pinValidLive;
  const pinBadFormat = isEdit && trimmedPinLive.length > 0 && !pinValidLive;
  const unresolvedCerts = certs.filter((c) => !catalogueTypeId(c, catalogue));
  const certTypeMissing = unresolvedCerts.length > 0;
  const pinIsLocked = !pinNowUnlocked && pinLockQ.data === true;
  const pinIsUnlocked = pinNowUnlocked || pinLockQ.data === false;
  const pinStatusHint = !isEdit
    ? pinMissing
      ? "Needs attention — a 6-digit PIN is required"
      : "PIN ready"
    : pinBadFormat
      ? "Needs attention — PIN must be exactly 6 digits"
      : pinLockQ.isLoading
        ? "Checking whether the PIN is locked…"
        : pinIsLocked
          ? "Needs attention — PIN is locked"
          : pinIsUnlocked
            ? "PIN is unlocked"
            : "Leave blank to keep the current PIN";
  const contactBits = [phone.trim(), email.trim(), streetAddress.trim()].filter(Boolean);
  const contactHint = contactBits.length
    ? contactBits.join(" · ")
    : "No phone, email, or home address yet";
  const dutyGapNames = dutyRoles.flatMap((d) => {
    if (!dutyRoleIds.includes(d.id)) return [];
    const reqs = catalogue.filter((t) => d.requirementIds.includes(t.id));
    const gap = evaluateRequirementHolds({ certifications: certs } as StaffMember, reqs);
    return gap.overall === "ok" ? [] : [d.name];
  });
  const dutyHint = dutyGapNames.length
    ? `Needs attention — ${dutyGapNames.join(", ")}`
    : dutyRoleIds.length === 0
      ? "None assigned"
      : `${dutyRoleIds.length} assigned`;
  const identityDirty =
    fullName.trim() !== identityBaseline.fullName ||
    role.trim() !== identityBaseline.role ||
    (personnelType || "") !== identityBaseline.personnelType;
  const contactDirty =
    phone.trim() !== contactBaseline.phone ||
    email.trim() !== contactBaseline.email ||
    streetAddress.trim() !== contactBaseline.street;
  const notesDirty = notes.trim() !== notesBaseline;
  const certDirty =
    certSignature(certs, catalogue) !==
    (certBaseline ?? certSignature(staff?.certifications ?? [], catalogue));
  const dutyDirty = savedDutyIds != null && !sameIds(dutyRoleIds, savedDutyIds);
  const certHint = certTypeMissing
    ? "Needs attention — not on the Lookups list"
    : certs.length === 0
      ? "None recorded"
      : `${certs.length} on file`;
  const certIssue = certTypeMissing
    ? `${unresolvedCerts
        .map((c) => c.name.trim() || "Untitled record")
        .join(", ")} ${unresolvedCerts.length === 1 ? "is" : "are"} not on the Lookups list. Pick a name in this section. Name, contact, and PIN can still be saved.`
    : "";
  const canAdd =
    !busy &&
    !nameMissing &&
    !roleMissing &&
    !personnelTypeMissing &&
    !pinMissing;

  const formEmail = email.trim().toLowerCase();
  const formEmailValid = formEmail.includes("@");
  const dayPasswordTooShort = dayPassword.length > 0 && dayPassword.length < 6;
  const dayPasswordMismatch =
    dayPasswordConfirm.length > 0 && dayPassword !== dayPasswordConfirm;
  const dayPasswordReady = dayPassword.length >= 6 && dayPassword === dayPasswordConfirm;
  const canSetDayPassword =
    isEdit &&
    !!staff &&
    formEmailValid &&
    dayPasswordReady &&
    !passwordBusy;

  const buildStaffPayload = (pinHash?: string | null): StaffPayload => ({
    fullName: fullName.trim(),
    role: role.trim() || null,
    personnelType: personnelType || null,
    phone: phone.trim() || null,
    email: email.trim() || null,
    streetAddress: streetAddress.trim() || null,
    active: isEdit ? (exitSnapshot ? exitSnapshot.active : (staff?.active ?? active)) : true,
    notes: notes.trim() || null,
    certifications: certs
      .map((c) => {
        const requirementTypeId = catalogueTypeId(c, catalogue);
        const type = catalogue.find((t) => t.id === requirementTypeId);
        return {
          name: (c.name.trim() || type?.name || "").trim(),
          number: c.number.trim(),
          expiry: c.expiry || null,
          deferredUntil: c.deferredUntil || null,
          requirementTypeId: requirementTypeId || null,
        };
      })
      .filter((c) => c.requirementTypeId),
    ...(pinHash !== undefined ? { pinHash } : {}),
  });

  const runSection = async (key: string, label: string, work: () => Promise<void>) => {
    if (!staff || sectionBusy) return;
    setSectionBusy(key);
    try {
      await work();
      toast.success(label, { description: fullName.trim() || staff.fullName });
    } catch (err) {
      toast.error("Save failed", {
        description: (err as Error)?.message ?? String(err),
        className: "!bg-red-600 !text-white !border-red-700",
        duration: 12_000,
      });
    } finally {
      setSectionBusy(null);
    }
  };

  const saveIdentity = () =>
    runSection("identity", "Name and access saved", async () => {
      const next = {
        fullName: fullName.trim(),
        role: role.trim(),
        personnelType: personnelType || "",
      };
      await patch.mutateAsync({
        id: staff!.id,
        patch: {
          fullName: next.fullName,
          role: next.role || null,
          personnelType: next.personnelType || null,
        },
      });
      setIdentityBaseline(next);
    });

  const saveContact = () =>
    runSection("contact", "Contact saved", async () => {
      const next = {
        phone: phone.trim(),
        email: email.trim(),
        street: streetAddress.trim(),
      };
      await patch.mutateAsync({
        id: staff!.id,
        patch: {
          phone: next.phone || null,
          email: next.email || null,
          streetAddress: next.street || null,
        },
      });
      setContactBaseline(next);
    });

  const saveNotes = () =>
    runSection("notes", "Notes saved", async () => {
      const next = notes.trim();
      await patch.mutateAsync({
        id: staff!.id,
        patch: { notes: next || null },
      });
      setNotesBaseline(next);
    });

  const saveCerts = () => {
    if (certTypeMissing || !certDirty) return;
    return runSection("certs", "Certificates saved", async () => {
      const certifications = buildStaffPayload().certifications;
      await patch.mutateAsync({
        id: staff!.id,
        patch: { certifications },
      });
      setCertBaseline(certSignature(certifications, catalogue));
    });
  };

  const savePin = () => {
    if (!pinValidLive) return;
    return runSection("pin", "PIN saved", async () => {
      await managerSetPersonPin({
        personKind: "staff",
        personId: staff!.id,
        newPin: trimmedPinLive,
      });
      setPin("");
    });
  };

  const saveDuty = () => {
    if (!dutyDirty || dutyGapNames.length > 0) return;
    return runSection("duty", "Duty roles saved", async () => {
      await replaceStaffDutyRoles(staff!.id, dutyRoleIds);
      setSavedDutyIds([...dutyRoleIds]);
    });
  };

  const applyDayPassword = async (actorPin: string) => {
    if (!staff) return;
    const profile = getActiveUserProfile();
    const actorStaffId = profile?.staffId ?? "";
    if (!actorStaffId) {
      throw new Error("Active staff profile required for manager PIN step-up.");
    }
    if (!formEmailValid) {
      throw new Error("Enter a valid email for day login before setting the password.");
    }
    setPasswordBusy(true);
    try {
      // Persist email (and current form fields) so the server reads the right address.
      const saved = (staff.email ?? "").trim().toLowerCase();
      if (formEmail !== saved) {
        await patch.mutateAsync({ id: staff.id, patch: { email: email.trim() } });
      }
      const result = await setStaffDayLoginPassword({
        targetStaffId: staff.id,
        newPassword: dayPassword,
        actorStaffId,
        actorPin,
      });
      setDayPassword("");
      setDayPasswordConfirm("");
      const bits = [
        result.createdAuthUser ? "Auth user created" : "Password updated",
        result.linkedAuthUserId ? "auth_user_id linked" : null,
      ].filter(Boolean);
      toast.success("Day-login password set", {
        description: `${result.email}${bits.length ? ` · ${bits.join(" · ")}` : ""}`,
      });
    } catch (err) {
      toast.error("Set password failed", {
        description: (err as Error)?.message ?? String(err),
        className: "!bg-red-600 !text-white !border-red-700",
        duration: 12_000,
      });
      throw err;
    } finally {
      setPasswordBusy(false);
    }
  };

  const serviceActive = exitSnapshot ? exitSnapshot.active : (staff?.active ?? active);
  const serviceReason = exitSnapshot ? exitSnapshot.exitReason : (staff?.exitReason ?? null);
  const serviceNotes = exitSnapshot ? exitSnapshot.exitNotes : (staff?.exitNotes ?? null);

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b border-border px-6 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="flex flex-wrap items-center gap-2">
                {isEdit ? "Edit personnel" : "Add personnel"}
                {isEdit && !serviceActive && (
                  <Badge variant="secondary" className="uppercase tracking-wide">
                    {serviceReason ? "Off-boarded" : "Inactive"}
                  </Badge>
                )}
              </SheetTitle>
              <SheetDescription>
                Writes directly to <code>staff_registry</code>.
              </SheetDescription>
            </div>
            {isEdit && serviceActive && (
              <Button type="button" variant="outline" onClick={() => setExitMode("offboard")}>
                Off-board
              </Button>
            )}
            {isEdit && !serviceActive && !isDeceasedExit(serviceReason) && (
              <Button type="button" variant="secondary" onClick={() => setExitMode("reactivate")}>
                Reactivate
              </Button>
            )}
          </div>
          {isEdit && !serviceActive && (
            <div className="mt-3 rounded-md bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground">
              {serviceReason ? "Off-boarded" : "Inactive"}
              {serviceReason ? ` — ${exitReasonLabel(serviceReason)}` : ""}
              {serviceNotes ? `. ${serviceNotes}` : ""}
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <section className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name" required className="sm:col-span-2">
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoFocus
                aria-invalid={nameMissing}
                className={nameMissing ? "border-destructive focus-visible:ring-destructive" : undefined}
              />
              {nameMissing && (
                <p className="text-[11px] text-destructive">Full name is required.</p>
              )}
            </Field>

            <Field label="Role / title" required={!isEdit}>
              <Input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="e.g. Registered Nurse"
                aria-invalid={roleMissing}
                className={roleMissing ? "border-destructive focus-visible:ring-destructive" : undefined}
              />
              {roleMissing && (
                <p className="text-[11px] text-destructive">Role / title is required.</p>
              )}
            </Field>

            <Field label="SYSTEM ACCESS LEVEL" required={!isEdit}>
              <Select value={personnelType} onValueChange={setPersonnelType}>
                <SelectTrigger aria-invalid={personnelTypeMissing} className={personnelTypeMissing ? "border-destructive focus-visible:ring-destructive" : undefined}>
                  <SelectValue placeholder="Select access level" />
                </SelectTrigger>
                <SelectContent>
                  {ACCESS_ROLES.map((r) => (
                    <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {personnelTypeMissing && (
                <p className="text-[11px] text-destructive">System access level is required.</p>
              )}
            </Field>
            {isEdit && carerLinks.length > 0 && (
              <Field label="Carer for" className="sm:col-span-2">
                <ul className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                  {carerLinks.map((link) => (
                    <li key={link.carerId}>
                      {link.participantName}
                      {link.relationship ? ` — ${link.relationship}` : ""}
                    </li>
                  ))}
                </ul>
              </Field>
            )}
            {!isEdit && (
              <p className="text-sm text-muted-foreground sm:col-span-2">
                New people are added as active.
              </p>
            )}
            {isEdit && (
              <div className="sm:col-span-2">
                <SectionSave
                  label="Save name & access"
                  busy={sectionBusy === "identity"}
                  disabled={nameMissing || !identityDirty || busy}
                  onClick={() => void saveIdentity()}
                />
              </div>
            )}
          </section>

          {isEdit && staff ? (
            <SupportTransportDefaults
              personKind={classifyWorkforceKind(personnelType, role)}
              staffId={staff.id}
              personName={fullName.trim() || staff.fullName}
            />
          ) : (
            <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
              Save this person first, then set their Centre run (how they get in and out).
            </p>
          )}

          <Accordion
            type="multiple"
            value={openSections}
            onValueChange={setOpenSections}
            className="space-y-3"
          >
            <SheetSection value="contact" title="Contact" hint={contactHint}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Phone">
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
                </Field>
                <Field label="Email (day login)">
                  <Input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    autoComplete="off"
                    placeholder="name@example.com"
                  />
                  <p className="text-[11px] text-muted-foreground/70">
                    Same email as the day-login password.
                  </p>
                </Field>
                <Field label="Home / street address" className="sm:col-span-2">
                  <Input value={streetAddress} onChange={(e) => setStreetAddress(e.target.value)} />
                </Field>
                {staff?.id ? (
                  <PersonAddressList owner={{ kind: "staff", id: staff.id }} />
                ) : (
                  <p className="text-[11px] text-muted-foreground sm:col-span-2">
                    Save this person first, then add other pickup places.
                  </p>
                )}
                {isEdit && (
                  <div className="sm:col-span-2">
                    <SectionSave
                      label="Save contact"
                      busy={sectionBusy === "contact"}
                      disabled={!contactDirty || busy}
                      onClick={() => void saveContact()}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Other pickup places save on their own. This does not check certificates.
                    </p>
                  </div>
                )}
              </div>
            </SheetSection>

            <SheetSection
              value="pin"
              title="PIN Reset"
              hint={pinStatusHint}
              hintAlert={pinMissing || pinBadFormat || pinIsLocked}
            >
              <Field
                label={isEdit ? "6-digit PIN (leave blank to keep current)" : "6-digit PIN"}
                required={!isEdit}
              >
                <PinPad
                  value={pin}
                  onChange={(v) => setPin(v.replace(/\D/g, "").slice(0, 6))}
                  length={6}
                  showConfirmKey
                  confirmLabel="Use this PIN"
                  onComplete={(v) => setPin(v)}
                />
                {pinMissing && (
                  <p className="text-[11px] text-destructive">A 6-digit PIN is required for new personnel.</p>
                )}
                {pinBadFormat && (
                  <p className="text-[11px] text-destructive">PIN must be exactly 6 digits.</p>
                )}
                <p className="text-[11px] text-muted-foreground/70">
                  Sign-in and action PIN. Stored on the server. Not 123456 or a straight run.
                </p>
                {isEdit && staff && (
                  <p
                    className={cn(
                      "text-sm font-medium",
                      pinIsLocked ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {pinLockQ.isLoading
                      ? "Checking whether the PIN is locked…"
                      : pinIsLocked
                        ? "PIN is locked."
                        : pinIsUnlocked
                          ? "PIN is unlocked."
                          : "Lock status could not be read."}
                  </p>
                )}
                {isEdit && staff && (pinIsLocked || pinLockQ.isError) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={unlockBusy}
                    onClick={() => {
                      setUnlockBusy(true);
                      void managerUnlockPersonPin({ personKind: "staff", personId: staff.id })
                        .then(() => {
                          setPinNowUnlocked(true);
                          toast.success("PIN is unlocked", { description: staff.fullName });
                        })
                        .catch((err: unknown) =>
                          toast.error("Could not unlock PIN", {
                            description: err instanceof Error ? err.message : String(err),
                          }),
                        )
                        .finally(() => setUnlockBusy(false));
                    }}
                  >
                    {unlockBusy ? "Unlocking…" : "Unlock PIN"}
                  </Button>
                )}
              </Field>
              {isEdit && (
                <SectionSave
                  label="Reset PIN"
                  busy={sectionBusy === "pin"}
                  disabled={!pinValidLive || busy}
                  issue={
                    pinBadFormat
                      ? "PIN must be exactly 6 digits before it can be saved. Leave it blank to keep the current PIN."
                      : undefined
                  }
                  onClick={() => void savePin()}
                />
              )}
            </SheetSection>

          {dutyRoles.length > 0 && (
            <SheetSection
              value="duty"
              title="Duty roles"
              hint={dutyHint}
              hintAlert={dutyGapNames.length > 0}
            >
              <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground">
                Jobs this person can be asked to do. Separate from System access.
                Requirements still have to be on file under Certificates.
              </p>
              <div className="space-y-2">
                {dutyRoles.map((d) => {
                  const checked = dutyRoleIds.includes(d.id);
                  const reqs = catalogue.filter((t) => d.requirementIds.includes(t.id));
                  const gap = evaluateRequirementHolds(
                    { certifications: certs } as StaffMember,
                    reqs,
                  );
                  const gapText =
                    gap.overall === "ok"
                      ? "Requirements current"
                      : gap.missingNames.length
                        ? `Missing ${gap.missingNames.join(", ")}`
                        : `Expired ${gap.expiredNames.join(", ")}`;
                  return (
                    <label
                      key={d.id}
                      className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <Checkbox
                        className="mt-0.5"
                        checked={checked}
                        onCheckedChange={(v) => {
                          setDutyRoleIds((prev) =>
                            v ? [...prev, d.id] : prev.filter((id) => id !== d.id),
                          );
                        }}
                      />
                      <span className="min-w-0">
                        <span className="font-medium">{d.name}</span>
                        <span
                          className={cn(
                            "mt-0.5 block text-[11px]",
                            gap.overall === "ok"
                              ? "text-muted-foreground"
                              : "text-destructive",
                          )}
                        >
                          {gapText}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {isEdit && (
                <SectionSave
                  label="Save duty roles"
                  busy={sectionBusy === "duty"}
                  disabled={!dutyDirty || dutyGapNames.length > 0 || busy}
                  issue={
                    dutyGapNames.length
                      ? `${dutyGapNames.join(", ")} ${dutyGapNames.length === 1 ? "needs" : "need"} the required certificate before this can be saved. None assigned is fine.`
                      : undefined
                  }
                  onClick={() => void saveDuty()}
                />
              )}
              </div>
            </SheetSection>
          )}

            <SheetSection
              value="certs"
              title="Certificates & orientations"
              hint={certHint}
              hintAlert={certTypeMissing}
            >
            <div className="space-y-2">
            <div className="flex items-center justify-end">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={activeCatalogue.length === 0}
                onClick={() => {
                  setEditingCert(certs.length);
                  setCerts((p) => [...p, { ...EMPTY_CERT }]);
                  setOpenSections((prev) => (prev.includes("certs") ? prev : [...prev, "certs"]));
                }}
                className="h-7 gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                Add record
              </Button>
            </div>
            {activeCatalogue.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Add official names in Admin → Lookups → Certificates &amp; orientations
                first.
              </p>
            )}
            {certs.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                No certificates or orientations recorded.
              </p>
            ) : (
              <div className="space-y-2">
                {certs.map((c, i) => {
                  const isEditing = editingCert === i;
                  return (
                  <div
                    key={i}
                    className="space-y-3 rounded-md border border-border bg-card/40 p-3"
                  >
                    {!isEditing ? (
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <p className="truncate text-sm font-semibold">
                            {c.name.trim() || "Untitled certification"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {c.number.trim() ? `# ${c.number.trim()}` : "No certification number"}
                            {" · "}
                            {c.expiry
                              ? `Expires ${formatDate(c.expiry)}`
                              : "No expiry"}
                            {c.deferredUntil
                              ? ` · Deferred until ${formatDate(c.deferredUntil)}`
                              : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1.5"
                            onClick={() => setEditingCert(i)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <IconActionButton
                            type="button"
                            onClick={() => {
                              setCerts((p) => p.filter((_, idx) => idx !== i));
                              setEditingCert((cur) =>
                                cur === i ? null : cur != null && cur > i ? cur - 1 : cur,
                              );
                            }}
                            tooltip="Remove certification"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </IconActionButton>
                        </div>
                      </div>
                    ) : (
                    <>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="grid gap-1">
                        <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Certificate / orientation
                        </Label>
                        <Select
                          value={catalogueTypeId(c, catalogue)}
                          onValueChange={(id) => {
                            const type = catalogue.find((t) => t.id === id);
                            updateCert(i, {
                              requirementTypeId: id,
                              name: type?.name ?? c.name,
                            });
                          }}
                        >
                          <SelectTrigger
                            className={requiredFieldOutline(
                              !catalogueTypeId(c, catalogue),
                              "h-9",
                            )}
                            autoFocus
                          >
                            <SelectValue placeholder="Pick from Lookups list" />
                          </SelectTrigger>
                          <SelectContent>
                            {catalogue
                              .filter(
                                (t) => t.active || t.id === catalogueTypeId(c, catalogue),
                              )
                              .map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                  {t.name} ({t.kind})
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Certification #
                        </Label>
                        <Input
                          placeholder="Optional reference number"
                          value={c.number}
                          onChange={(e) => updateCert(i, { number: e.target.value })}
                          className="h-9"
                        />
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="grid gap-1">
                        <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Renewal / Expiry Date
                        </Label>
                        <DatePicker
                          value={parseIsoDateLocal(c.expiry ?? "")}
                          onChange={(d) =>
                            updateCert(i, { expiry: d ? toIsoDateString(d) : null })
                          }
                          dateFormat="dd-MMM-yy"
                          className="h-9 text-sm"
                        />
                        <p className="text-[11px] text-muted-foreground/70">
                          Optional. Leave blank if this certification never expires.
                        </p>
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Defer Until (Manager)
                        </Label>
                        <DatePicker
                          value={parseIsoDateLocal(c.deferredUntil ?? "")}
                          onChange={(d) =>
                            updateCert(i, {
                              deferredUntil: d ? toIsoDateString(d) : null,
                            })
                          }
                          dateFormat="dd-MMM-yy"
                          className="h-9 text-sm"
                        />
                        <p className="text-[11px] text-muted-foreground/70">
                          Hides this cert from the Red/Critical dashboard list until this date.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingCert(null)}
                      >
                        Done
                      </Button>
                      <IconActionButton
                        type="button"
                        onClick={() => {
                          setCerts((p) => p.filter((_, idx) => idx !== i));
                          setEditingCert(null);
                        }}
                        tooltip="Remove certification"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </IconActionButton>
                    </div>
                    </>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
            {certs.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Use Edit to correct a name or number, then Save certificates in this section.
              </p>
            )}
            {certIssue ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {certIssue}
                {!isEdit
                  ? " Add personnel will leave it unsaved until this is fixed."
                  : ""}
              </p>
            ) : null}
            {isEdit && (
              <SectionSave
                label="Save certificates"
                busy={sectionBusy === "certs"}
                disabled={!certDirty || certTypeMissing || busy}
                onClick={() => void saveCerts()}
              />
            )}
            </div>
            </SheetSection>

            <SheetSection
              value="notes"
              title="Notes"
              hint={notes.trim() ? "Notes on file" : "None"}
            >
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
              {isEdit && (
                <SectionSave
                  label="Save notes"
                  busy={sectionBusy === "notes"}
                  disabled={!notesDirty || busy}
                  onClick={() => void saveNotes()}
                />
              )}
            </SheetSection>

          {isEdit && staff && (personnelType === "manager" || personnelType === "assistant_manager") && (
            <SheetSection
              value="password"
              title="Reset password"
              hint="Only when this person needs a new day-login password"
            >
            <div className="space-y-3">
              <p className="text-[11px] text-muted-foreground">
                Leave this closed when you are only changing the name or other details.
                Drivers, volunteers, and carers do not use a password.
              </p>
              {!formEmailValid && (
                <p className="text-[11px] text-destructive">
                  Add an email under Contact first. That is the day-login address.
                </p>
              )}
              <Field label="New password">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={dayPassword}
                  onChange={(e) => setDayPassword(e.target.value)}
                  aria-invalid={dayPasswordTooShort}
                  className={requiredFieldOutline(dayPasswordTooShort)}
                />
                {dayPasswordTooShort && (
                  <p className="text-[11px] text-destructive">
                    Password must be at least 6 characters.
                  </p>
                )}
              </Field>
              <Field label="Confirm password">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={dayPasswordConfirm}
                  onChange={(e) => setDayPasswordConfirm(e.target.value)}
                  aria-invalid={dayPasswordMismatch}
                  className={requiredFieldOutline(dayPasswordMismatch)}
                />
                {dayPasswordMismatch && (
                  <p className="text-[11px] text-destructive">Passwords do not match.</p>
                )}
              </Field>
              <Button
                type="button"
                variant="secondary"
                disabled={!canSetDayPassword}
                className="gap-1.5"
                onClick={() => setPasswordPinOpen(true)}
              >
                <KeyRound className="h-4 w-4" />
                {passwordBusy ? "Setting…" : "Set day-login password"}
              </Button>
            </div>
            </SheetSection>
          )}
          </Accordion>

          {isEdit && staff ? (
            <OnboardingSubjectPanel
              subjectTable="staff_registry"
              subjectId={staff.id}
              defaultPack={
                /volunteer/i.test(staff.personnelType ?? staff.role ?? "")
                  ? "volunteer"
                  : "staff"
              }
              seedName={fullName.trim() || staff.fullName}
            />
          ) : null}
        </div>

        <SheetFooter className="flex-col-reverse gap-2 border-t border-border px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {!isEdit && (
          <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
            {!canAdd && !busy && (
              <p className="text-[11px] text-destructive">
                {[
                  nameMissing && "Full name",
                  roleMissing && "Role / title",
                  personnelTypeMissing && "System access level",
                  pinMissing && "6-digit PIN",
                ]
                  .filter(Boolean)
                  .join(", ")}
                {" "}is required.
              </p>
            )}
            {certTypeMissing && (
              <p className="text-[11px] text-destructive">
                Certificates still need a Lookups name. Add personnel will leave that section unsaved.
              </p>
            )}
            <Button onClick={save} disabled={!canAdd} className="gap-1.5">
              <Save className="h-4 w-4" />
              {busy ? "Saving…" : "Add personnel"}
            </Button>
          </div>
          )}
        </SheetFooter>

        <PinEntryDialog
          open={passwordPinOpen}
          onOpenChange={setPasswordPinOpen}
          title="Authorise password set"
          description="Manager PIN required to set this person's day-login password."
          length={6}
          busy={passwordBusy}
          onVerify={async (actorPin) => {
            const staffId = getActiveUserProfile()?.staffId;
            if (!staffId) {
              throw new Error("Active staff profile required for PIN step-up.");
            }
            await verifyManagerPin(staffId, actorPin);
            await applyDayPassword(actorPin);
          }}
          onSuccess={() => {
            setPasswordPinOpen(false);
          }}
        />

      </SheetContent>
    </Sheet>
    {staff && exitMode && (
      <ServiceExitDialog
        open
        onOpenChange={(next) => {
          if (!next) setExitMode(null);
        }}
        mode={exitMode}
        subject="staff"
        personId={staff.id}
        displayName={staff.fullName}
        onCompleted={(result) => {
          setExitSnapshot({
            active: result.mode !== "offboard",
            exitReason: result.mode === "offboard" ? result.reason : null,
            exitNotes: result.mode === "offboard" ? result.notes || null : null,
            exitedAt: result.exitedAt,
          });
          setActive(result.mode !== "offboard");
        }}
      />
    )}
    </>
  );
}

function SectionSave({
  label,
  busy,
  disabled,
  issue,
  onClick,
}: {
  label: string;
  busy: boolean;
  disabled?: boolean;
  issue?: string;
  onClick: () => void;
}) {
  return (
    <div className="space-y-2 pt-2">
      {issue ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {issue}
        </p>
      ) : null}
      <Button type="button" size="sm" disabled={disabled || busy} onClick={onClick} className="gap-1.5">
        <Save className="h-4 w-4" />
        {busy ? "Saving…" : label}
      </Button>
    </div>
  );
}

function SheetSection({
  value,
  title,
  hint,
  hintAlert,
  children,
}: {
  value: string;
  title: string;
  hint: string;
  hintAlert?: boolean;
  children: ReactNode;
}) {
  return (
    <AccordionItem value={value} className="rounded-lg border border-border bg-muted/20">
      <AccordionTrigger className="px-3 py-3 hover:no-underline">
        <div className="min-w-0 text-left">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </div>
          <p
            className={cn(
              "mt-0.5 truncate text-[11px] font-normal",
              hintAlert ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {hint}
          </p>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-3 pb-3">{children}</AccordionContent>
    </AccordionItem>
  );
}

function Field({
  label,
  children,
  className,
  required,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={`grid gap-1.5 ${className ?? ""}`}>
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}

