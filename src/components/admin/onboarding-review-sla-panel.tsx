import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardList, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  canManageSystemParameters,
  updateSystemParameter,
} from "@/lib/api/system-parameters";
import {
  SYSTEM_PARAMETERS_QUERY_KEY,
  useOnboardingReviewParams,
} from "@/hooks/use-system-parameters";
import { getActiveUserProfile } from "@/lib/data-store";
import {
  DEFAULT_ONBOARDING_REVIEW_RED_DAYS,
  DEFAULT_ONBOARDING_REVIEW_YELLOW_DAYS,
  ONBOARDING_REVIEW_RED_DAYS_KEY,
  ONBOARDING_REVIEW_YELLOW_DAYS_KEY,
} from "@/lib/onboarding/review-urgency";

function isManagerRole(staffRole: string | null | undefined): boolean {
  return (staffRole ?? "").toLowerCase().includes("manager");
}

export const ONBOARDING_REVIEW_PARAM_KEYS = [
  ONBOARDING_REVIEW_YELLOW_DAYS_KEY,
  ONBOARDING_REVIEW_RED_DAYS_KEY,
];

/**
 * Yellow/red windows for Hub Onboarding Review due + Dashboard Band 3 tile.
 */
export function OnboardingReviewSlaPanel() {
  const qc = useQueryClient();
  const profile = useMemo(() => getActiveUserProfile(), []);
  const permissionQ = useQuery({
    queryKey: ["system-parameters", "can-manage", profile?.staffId ?? "auth-user"],
    queryFn: () => canManageSystemParameters(profile?.staffId),
    staleTime: 60_000,
  });
  const canEdit = isManagerRole(profile?.staffRole) || permissionQ.data === true;
  const saved = useOnboardingReviewParams();
  const [yellow, setYellow] = useState(String(saved.yellowDays));
  const [red, setRed] = useState(String(saved.redDays));
  const [justification, setJustification] = useState("");

  useEffect(() => setYellow(String(saved.yellowDays)), [saved.yellowDays]);
  useEffect(() => setRed(String(saved.redDays)), [saved.redDays]);

  const save = useMutation({
    mutationFn: async () => {
      const y = Number(yellow);
      const r = Number(red);
      if (!Number.isFinite(y) || y < 1 || y > 365) {
        throw new Error("Yellow days must be between 1 and 365.");
      }
      if (!Number.isFinite(r) || r < 0 || r > 365) {
        throw new Error("Red days must be between 0 and 365 (0 = red on the due date).");
      }
      if (r > y) {
        throw new Error("Red days cannot be larger than yellow days.");
      }
      const reason =
        justification.trim().length >= 10
          ? justification.trim()
          : "Updated onboarding review yellow/red windows from Admin.";
      const updates: Array<{ key: string; value: number }> = [];
      if (y !== saved.yellowDays) {
        updates.push({ key: ONBOARDING_REVIEW_YELLOW_DAYS_KEY, value: y });
      }
      if (r !== saved.redDays) {
        updates.push({ key: ONBOARDING_REVIEW_RED_DAYS_KEY, value: r });
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
      qc.invalidateQueries({ queryKey: ["onboarding-cases"] });
      setJustification("");
      toast.success(count === 0 ? "No changes to save" : "Onboarding review windows saved");
    },
    onError: (e: Error) =>
      toast.error("Could not save onboarding review windows", {
        description: e.message,
      }),
  });

  const dirty =
    Number(yellow) !== saved.yellowDays || Number(red) !== saved.redDays;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-semibold">
            <ClipboardList className="h-4 w-4 text-primary" />
            Onboarding review windows
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Dashboard Band 3 <strong>Onboarding review</strong> and Hub → Onboarding
            Review due. Yellow = days before due. Red = days remaining at which
            the tile goes red (0 = red on the due date). Default{" "}
            {DEFAULT_ONBOARDING_REVIEW_YELLOW_DAYS} /{" "}
            {DEFAULT_ONBOARDING_REVIEW_RED_DAYS}.
          </p>
        </div>
        {!canEdit && <Badge variant="secondary">Read-only · Managers can edit</Badge>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="onboarding-yellow">Yellow days before due</Label>
          <Input
            id="onboarding-yellow"
            type="number"
            min={1}
            max={365}
            value={yellow}
            onChange={(e) => setYellow(e.target.value)}
            disabled={!canEdit}
            className="h-11"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="onboarding-red">Red days (0 = on due date)</Label>
          <Input
            id="onboarding-red"
            type="number"
            min={0}
            max={365}
            value={red}
            onChange={(e) => setRed(e.target.value)}
            disabled={!canEdit}
            className="h-11"
          />
        </div>
      </div>

      {canEdit && dirty && (
        <div className="space-y-1.5">
          <Label htmlFor="onboarding-sla-reason" className="text-xs">
            Change reason (optional — auto-filled if left blank)
          </Label>
          <Input
            id="onboarding-sla-reason"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="e.g. Tighten yellow window to 21 days"
          />
        </div>
      )}

      {canEdit && (
        <Button
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          className="gap-1.5"
        >
          <Save className="h-4 w-4" />
          {save.isPending ? "Saving…" : "Save review windows"}
        </Button>
      )}
    </div>
  );
}
