import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { HalfHourTimeField } from "@/components/ui/half-hour-time-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import { parseIsoDateLocal, toIsoDateString, cn } from "@/lib/utils";
import {
  ATTENDANCE_DAY_OPTIONS,
  type ClientFormPayload,
  type TransportMode,
} from "@/lib/onboarding/form-types";
import { CLIENT_CONSENT_BLOCKS } from "@/lib/onboarding/consent-copy";
import { getDobDatePickerProps } from "@/components/ui/date-picker";

interface Props {
  value: ClientFormPayload;
  onChange: (next: ClientFormPayload) => void;
}

const TRANSPORTS: { value: TransportMode; label: string }[] = [
  { value: "bus", label: "YADA bus / run" },
  { value: "self", label: "Self / family" },
  { value: "carer", label: "Carer" },
  { value: "other", label: "Other" },
];

export function ClientOnboardingForm({ value, onChange }: Props) {
  const set = <K extends keyof ClientFormPayload>(key: K, v: ClientFormPayload[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Funding & identity</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Funding type *</Label>
            <Select
              value={value.fundingType || undefined}
              onValueChange={(v) =>
                set("fundingType", v as ClientFormPayload["fundingType"])
              }
            >
              <SelectTrigger className={requiredFieldOutline(!value.fundingType)}>
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ndis">NDIS</SelectItem>
                <SelectItem value="fee_for_service">Fee for service</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>NDIS number {value.fundingType === "ndis" ? "*" : ""}</Label>
            <Input
              value={value.ndisNumber}
              onChange={(e) => set("ndisNumber", e.target.value)}
              className={requiredFieldOutline(
                value.fundingType === "ndis" && !value.ndisNumber.trim(),
              )}
            />
          </div>
          <div className="space-y-1.5">
            <Label>First name *</Label>
            <Input
              value={value.firstName}
              onChange={(e) => set("firstName", e.target.value)}
              className={requiredFieldOutline(!value.firstName.trim())}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Surname *</Label>
            <Input
              value={value.lastName}
              onChange={(e) => set("lastName", e.target.value)}
              className={requiredFieldOutline(!value.lastName.trim())}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Preferred name</Label>
            <Input
              value={value.preferredName}
              onChange={(e) => set("preferredName", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Date of birth *</Label>
            <DatePicker
              value={parseIsoDateLocal(value.dateOfBirth)}
              onChange={(d) => set("dateOfBirth", d ? toIsoDateString(d) : "")}
              {...getDobDatePickerProps()}
              className={cn(
                "h-10 w-full",
                requiredFieldOutline(!value.dateOfBirth.trim()),
              )}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Gender</Label>
            <Input
              value={value.gender}
              onChange={(e) => set("gender", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input
              value={value.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
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
          <div className="space-y-1.5">
            <Label>Suburb</Label>
            <Input
              value={value.suburb}
              onChange={(e) => set("suburb", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Postcode</Label>
            <Input
              value={value.postcode}
              onChange={(e) => set("postcode", e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Regular pickup address</Label>
            <Input
              value={value.regularPickupAddress}
              onChange={(e) => set("regularPickupAddress", e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Emergency contacts</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Primary name *</Label>
            <Input
              value={value.emergencyName}
              onChange={(e) => set("emergencyName", e.target.value)}
              className={requiredFieldOutline(!value.emergencyName.trim())}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Phone *</Label>
            <Input
              value={value.emergencyPhone}
              onChange={(e) => set("emergencyPhone", e.target.value)}
              className={requiredFieldOutline(!value.emergencyPhone.trim())}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Relationship</Label>
            <Input
              value={value.emergencyRelationship}
              onChange={(e) => set("emergencyRelationship", e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Secondary name</Label>
            <Input
              value={value.emergencySecondaryName}
              onChange={(e) => set("emergencySecondaryName", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input
              value={value.emergencySecondaryPhone}
              onChange={(e) => set("emergencySecondaryPhone", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Relationship</Label>
            <Input
              value={value.emergencySecondaryRelationship}
              onChange={(e) =>
                set("emergencySecondaryRelationship", e.target.value)
              }
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => {
            const g = value.guardians[i];
            return (
              <div key={i} className="space-y-2 rounded-md border p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Parent / guardian / representative {i + 1}
                </p>
                <Input
                  placeholder="Name"
                  value={g.name}
                  onChange={(e) => {
                    const guardians = [...value.guardians] as ClientFormPayload["guardians"];
                    guardians[i] = { ...g, name: e.target.value };
                    set("guardians", guardians);
                  }}
                />
                <Input
                  placeholder="Phone"
                  value={g.phone}
                  onChange={(e) => {
                    const guardians = [...value.guardians] as ClientFormPayload["guardians"];
                    guardians[i] = { ...g, phone: e.target.value };
                    set("guardians", guardians);
                  }}
                />
                <Input
                  placeholder="Relationship"
                  value={g.relationship}
                  onChange={(e) => {
                    const guardians = [...value.guardians] as ClientFormPayload["guardians"];
                    guardians[i] = { ...g, relationship: e.target.value };
                    set("guardians", guardians);
                  }}
                />
                <Input
                  placeholder="Email"
                  value={g.email}
                  onChange={(e) => {
                    const guardians = [...value.guardians] as ClientFormPayload["guardians"];
                    guardians[i] = { ...g, email: e.target.value };
                    set("guardians", guardians);
                  }}
                />
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Clinical & care</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Disability / diagnosis</Label>
            <Input
              value={value.disability}
              onChange={(e) => set("disability", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>GP name</Label>
            <Input
              value={value.gpName}
              onChange={(e) => set("gpName", e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Medications</Label>
            <Textarea
              value={value.medicationsText}
              onChange={(e) => set("medicationsText", e.target.value)}
              rows={2}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Food or medical allergies *</Label>
            <Textarea
              value={value.allergiesText}
              onChange={(e) => set("allergiesText", e.target.value)}
              rows={2}
              placeholder='List allergies, or type "None"'
              className={requiredFieldOutline(!value.allergiesText.trim())}
            />
          </div>
          <div className="space-y-1.5">
            <Label>IDDSI liquids</Label>
            <Select
              value={String(value.iddsiLiquids)}
              onValueChange={(v) => set("iddsiLiquids", Number(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[0, 1, 2, 3, 4].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>IDDSI solids</Label>
            <Select
              value={String(value.iddsiSolids)}
              onValueChange={(v) => set("iddsiSolids", Number(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[3, 4, 5, 6, 7].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label className="mb-2 block">Assistance with self-care</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ["bathe", "Bathe/shower"],
                ["dress", "Dress"],
                ["eat", "Eat"],
                ["grooming", "Grooming"],
                ["bed", "Bed transfer"],
                ["toilet", "Toilet"],
                ["walking", "Walking"],
                ["footcare", "Footcare"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={value.selfCare[key]}
                  onCheckedChange={(c) =>
                    set("selfCare", { ...value.selfCare, [key]: !!c })
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Attendance days & transport *</h3>
        <div className="space-y-3">
          {ATTENDANCE_DAY_OPTIONS.map((day) => {
            const row =
              value.attendance.find((a) => a.dayCode === day.code) ?? {
                dayCode: day.code,
                enabled: false,
                inbound: "bus" as TransportMode,
                outbound: "bus" as TransportMode,
                expectedArrival: "09:00",
                expectedDeparture: "15:00",
              };
            return (
              <div
                key={day.code}
                className="rounded-md border p-3 space-y-2"
              >
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={row.enabled}
                    onCheckedChange={(c) => {
                      const attendance = value.attendance.map((a) =>
                        a.dayCode === day.code
                          ? { ...a, enabled: !!c }
                          : a,
                      );
                      if (!attendance.some((a) => a.dayCode === day.code)) {
                        attendance.push({ ...row, enabled: !!c });
                      }
                      set("attendance", attendance);
                    }}
                  />
                  {day.label}
                </label>
                {row.enabled ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Inbound</Label>
                      <Select
                        value={row.inbound}
                        onValueChange={(v) =>
                          set(
                            "attendance",
                            value.attendance.map((a) =>
                              a.dayCode === day.code
                                ? { ...a, inbound: v as TransportMode }
                                : a,
                            ),
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TRANSPORTS.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Outbound</Label>
                      <Select
                        value={row.outbound}
                        onValueChange={(v) =>
                          set(
                            "attendance",
                            value.attendance.map((a) =>
                              a.dayCode === day.code
                                ? { ...a, outbound: v as TransportMode }
                                : a,
                            ),
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TRANSPORTS.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Expected arrival</Label>
                      <HalfHourTimeField
                        value={row.expectedArrival}
                        onChange={(t) =>
                          set(
                            "attendance",
                            value.attendance.map((a) =>
                              a.dayCode === day.code
                                ? { ...a, expectedArrival: t }
                                : a,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Expected departure</Label>
                      <HalfHourTimeField
                        value={row.expectedDeparture}
                        onChange={(t) =>
                          set(
                            "attendance",
                            value.attendance.map((a) =>
                              a.dayCode === day.code
                                ? { ...a, expectedDeparture: t }
                                : a,
                            ),
                          )
                        }
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Consents (office confirms before print)</h3>
        {CLIENT_CONSENT_BLOCKS.map((b) => {
          const key = b.key as keyof ClientFormPayload["consents"];
          if (key === "photoScope") return null;
          const checked = Boolean(value.consents[key]);
          return (
            <label
              key={b.key}
              className="flex gap-3 rounded-md border p-3 text-sm"
            >
              <Checkbox
                checked={checked}
                onCheckedChange={(c) =>
                  set("consents", { ...value.consents, [key]: !!c })
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
      </section>
    </div>
  );
}
