/**
 * Office: add staff / volunteer / carer to a Day Centre bus run (weekly plan).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MobileFieldButton, MobileOptionButton } from "@/components/manifest/mobile-field-button";
import { CharacterCountedInput } from "@/components/ui/character-counted-input";
import { HalfHourTimeField } from "@/components/ui/half-hour-time-field";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import {
  listStaffRegistry,
  listCarersRegistry,
  LOOKUP_CATEGORIES,
} from "@/lib/data-store";
import { useLookupParameters } from "@/hooks/use-supabase-data";
import { SUPPORT_SCHEDULES_KEY, upsertSupportSchedule } from "@/lib/api/support-attendance";
import { RUN_PLANNING_PEOPLE_KEY } from "@/lib/api/run-planning";
import { busRunRouteQueryKey, type BusRunRouteDirection } from "@/lib/api/bus-run-routes";
import { classifyWorkforceKind, type SupportPersonKind } from "@/lib/support-person";
import { cn } from "@/lib/utils";

const DAYS = [
  ["DAY-MON", "Mon"],
  ["DAY-TUE", "Tue"],
  ["DAY-WED", "Wed"],
  ["DAY-THU", "Thu"],
  ["DAY-FRI", "Fri"],
] as const;

interface Props {
  open: boolean;
  onClose: () => void;
  busRunCode: string;
  direction: BusRunRouteDirection;
}

export function AddSupportToRunDialog({ open, onClose, busRunCode, direction }: Props) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<SupportPersonKind>("staff");
  const [personId, setPersonId] = useState("");
  const [days, setDays] = useState<string[]>(["DAY-TUE", "DAY-THU"]);
  const [otherDirection, setOtherDirection] = useState<"bus" | "self">("bus");
  const [otherRun, setOtherRun] = useState("");
  const [address, setAddress] = useState("");
  const [arrive, setArrive] = useState("09:00");
  const [depart, setDepart] = useState("15:00");

  const staffQ = useQuery({
    queryKey: ["staff-registry-support"],
    queryFn: listStaffRegistry,
    enabled: open,
    staleTime: 60_000,
  });
  const carerQ = useQuery({
    queryKey: ["carers-registry-support"],
    queryFn: listCarersRegistry,
    enabled: open,
    staleTime: 60_000,
  });
  const { data: busRuns = [] } = useLookupParameters(LOOKUP_CATEGORIES.busRun);

  const people = useMemo(() => {
    if (kind === "carer") {
      return (carerQ.data ?? []).map((c) => ({
        id: c.id,
        name: c.fullName,
        subtitle: c.streetAddress ?? c.relationship ?? "",
      }));
    }
    return (staffQ.data ?? [])
      .filter((s) => s.active)
      .filter((s) => {
        const wk = classifyWorkforceKind(s.personnelType, s.role);
        return kind === "volunteer" ? wk === "volunteer" : wk === "staff";
      })
      .map((s) => ({
        id: s.id,
        name: s.fullName,
        subtitle: s.streetAddress ?? s.role ?? "",
      }));
  }, [kind, staffQ.data, carerQ.data]);

  const missing: string[] = [];
  if (!personId) missing.push("Person");
  if (days.length === 0) missing.push("At least one day");
  const otherCode = otherDirection === "self" ? "TRN-SELF" : otherRun || busRuns[0]?.code || busRunCode;
  if (otherDirection === "bus" && !otherCode) missing.push("Other-direction run");

  const inbound = direction === "morning" ? busRunCode : otherCode;
  const outbound = direction === "afternoon" ? busRunCode : otherCode;

  const save = useMutation({
    mutationFn: async () => {
      for (const day of days) {
        await upsertSupportSchedule({
          personKind: kind,
          staffId: kind === "carer" ? null : personId,
          carerId: kind === "carer" ? personId : null,
          dayOfWeek: day,
          inboundTransport: inbound,
          outboundTransport: outbound,
          expectedArrivalTime: arrive,
          expectedDepartureTime: depart,
          pickupAddressOverride: address,
        });
      }
    },
    onSuccess: () => {
      toast.success("Support person added to the run");
      void qc.invalidateQueries({ queryKey: busRunRouteQueryKey(busRunCode, direction) });
      void qc.invalidateQueries({ queryKey: SUPPORT_SCHEDULES_KEY });
      void qc.invalidateQueries({ queryKey: RUN_PLANNING_PEOPLE_KEY });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add support person</DialogTitle>
          <DialogDescription>
            Staff, volunteers and carers get their own pickup and drop-off, same as a client.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {(["staff", "volunteer", "carer"] as const).map((k) => (
              <MobileOptionButton
                key={k}
                label={k === "carer" ? "Carer" : k === "volunteer" ? "Volunteer" : "Staff"}
                selected={kind === k}
                onClick={() => {
                  setKind(k);
                  setPersonId("");
                }}
              />
            ))}
          </div>

          <div>
            <Label className="mb-2 block">Who</Label>
            <div className={cn("max-h-48 space-y-1 overflow-y-auto rounded-md p-1", requiredFieldOutline(!personId))}>
              {people.map((p) => (
                <MobileFieldButton
                  key={p.id}
                  title={p.name}
                  subtitle={p.subtitle || undefined}
                  active={personId === p.id}
                  onClick={() => setPersonId(p.id)}
                />
              ))}
              {people.length === 0 && (
                <p className="px-2 py-3 text-sm text-muted-foreground">No people in this list yet.</p>
              )}
            </div>
          </div>

          <div>
            <Label className="mb-2 block">Days</Label>
            <div className={cn("flex flex-wrap gap-2", requiredFieldOutline(days.length === 0))}>
              {DAYS.map(([code, label]) => (
                <button
                  key={code}
                  type="button"
                  onClick={() =>
                    setDays((prev) =>
                      prev.includes(code) ? prev.filter((d) => d !== code) : [...prev, code],
                    )
                  }
                  className={cn(
                    "rounded-full border-2 px-3 py-1 text-xs font-semibold",
                    days.includes(code)
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="mb-2 block">
              {direction === "morning" ? "Afternoon home" : "Morning inbound"}
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <MobileOptionButton
                label="Same / bus"
                selected={otherDirection === "bus"}
                onClick={() => setOtherDirection("bus")}
              />
              <MobileOptionButton
                label="Self"
                selected={otherDirection === "self"}
                onClick={() => setOtherDirection("self")}
              />
            </div>
            {otherDirection === "bus" && (
              <div className="mt-2 space-y-1">
                {busRuns.map((r) => (
                  <MobileFieldButton
                    key={r.code}
                    title={r.displayName}
                    active={(otherRun || busRunCode) === r.code}
                    onClick={() => setOtherRun(r.code)}
                  />
                ))}
              </div>
            )}
          </div>

          <div>
            <Label className="mb-1 block">Expected arrival</Label>
            <HalfHourTimeField value={arrive} onChange={setArrive} />
          </div>
          <div>
            <Label className="mb-1 block">Expected departure</Label>
            <HalfHourTimeField value={depart} onChange={setDepart} />
          </div>
          <CharacterCountedInput
            label="Pickup address (optional)"
            value={address}
            onValueChange={setAddress}
            required={false}
            minChars={0}
            maxChars={160}
          />

          {missing.length > 0 && (
            <p className="text-sm text-destructive">Need: {missing.join(", ")}</p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            type="button"
            disabled={missing.length > 0 || save.isPending}
            onClick={() => save.mutate()}
          >
            Add to run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
