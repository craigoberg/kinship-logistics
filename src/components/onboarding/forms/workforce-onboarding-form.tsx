import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker, getDobDatePickerProps } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ACCESS_ROLES } from "@/lib/access-roles";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import { cn, parseIsoDateLocal, toIsoDateString } from "@/lib/utils";
import type {
  StaffFormPayload,
  VolunteerFormPayload,
} from "@/lib/onboarding/form-types";
import {
  STAFF_DECLARATION_BLOCKS,
  VOLUNTEER_EXTRA_BLOCKS,
} from "@/lib/onboarding/consent-copy";

type WorkforcePayload = StaffFormPayload | VolunteerFormPayload;

interface Props {
  value: WorkforcePayload;
  onChange: (next: WorkforcePayload) => void;
}

export function WorkforceOnboardingForm({ value, onChange }: Props) {
  const set = <K extends keyof WorkforcePayload>(
    key: K,
    v: WorkforcePayload[K],
  ) => onChange({ ...value, [key]: v } as WorkforcePayload);

  const isStaff = value.pack === "staff";

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Identity</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Full name *</Label>
            <Input
              value={value.fullName}
              onChange={(e) => set("fullName", e.target.value)}
              className={requiredFieldOutline(!value.fullName.trim())}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Date of birth</Label>
            <DatePicker
              value={parseIsoDateLocal(value.dateOfBirth)}
              onChange={(d) => set("dateOfBirth", d ? toIsoDateString(d) : "")}
              {...getDobDatePickerProps()}
              className="h-10 w-full"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Phone *</Label>
            <Input
              value={value.phone}
              onChange={(e) => set("phone", e.target.value)}
              className={requiredFieldOutline(!value.phone.trim())}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input
              value={value.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Street address</Label>
            <Input
              value={value.streetAddress}
              onChange={(e) => set("streetAddress", e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">
          {isStaff ? "Role & access" : "Volunteer engagement"}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {isStaff ? (
            <>
              <div className="space-y-1.5">
                <Label>Job title *</Label>
                <Input
                  value={(value as StaffFormPayload).jobTitle}
                  onChange={(e) =>
                    onChange({
                      ...(value as StaffFormPayload),
                      jobTitle: e.target.value,
                    })
                  }
                  className={requiredFieldOutline(
                    !(value as StaffFormPayload).jobTitle.trim(),
                  )}
                />
              </div>
              <div className="space-y-1.5">
                <Label>System access level *</Label>
                <Select
                  value={(value as StaffFormPayload).systemAccess}
                  onValueChange={(v) =>
                    onChange({
                      ...(value as StaffFormPayload),
                      systemAccess: v,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCESS_ROLES.map((r) => (
                      <SelectItem key={r.key} value={r.key}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Role description *</Label>
                <Input
                  value={(value as VolunteerFormPayload).roleDescription}
                  onChange={(e) =>
                    onChange({
                      ...(value as VolunteerFormPayload),
                      roleDescription: e.target.value,
                    })
                  }
                  className={requiredFieldOutline(
                    !(value as VolunteerFormPayload).roleDescription.trim(),
                  )}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Days / hours available</Label>
                <Input
                  value={(value as VolunteerFormPayload).daysAvailable}
                  onChange={(e) =>
                    onChange({
                      ...(value as VolunteerFormPayload),
                      daysAvailable: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Supervisor</Label>
                <Input
                  value={(value as VolunteerFormPayload).supervisorName}
                  onChange={(e) =>
                    onChange({
                      ...(value as VolunteerFormPayload),
                      supervisorName: e.target.value,
                    })
                  }
                />
              </div>
            </>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Emergency contact</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            placeholder="Name"
            value={value.emergencyName}
            onChange={(e) => set("emergencyName", e.target.value)}
          />
          <Input
            placeholder="Phone"
            value={value.emergencyPhone}
            onChange={(e) => set("emergencyPhone", e.target.value)}
          />
          <Input
            placeholder="Relationship"
            value={value.emergencyRelationship}
            onChange={(e) => set("emergencyRelationship", e.target.value)}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Screening & certifications</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>WWCC number *</Label>
            <Input
              value={value.wwccNumber}
              onChange={(e) => set("wwccNumber", e.target.value)}
              className={requiredFieldOutline(!value.wwccNumber.trim())}
            />
          </div>
          <div className="space-y-1.5">
            <Label>WWCC expiry *</Label>
            <DatePicker
              value={parseIsoDateLocal(value.wwccExpiry)}
              onChange={(d) => set("wwccExpiry", d ? toIsoDateString(d) : "")}
              className={cn(
                "h-10 w-full",
                requiredFieldOutline(!value.wwccExpiry.trim()),
              )}
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              NDIS Worker Screening number {isStaff ? "*" : "(if required)"}
            </Label>
            <Input
              value={value.ndisScreeningNumber}
              onChange={(e) => set("ndisScreeningNumber", e.target.value)}
              className={requiredFieldOutline(
                isStaff && !value.ndisScreeningNumber.trim(),
              )}
            />
          </div>
          <div className="space-y-1.5">
            <Label>NDIS screening expiry</Label>
            <DatePicker
              value={parseIsoDateLocal(value.ndisScreeningExpiry)}
              onChange={(d) =>
                set("ndisScreeningExpiry", d ? toIsoDateString(d) : "")
              }
              className="h-10 w-full"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value.idSighted}
            onCheckedChange={(c) => set("idSighted", !!c)}
          />
          100-point / identity documents sighted (copies filed with pack)
        </label>
        <div className="space-y-2">
          {value.certs.map((c, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-3">
              <Input
                value={c.name}
                onChange={(e) => {
                  const certs = [...value.certs];
                  certs[i] = { ...c, name: e.target.value };
                  set("certs", certs);
                }}
                placeholder="Cert name"
              />
              <Input
                value={c.number}
                onChange={(e) => {
                  const certs = [...value.certs];
                  certs[i] = { ...c, number: e.target.value };
                  set("certs", certs);
                }}
                placeholder="Number"
              />
              <DatePicker
                value={parseIsoDateLocal(c.expiry)}
                onChange={(d) => {
                  const certs = [...value.certs];
                  certs[i] = { ...c, expiry: d ? toIsoDateString(d) : "" };
                  set("certs", certs);
                }}
                className="h-10 w-full"
                placeholder="Expiry"
              />
            </div>
          ))}
        </div>
        {isStaff ? (
          <div className="space-y-2 rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={(value as StaffFormPayload).drives}
                onCheckedChange={(c) =>
                  onChange({
                    ...(value as StaffFormPayload),
                    drives: !!c,
                  })
                }
              />
              Drives for YADA / Driver access
            </label>
            {(value as StaffFormPayload).drives ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  placeholder="Licence class"
                  value={(value as StaffFormPayload).licenceClass}
                  onChange={(e) =>
                    onChange({
                      ...(value as StaffFormPayload),
                      licenceClass: e.target.value,
                    })
                  }
                />
                <Input
                  placeholder="Licence number"
                  value={(value as StaffFormPayload).licenceNumber}
                  onChange={(e) =>
                    onChange({
                      ...(value as StaffFormPayload),
                      licenceNumber: e.target.value,
                    })
                  }
                />
                <DatePicker
                  value={parseIsoDateLocal(
                    (value as StaffFormPayload).licenceExpiry,
                  )}
                  onChange={(d) =>
                    onChange({
                      ...(value as StaffFormPayload),
                      licenceExpiry: d ? toIsoDateString(d) : "",
                    })
                  }
                  className="h-10 w-full"
                  placeholder="Licence expiry"
                />
                <Input
                  placeholder="Restrictions"
                  value={(value as StaffFormPayload).licenceRestrictions}
                  onChange={(e) =>
                    onChange({
                      ...(value as StaffFormPayload),
                      licenceRestrictions: e.target.value,
                    })
                  }
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Declarations</h3>
        {STAFF_DECLARATION_BLOCKS.map((b) => {
          const key = b.key as keyof typeof value.declarations;
          return (
            <label key={b.key} className="flex gap-3 rounded-md border p-3 text-sm">
              <Checkbox
                checked={Boolean(value.declarations[key])}
                onCheckedChange={(c) =>
                  set("declarations", {
                    ...value.declarations,
                    [key]: !!c,
                  })
                }
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{b.title}</span>
                <span className="mt-1 block text-muted-foreground">{b.body}</span>
              </span>
            </label>
          );
        })}
        {!isStaff
          ? VOLUNTEER_EXTRA_BLOCKS.map((b) => {
              const key = b.key as "boundaries" | "photoSelf";
              return (
                <label
                  key={b.key}
                  className="flex gap-3 rounded-md border p-3 text-sm"
                >
                  <Checkbox
                    checked={Boolean(value.declarations[key])}
                    onCheckedChange={(c) =>
                      set("declarations", {
                        ...value.declarations,
                        [key]: !!c,
                      })
                    }
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">{b.title}</span>
                    <span className="mt-1 block text-muted-foreground">
                      {b.body}
                    </span>
                  </span>
                </label>
              );
            })
          : null}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Induction checklist</h3>
        {(
          [
            ["siteTour", "Site tour completed"],
            ["emergencyProcedures", "Emergency procedures explained"],
            ["medicationPolicy", "Medication policy awareness"],
            ["incidentReporting", "Incident reporting explained"],
            ["pinSetupNoted", "PIN / day-login setup noted (Staff directory)"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value.induction[key]}
              onCheckedChange={(c) =>
                set("induction", { ...value.induction, [key]: !!c })
              }
            />
            {label}
          </label>
        ))}
      </section>
    </div>
  );
}
