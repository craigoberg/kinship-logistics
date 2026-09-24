import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock, Save } from "lucide-react";
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
  useSystemParameter,
} from "@/hooks/use-system-parameters";
import { getActiveUserProfile } from "@/lib/data-store";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import {
  AUTH_IDLE_LOCK_MINUTES_KEY,
  DEFAULT_AUTH_IDLE_LOCK_MINUTES,
  MAX_AUTH_IDLE_LOCK_MINUTES,
  MIN_AUTH_IDLE_LOCK_MINUTES,
  clampIdleLockMinutes,
} from "@/lib/auth/idle-lock";

export const IDLE_LOCK_PARAM_KEYS = [AUTH_IDLE_LOCK_MINUTES_KEY] as const;

function isManagerRole(staffRole: string | null | undefined): boolean {
  return (staffRole ?? "").toLowerCase().includes("manager");
}

function parseMinutes(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < MIN_AUTH_IDLE_LOCK_MINUTES || n > MAX_AUTH_IDLE_LOCK_MINUTES) return null;
  return n;
}

/**
 * Admin → System Parameters — idle PIN lock after last tap/key.
 */
export function IdleLockAdminPanel() {
  const qc = useQueryClient();
  const profile = useMemo(() => getActiveUserProfile(), []);
  const permissionQ = useQuery({
    queryKey: ["system-parameters", "can-manage", profile?.staffId ?? "auth-user"],
    queryFn: () => canManageSystemParameters(profile?.staffId),
    staleTime: 60_000,
  });
  const canEdit = isManagerRole(profile?.staffRole) || permissionQ.data === true;
  const saved = clampIdleLockMinutes(
    useSystemParameter<number>(
      AUTH_IDLE_LOCK_MINUTES_KEY,
      DEFAULT_AUTH_IDLE_LOCK_MINUTES,
    ),
  );
  const [minutes, setMinutes] = useState(String(saved));
  const [justification, setJustification] = useState("");

  useEffect(() => setMinutes(String(saved)), [saved]);

  const parsed = parseMinutes(minutes);
  const valid = parsed !== null;
  const dirty = parsed !== saved;
  const missing = !valid
    ? [`Minutes must be a whole number from ${MIN_AUTH_IDLE_LOCK_MINUTES} to ${MAX_AUTH_IDLE_LOCK_MINUTES} (0 = off).`]
    : [];

  const save = useMutation({
    mutationFn: async () => {
      if (parsed === null) {
        throw new Error(
          `Minutes must be ${MIN_AUTH_IDLE_LOCK_MINUTES}–${MAX_AUTH_IDLE_LOCK_MINUTES}.`,
        );
      }
      if (parsed === saved) return 0;
      const reason =
        justification.trim().length >= 10
          ? justification.trim()
          : "Updated idle screen lock minutes from Admin.";
      await updateSystemParameter({
        key: AUTH_IDLE_LOCK_MINUTES_KEY,
        newValue: parsed,
        justification: reason,
      });
      return 1;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: SYSTEM_PARAMETERS_QUERY_KEY });
      setJustification("");
      toast.success(
        count === 0 ? "No changes to save" : "Idle lock minutes saved",
        {
          description:
            parsed === 0
              ? "Idle lock is off."
              : `Tablets lock after ${parsed} minute${parsed === 1 ? "" : "s"} idle (not during an active Manifest).`,
        },
      );
    },
    onError: (e: Error) =>
      toast.error("Could not save idle lock", { description: e.message }),
  });

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-semibold">
            <Lock className="h-4 w-4 text-primary" />
            Idle screen lock
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            After this many minutes with no tap or key, the tablet locks. The{" "}
            <strong>same</strong> staff member unlocks with their PIN and stays on
            the same screen. <strong>0</strong> turns the lock off. An active
            Manifest run does not lock. Default {DEFAULT_AUTH_IDLE_LOCK_MINUTES}.
          </p>
        </div>
        {!canEdit && <Badge variant="secondary">Read-only · Managers can edit</Badge>}
      </div>

      <div className="space-y-1.5 max-w-xs">
        <Label htmlFor="auth-idle-lock-minutes">Idle minutes</Label>
        <Input
          id="auth-idle-lock-minutes"
          type="number"
          min={MIN_AUTH_IDLE_LOCK_MINUTES}
          max={MAX_AUTH_IDLE_LOCK_MINUTES}
          step={1}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          disabled={!canEdit}
          className={requiredFieldOutline(!valid, "h-11")}
        />
        <p className="text-[11px] text-muted-foreground">
          {MIN_AUTH_IDLE_LOCK_MINUTES}–{MAX_AUTH_IDLE_LOCK_MINUTES} · 0 = off
        </p>
      </div>

      {canEdit && dirty && missing.length > 0 && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {missing[0]}
        </div>
      )}

      {canEdit && dirty && (
        <div className="space-y-1.5">
          <Label htmlFor="idle-lock-reason" className="text-xs">
            Change reason (optional — auto-filled if left blank)
          </Label>
          <Input
            id="idle-lock-reason"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="e.g. Shorten office idle lock to 10 minutes"
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
          {save.isPending ? "Saving…" : "Save idle lock"}
        </Button>
      )}
    </div>
  );
}
