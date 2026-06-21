import { useEffect, useState } from "react";
import { Plus, Trash2, Save } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  useInsertStaffMember,
  useUpdateStaffMember,
} from "@/hooks/use-supabase-data";
import { hashPin } from "@/lib/data-store";
import type { StaffMember, StaffCertification, StaffPayload } from "@/lib/data-store";
import { ACCESS_ROLES } from "@/lib/access-roles";




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

  const insert = useInsertStaffMember();
  const update = useUpdateStaffMember();
  const busy = insert.isPending || update.isPending;

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
      const payload: StaffPayload = {
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
      };
      if (trimmedPin) {
        console.log("[staff-form] hashing PIN");
        payload.pinHash = await hashPin(trimmedPin);
        console.log("[staff-form] PIN hashed OK");
      }
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
  const pinMissing = !isEdit && !pinValidLive;
  const pinBadFormat = isEdit && trimmedPinLive.length > 0 && !pinValidLive;
  const canSave = !busy && !nameMissing && !pinMissing && !pinBadFormat;

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

            <Field label="Role / title">
              <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Registered Nurse" />
            </Field>

            <Field label="SYSTEM ACCESS LEVEL">
              <Select value={personnelType} onValueChange={setPersonnelType}>
                <SelectTrigger><SelectValue placeholder="Select personnel type" /></SelectTrigger>
                <SelectContent>
                  {ACCESS_ROLES.map((r) => (
                    <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Phone">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
            </Field>
            <Field label="Email">
              <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
            </Field>
            <Field label="Street address" className="sm:col-span-2">
              <Input value={streetAddress} onChange={(e) => setStreetAddress(e.target.value)} />
            </Field>
            <Field
              label={isEdit ? "4-digit PIN (leave blank to keep current)" : "4-digit PIN"}
              required={!isEdit}
              className="sm:col-span-2"
            >
              <Input
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                placeholder="••••"
                autoComplete="off"
                required={!isEdit}
                aria-invalid={pinMissing || pinBadFormat}
                className={
                  pinMissing || pinBadFormat
                    ? "border-destructive focus-visible:ring-destructive"
                    : undefined
                }
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
                  <div key={i} className="grid gap-2 rounded-md border border-border bg-card/40 p-3 sm:grid-cols-[1fr_1fr_180px_180px_auto]">
                    <Input
                      placeholder="Certificate name"
                      value={c.name}
                      onChange={(e) => updateCert(i, { name: e.target.value })}
                    />
                    <Input
                      placeholder="Certification #"
                      value={c.number}
                      onChange={(e) => updateCert(i, { number: e.target.value })}
                    />
                    <div className="grid gap-1">
                      <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Renewal / Expiry Date
                      </Label>
                      <Input
                        type="date"
                        value={c.expiry ?? ""}
                        onChange={(e) => updateCert(i, { expiry: e.target.value || null })}
                      />
                      <p className="text-[11px] text-muted-foreground/70">
                        Optional. Leave blank if this certification never expires.
                      </p>
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Defer Until (Manager)
                      </Label>
                      <Input
                        type="date"
                        value={c.deferredUntil ?? ""}
                        onChange={(e) => updateCert(i, { deferredUntil: e.target.value || null })}
                      />
                      <p className="text-[11px] text-muted-foreground/70">
                        Hides this cert from the Red/Critical dashboard list until this date.
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => setCerts((p) => p.filter((_, idx) => idx !== i))}
                      aria-label="Remove certification"
                      className="self-start"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </Field>
        </div>

        <SheetFooter className="border-t border-border px-6 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy} className="gap-1.5">
            <Save className="h-4 w-4" />
            {busy ? "Saving…" : isEdit ? "Save changes" : "Add personnel"}
          </Button>
        </SheetFooter>
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

