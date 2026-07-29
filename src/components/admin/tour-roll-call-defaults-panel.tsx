import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { HalfHourTimeField } from "@/components/ui/half-hour-time-field";
import {
  canManageSystemParameters,
  updateSystemParameter,
} from "@/lib/api/system-parameters";
import {
  SYSTEM_PARAMETERS_QUERY_KEY,
  useDefaultEveningRollCallTime,
  useDefaultMorningRollCallTime,
  useSystemParameter,
} from "@/hooks/use-system-parameters";
import { getActiveUserProfile } from "@/lib/data-store";
import { isValidClockTime } from "@/lib/tour-roll-call";

function isManagerRole(staffRole: string | null | undefined): boolean {
  return (staffRole ?? "").toLowerCase().includes("manager");
}

/**
 * Default evening + morning roll call times and alert thresholds for multi-day tours.
 * Seeded onto new trip days at creation (§12.5).
 */
export function TourRollCallDefaultsPanel() {
  const qc = useQueryClient();
  const profile = useMemo(() => getActiveUserProfile(), []);
  const permissionQ = useQuery({
    queryKey: ["system-parameters", "can-manage", profile?.staffId ?? "auth-user"],
    queryFn: () => canManageSystemParameters(profile?.staffId),
    staleTime: 60_000,
  });
  const canEdit = isManagerRole(profile?.staffRole) || permissionQ.data === true;

  const savedEvening = useDefaultEveningRollCallTime();
  const savedMorning = useDefaultMorningRollCallTime();
  const savedEveGreen = useSystemParameter<number>("event_curfew_yellow_mins_before", 0);
  const savedEveRed = useSystemParameter<number>("event_curfew_red_mins_after", 30);
  const savedMornGreen = useSystemParameter<number>("event_morning_yellow_mins_before", 0);
  const savedMornRed = useSystemParameter<number>("event_morning_red_mins_after", 30);
  const savedMaxDefer = useSystemParameter<number>("event_roll_max_defer_minutes", 120);

  const [eveningTime, setEveningTime] = useState(savedEvening);
  const [morningTime, setMorningTime] = useState(savedMorning);
  const [eveGreen, setEveGreen] = useState(String(savedEveGreen));
  const [eveRed, setEveRed] = useState(String(savedEveRed));
  const [mornGreen, setMornGreen] = useState(String(savedMornGreen));
  const [mornRed, setMornRed] = useState(String(savedMornRed));
  const [maxDefer, setMaxDefer] = useState(String(savedMaxDefer));
  const [justification, setJustification] = useState("");

  useEffect(() => setEveningTime(savedEvening), [savedEvening]);
  useEffect(() => setMorningTime(savedMorning), [savedMorning]);
  useEffect(() => setEveGreen(String(savedEveGreen)), [savedEveGreen]);
  useEffect(() => setEveRed(String(savedEveRed)), [savedEveRed]);
  useEffect(() => setMornGreen(String(savedMornGreen)), [savedMornGreen]);
  useEffect(() => setMornRed(String(savedMornRed)), [savedMornRed]);
  useEffect(() => setMaxDefer(String(savedMaxDefer)), [savedMaxDefer]);

  const save = useMutation({
    mutationFn: async () => {
      if (!isValidClockTime(eveningTime) || !isValidClockTime(morningTime)) {
        throw new Error("Enter valid 24-hour times (HH:mm) for both roll calls.");
      }
      const nums = {
        eveGreen: Number(eveGreen),
        eveRed: Number(eveRed),
        mornGreen: Number(mornGreen),
        mornRed: Number(mornRed),
        maxDefer: Number(maxDefer),
      };
      for (const [k, v] of Object.entries(nums)) {
        if (!Number.isFinite(v) || v < 0 || v > 24 * 60) {
          throw new Error(`Invalid minutes for ${k} — use 0–1440.`);
        }
      }
      if (nums.eveRed < 1 || nums.mornRed < 1) {
        throw new Error("Red threshold must be at least 1 minute after the deadline.");
      }
      if (nums.maxDefer < 15) {
        throw new Error("Max deferral must be at least 15 minutes.");
      }

      const reason =
        justification.trim().length >= 10
          ? justification.trim()
          : "Updated tour roll call defaults / alert thresholds from Admin.";

      const updates: Array<{ key: string; value: string | number }> = [];
      if (eveningTime.trim() !== savedEvening.trim()) {
        updates.push({ key: "default_evening_roll_call_time", value: eveningTime.trim() });
      }
      if (morningTime.trim() !== savedMorning.trim()) {
        updates.push({ key: "default_morning_roll_call_time", value: morningTime.trim() });
      }
      if (nums.eveGreen !== savedEveGreen) {
        updates.push({ key: "event_curfew_yellow_mins_before", value: nums.eveGreen });
      }
      if (nums.eveRed !== savedEveRed) {
        updates.push({ key: "event_curfew_red_mins_after", value: nums.eveRed });
      }
      if (nums.mornGreen !== savedMornGreen) {
        updates.push({ key: "event_morning_yellow_mins_before", value: nums.mornGreen });
      }
      if (nums.mornRed !== savedMornRed) {
        updates.push({ key: "event_morning_red_mins_after", value: nums.mornRed });
      }
      if (nums.maxDefer !== savedMaxDefer) {
        updates.push({ key: "event_roll_max_defer_minutes", value: nums.maxDefer });
      }

      for (const u of updates) {
        await updateSystemParameter({
          key: u.key,
          newValue: u.value,
          justification: reason,
        });
      }
      return updates.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: SYSTEM_PARAMETERS_QUERY_KEY });
      setJustification("");
      toast.success(
        count === 0 ? "No changes to save" : "Tour roll call settings saved",
        {
          description:
            count === 0
              ? "Values match what is already saved."
              : "Times apply to new trip days; alert thresholds apply immediately on Event Deliver.",
        },
      );
    },
    onError: (e: Error) =>
      toast.error("Could not save roll call settings", { description: e.message }),
  });

  const dirty =
    eveningTime.trim() !== savedEvening.trim() ||
    morningTime.trim() !== savedMorning.trim() ||
    Number(eveGreen) !== savedEveGreen ||
    Number(eveRed) !== savedEveRed ||
    Number(mornGreen) !== savedMornGreen ||
    Number(mornRed) !== savedMornRed ||
    Number(maxDefer) !== savedMaxDefer;
  const valid = isValidClockTime(eveningTime) && isValidClockTime(morningTime);

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-semibold">
            <Clock className="h-4 w-4 text-primary" />
            Multi-day tour roll calls
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Default <strong>Evening</strong> and <strong>Morning</strong> times (24-hour), plus
            Event Deliver alert bands: Green approaching / at deadline → Yellow overdue → Red + SMS
            (once per person). SMS does not repeat on an interval.
          </p>
        </div>
        {!canEdit && <Badge variant="secondary">Read-only · Managers can edit</Badge>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Default evening roll call</Label>
          <HalfHourTimeField
            id="default-evening-roll"
            value={eveningTime}
            onChange={setEveningTime}
            disabled={!canEdit}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Default morning roll call</Label>
          <HalfHourTimeField
            id="default-morning-roll"
            value={morningTime}
            onChange={setMorningTime}
            disabled={!canEdit}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background/60 p-3 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Alert thresholds (minutes)
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="eve-green">Evening — Green before deadline</Label>
            <Input
              id="eve-green"
              type="number"
              min={0}
              max={1440}
              value={eveGreen}
              onChange={(e) => setEveGreen(e.target.value)}
              disabled={!canEdit}
            />
            <p className="text-[11px] text-muted-foreground">0 = Green only at the deadline minute</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eve-red">Evening — Red after deadline</Label>
            <Input
              id="eve-red"
              type="number"
              min={1}
              max={1440}
              value={eveRed}
              onChange={(e) => setEveRed(e.target.value)}
              disabled={!canEdit}
            />
            <p className="text-[11px] text-muted-foreground">Default 30 · SMS once at Red</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="morn-green">Morning — Green before deadline</Label>
            <Input
              id="morn-green"
              type="number"
              min={0}
              max={1440}
              value={mornGreen}
              onChange={(e) => setMornGreen(e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="morn-red">Morning — Red after deadline</Label>
            <Input
              id="morn-red"
              type="number"
              min={1}
              max={1440}
              value={mornRed}
              onChange={(e) => setMornRed(e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="max-defer">Max deferral (Yellow or Red)</Label>
            <Input
              id="max-defer"
              type="number"
              min={15}
              max={1440}
              value={maxDefer}
              onChange={(e) => setMaxDefer(e.target.value)}
              disabled={!canEdit}
            />
            <p className="text-[11px] text-muted-foreground">
              Caps how far a leader/manager can push the roll deadline (default 120).
            </p>
          </div>
        </div>
      </div>

      {canEdit && dirty && (
        <div className="space-y-1.5">
          <Label htmlFor="roll-call-justification" className="text-xs">
            Change reason (optional — auto-filled if left blank)
          </Label>
          <Input
            id="roll-call-justification"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="e.g. Evening Red tightened to 20 minutes for overnight tours"
          />
        </div>
      )}

      {canEdit && (
        <Button
          onClick={() => save.mutate()}
          disabled={!dirty || !valid || save.isPending}
          className="gap-1.5"
        >
          <Save className="h-4 w-4" />
          {save.isPending ? "Saving…" : "Save roll call settings"}
        </Button>
      )}
    </div>
  );
}
