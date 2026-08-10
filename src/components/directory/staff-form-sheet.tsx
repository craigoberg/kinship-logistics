import { useEffect, useState } from "react";
import { KeyRound, Plus, Trash2, Save } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { IconActionButton } from "@/components/ui/icon-action-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { OnboardingSubjectPanel } from "@/components/onboarding/onboarding-subject-panel";
import { cn, parseIsoDateLocal, toIsoDateString } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PinPad } from "@/components/auth/pin-pad";
import { PinEntryDialog } from "@/components/auth/pin-entry-dialog";
import { verifyManagerPin } from "@/components/auth/pin-verify";
import {
  useInsertStaffMember,
  useUpdateStaffMember,
} from "@/hooks/use-supabase-data";
import { setStaffDayLoginPassword } from "@/lib/api/staff-auth";
import { getActiveUserProfile, hashPin } from "@/lib/data-store";
import type { StaffMember, StaffCertification, StaffPayload } from "@/lib/data-store";
import { ACCESS_ROLES } from "@/lib/access-roles";
import { requiredFieldOutline } from "@/lib/ui/required-field";




interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staff: StaffMember | null;
}

const EMPTY_CERT: StaffCertification = { name: "", number: "", expiry: null, deferredUntil: null };

export function StaffFormSheet({ open, onOpenChange, staff }: Props) {
  const isEdit = !!staff;
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("");
  const [personnelType, setPersonnelType] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [streetAddress, setStreetAddress] = useState("");
  const [active, setActive] = useState(true);
  const [notes, setNotes] = useState("");
  const [pin, setPin] = useState("");
  const [certs, setCerts] = useState<StaffCertification[]>([]);
  const [dayPassword, setDayPassword] = useState("");
  const [dayPasswordConfirm, setDayPasswordConfirm] = useState("");
  const [passwordPinOpen, setPasswordPinOpen] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);

  const insert = useInsertStaffMember();
  const update = useUpdateStaffMember();
  const busy = insert.isPending || update.isPending || passwordBusy;

  useEffect(() => {
    if (!open) return;
    setFullName(staff?.fullName ?? "");
    setRole(staff?.role ?? "");
    setPersonnelType(staff?.personnelType ?? "");
    setPhone(staff?.phone ?? "");
    setEmail(staff?.email ?? "");
    setStreetAddress(staff?.streetAddress ?? "");
    setActive(staff?.active ?? true);
    setNotes(staff?.notes ?? "");
    setPin("");
    setCerts(staff?.certifications ?? []);
    setDayPassword("");
    setDayPasswordConfirm("");
    setPasswordPinOpen(false);
  }, [open, staff]);

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
      if (!isEdit && !/^\d{4}$/.test(trimmedPin)) {
        toast.error("A 4-digit PIN is required for new personnel", {
          className: "!bg-red-600 !text-white !border-red-700",
        });
        return;
      }
      if (isEdit && trimmedPin && !/^\d{4}$/.test(trimmedPin)) {
        toast.error("PIN must be exactly 4 digits", {
          className: "!bg-red-600 !text-white !border-red-700",
        });
        return;
      }
      let pinHash: string | null | undefined;
      if (trimmedPin) {
        console.log("[staff-form] hashing PIN");
        pinHash = await hashPin(trimmedPin);
        console.log("[staff-form] PIN hashed OK");
      }
      const payload = buildStaffPayload(pinHash);
      console.log("[staff-form] sending mutation", payload);
      if (isEdit && staff) {
        await update.mutateAsync({ id: staff.id, payload });
        toast.success("Personnel updated", { description: payload.fullName });
      } else {
        await insert.mutateAsync(payload);
        toast.success("Personnel added", { description: payload.fullName });
      }
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
  const pinValidLive = /^\d{4}$/.test(trimmedPinLive);
  const nameMissing = !trimmedName;
  const roleMissing = !isEdit && !role.trim();
  const personnelTypeMissing = !isEdit && !personnelType;
  const pinMissing = !isEdit && !pinValidLive;
  const pinBadFormat = isEdit && trimmedPinLive.length > 0 && !pinValidLive;
  const canSave = !busy && !nameMissing && !roleMissing && !personnelTypeMissing && !pinMissing && !pinBadFormat;

  const formEmail = email.trim().toLowerCase();
  const formEmailValid = formEmail.includes("@");
  const dayPasswordTooShort = dayPassword.length > 0 && dayPassword.length < 6;
  const dayPasswordMismatch =
    dayPasswordConfirm.length > 0 && dayPassword !== dayPasswordConfirm;
  const dayPasswordMissing = !dayPassword;
  const dayPasswordConfirmMissing = !dayPasswordConfirm;
  const canSetDayPassword =
    isEdit &&
    !!staff &&
    formEmailValid &&
    !dayPasswordMissing &&
    !dayPasswordConfirmMissing &&
    !dayPasswordTooShort &&
    !dayPasswordMismatch &&
    !passwordBusy;

  const buildStaffPayload = (pinHash?: string | null): StaffPayload => ({
    fullName: fullName.trim(),
    role: role.trim() || null,
    personnelType: personnelType || null,
    phone: phone.trim() || null,
    email: email.trim() || null,
    streetAddress: streetAddress.trim() || null,
    active,
    notes: notes.trim() || null,
    certifications: certs
      .filter((c) => c.name.trim() || c.number.trim() || c.expiry)
      .map((c) => ({
        name: c.name.trim(),
        number: c.number.trim(),
        expiry: c.expiry || null,
      })),
    ...(pinHash !== undefined ? { pinHash } : {}),
  });

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
      if (formEmail !== saved || email.trim() !== (staff.email ?? "").trim()) {
        await update.mutateAsync({ id: staff.id, payload: buildStaffPayload() });
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

  return (

    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{isEdit ? "Edit personnel" : "Add personnel"}</SheetTitle>
          <SheetDescription>
            Writes directly to <code>staff_registry</code>.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {isEdit && staff ? (
            <OnboardingSubjectPanel
              subjectTable="staff_registry"
              subjectId={staff.id}
              defaultPack={
                /volunteer/i.test(staff.personnelType ?? staff.role ?? "")
                  ? "volunteer"
                  : "staff"
              }
              seedName={staff.fullName}
            />
          ) : null}
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
                Same email as Supabase Auth day login. Also editable in the password section below.
              </p>
            </Field>
            <Field label="Street address" className="sm:col-span-2">
              <Input value={streetAddress} onChange={(e) => setStreetAddress(e.target.value)} />
            </Field>
            <Field
              label={isEdit ? "4-digit PIN (leave blank to keep current)" : "4-digit PIN"}
              required={!isEdit}
              className="sm:col-span-2"
            >
              <PinPad
                value={pin}
                onChange={(v) => setPin(v.replace(/\D/g, "").slice(0, 4))}
                length={4}
                showConfirmKey
                onComplete={(v) => setPin(v)}
              />
              {pinMissing && (
                <p className="text-[11px] text-destructive">A 4-digit PIN is required for new personnel.</p>
              )}
              {pinBadFormat && (
                <p className="text-[11px] text-destructive">PIN must be exactly 4 digits.</p>
              )}
              <p className="text-[11px] text-muted-foreground/70">
                Used for medication witness, handshake, and terminal sign-in. Hashed before storage.
              </p>
            </Field>

            <Field label="Active" className="sm:col-span-2">
              <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                <Switch checked={active} onCheckedChange={setActive} />
                <span className="text-sm text-muted-foreground">
                  {active ? "Currently active and rostered" : "Inactive / archived"}
                </span>
              </div>
            </Field>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Certifications
              </Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setCerts((p) => [...p, { ...EMPTY_CERT }])}
                className="h-7 gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                Add certification
              </Button>
            </div>
            {certs.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                No certifications recorded.
              </p>
            ) : (
              <div className="space-y-2">
                {certs.map((c, i) => (
                  <div
                    key={i}
                    className="space-y-3 rounded-md border border-border bg-card/40 p-3"
                  >
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="grid gap-1">
                        <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Certificate name
                        </Label>
                        <Input
                          placeholder="e.g. First Aid / CPR"
                          value={c.name}
                          onChange={(e) => updateCert(i, { name: e.target.value })}
                          className="h-9"
                        />
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
                    <div className="flex justify-end">
                      <IconActionButton
                        type="button"
                        onClick={() => setCerts((p) => p.filter((_, idx) => idx !== i))}
                        tooltip="Remove certification"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </IconActionButton>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </Field>

          {isEdit && staff && (
            <section className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Day-login password (Supabase Auth)
                </Label>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Email + password for morning day login — separate from the 4-digit PIN. Setting
                  the password also saves the email on this record if you just typed it. Interim
                  Alpha control — RBAC will revisit later.
                </p>
              </div>
              <Field label="Email for day login" required>
                <Input
                  type="email"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  aria-invalid={!formEmailValid}
                  className={requiredFieldOutline(!formEmailValid)}
                />
                {!formEmailValid && (
                  <p className="text-[11px] text-destructive">
                    Enter the email this person will use at day login.
                  </p>
                )}
              </Field>
              <Field label="New password" required>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={dayPassword}
                  onChange={(e) => setDayPassword(e.target.value)}
                  aria-invalid={dayPasswordMissing || dayPasswordTooShort}
                  className={requiredFieldOutline(
                    dayPasswordMissing || dayPasswordTooShort,
                  )}
                />
                {(dayPasswordMissing || dayPasswordTooShort) && (
                  <p className="text-[11px] text-destructive">
                    {dayPasswordMissing
                      ? "Password is required."
                      : "Password must be at least 6 characters."}
                  </p>
                )}
              </Field>
              <Field label="Confirm password" required>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={dayPasswordConfirm}
                  onChange={(e) => setDayPasswordConfirm(e.target.value)}
                  aria-invalid={dayPasswordConfirmMissing || dayPasswordMismatch}
                  className={requiredFieldOutline(
                    dayPasswordConfirmMissing || dayPasswordMismatch,
                  )}
                />
                {(dayPasswordConfirmMissing || dayPasswordMismatch) && (
                  <p className="text-[11px] text-destructive">
                    {dayPasswordConfirmMissing
                      ? "Confirm password is required."
                      : "Passwords do not match."}
                  </p>
                )}
              </Field>
              {!canSetDayPassword && !passwordBusy && (
                <p className={cn("text-[11px] text-destructive")}>
                  {[
                    !formEmailValid && "Email for day login",
                    dayPasswordMissing && "New password",
                    dayPasswordConfirmMissing && "Confirm password",
                    dayPasswordTooShort && "Password min 6 characters",
                    dayPasswordMismatch && "Passwords must match",
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </p>
              )}
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
            </section>
          )}
        </div>

        <SheetFooter className="flex-col-reverse gap-2 border-t border-border px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
            {!canSave && !busy && (
              <p className="text-[11px] text-destructive">
                {[
                  nameMissing && "Full name",
                  roleMissing && "Role / title",
                  personnelTypeMissing && "System access level",
                  pinMissing && "4-digit PIN",
                  pinBadFormat && "PIN must be exactly 4 digits",
                ]
                  .filter(Boolean)
                  .join(", ")}
                {" "}is required.
              </p>
            )}
            <Button onClick={save} disabled={!canSave} className="gap-1.5">
              <Save className="h-4 w-4" />
              {busy ? "Saving…" : isEdit ? "Save changes" : "Add personnel"}
            </Button>
          </div>
        </SheetFooter>

        <PinEntryDialog
          open={passwordPinOpen}
          onOpenChange={setPasswordPinOpen}
          title="Authorise password set"
          description="Manager PIN required to set this person's day-login password."
          length={4}
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

