import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import { cn, parseIsoDateLocal, toIsoDateString } from "@/lib/utils";
import type { AccompanyingFormPayload } from "@/lib/onboarding/form-types";
import { ACCOMPANYING_DECLARATION_BLOCKS } from "@/lib/onboarding/consent-copy";
import type { Participant } from "@/lib/data-store";

interface Props {
  value: AccompanyingFormPayload;
  onChange: (next: AccompanyingFormPayload) => void;
  participants: Participant[];
}

export function AccompanyingOnboardingForm({
  value,
  onChange,
  participants,
}: Props) {
  const set = <K extends keyof AccompanyingFormPayload>(
    key: K,
    v: AccompanyingFormPayload[K],
  ) => onChange({ ...value, [key]: v });

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Support person</h3>
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
            <Label>Relationship to client *</Label>
            <Input
              value={value.relationship}
              onChange={(e) => set("relationship", e.target.value)}
              className={requiredFieldOutline(!value.relationship.trim())}
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
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Input
              value={value.streetAddress}
              onChange={(e) => set("streetAddress", e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Linked client *</h3>
        <Select
          value={value.linkedParticipantId || undefined}
          onValueChange={(id) => {
            const p = participants.find((x) => x.id === id);
            onChange({
              ...value,
              linkedParticipantId: id,
              linkedParticipantName: p?.fullName ?? "",
            });
          }}
        >
          <SelectTrigger
            className={requiredFieldOutline(!value.linkedParticipantId.trim())}
          >
            <SelectValue placeholder="Select client…" />
          </SelectTrigger>
          <SelectContent>
            {participants.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value.accompanyCentre}
              onCheckedChange={(c) => set("accompanyCentre", !!c)}
            />
            Accompanies at day centre
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value.accompanyTrips}
              onCheckedChange={(c) => set("accompanyTrips", !!c)}
            />
            Accompanies on trips
          </label>
        </div>
        <div className="space-y-1.5">
          <Label>Days / notes</Label>
          <Textarea
            value={value.daysNotes}
            onChange={(e) => set("daysNotes", e.target.value)}
            rows={2}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Screening</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>WWCC number (if required)</Label>
            <Input
              value={value.wwccNumber}
              onChange={(e) => set("wwccNumber", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>WWCC expiry</Label>
            <DatePicker
              value={parseIsoDateLocal(value.wwccExpiry)}
              onChange={(d) => set("wwccExpiry", d ? toIsoDateString(d) : "")}
              className={cn("h-10 w-full")}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value.photoConsent}
            onCheckedChange={(c) => set("photoConsent", !!c)}
          />
          Photo consent when appearing in group photos with the client
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Own emergency contact name</Label>
            <Input
              value={value.ownEmergencyName}
              onChange={(e) => set("ownEmergencyName", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Own emergency phone</Label>
            <Input
              value={value.ownEmergencyPhone}
              onChange={(e) => set("ownEmergencyPhone", e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Declarations *</h3>
        {ACCOMPANYING_DECLARATION_BLOCKS.map((b) => {
          const key = b.key as
            | "acknowledgeBoundaries"
            | "followStaffDirection"
            | "reportIncidents";
          return (
            <label
              key={b.key}
              className="flex gap-3 rounded-md border p-3 text-sm"
            >
              <Checkbox
                checked={value[key]}
                onCheckedChange={(c) => set(key, !!c)}
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
