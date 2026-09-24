import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Megaphone, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import {
  canManageSystemParameters,
  updateSystemParameter,
} from "@/lib/api/system-parameters";
import {
  SYSTEM_PARAMETERS_QUERY_KEY,
  useSystemParameter,
} from "@/hooks/use-system-parameters";
import { FLOOR_MOTD_KEY } from "@/hooks/use-floor-announcement";
import { getActiveUserProfile } from "@/lib/data-store";
import { formatUnknownError } from "@/lib/utils";

export const MOTD_PARAM_KEYS = [FLOOR_MOTD_KEY] as const;

function isManagerRole(staffRole: string | null | undefined): boolean {
  return (staffRole ?? "").toLowerCase().includes("manager");
}

/**
 * Admin → System Parameters — Message of the Day.
 * Non-empty saved text shows on every page (below emergency); empty clears it.
 */
export function MotdAdminPanel() {
  const qc = useQueryClient();
  const profile = useMemo(() => getActiveUserProfile(), []);
  const permissionQ = useQuery({
    queryKey: ["system-parameters", "can-manage", profile?.staffId ?? "auth-user"],
    queryFn: () => canManageSystemParameters(profile?.staffId),
    staleTime: 60_000,
  });
  const canEdit = isManagerRole(profile?.staffRole) || permissionQ.data === true;

  const rawSaved = useSystemParameter<string>(FLOOR_MOTD_KEY, "");
  const saved =
    typeof rawSaved === "string" ? rawSaved : String(rawSaved ?? "");

  const [text, setText] = useState(saved);
  const [justification, setJustification] = useState("");

  useEffect(() => setText(saved), [saved]);

  const dirty = text.trim() !== saved.trim();
  const active = saved.trim().length > 0;

  const persist = useMutation({
    mutationFn: async (next: string) => {
      const reason =
        justification.trim().length >= 10
          ? justification.trim()
          : next.trim().length === 0
            ? "Cleared Message of the Day from Admin."
            : "Updated Message of the Day from Admin.";
      await updateSystemParameter({
        key: FLOOR_MOTD_KEY,
        newValue: next.trim(),
        justification: reason,
      });
      return next.trim();
    },
    onSuccess: async (next) => {
      await qc.invalidateQueries({ queryKey: SYSTEM_PARAMETERS_QUERY_KEY });
      setJustification("");
      toast.success(
        next.length === 0 ? "Message of the Day cleared" : "Message of the Day saved",
      );
    },
    onError: (e: unknown) => {
      toast.error("Could not save MOTD", {
        description: formatUnknownError(e),
      });
    },
  });

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-sky-600" />
            <h3 className="text-sm font-semibold tracking-tight">
              Message of the Day
            </h3>
            {active ? (
              <Badge className="bg-sky-600 text-white">Live</Badge>
            ) : (
              <Badge variant="secondary">Off</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Saved non-empty text appears on every screen (calm strip). Cleared /
            empty = no MOTD. Hidden while a Live/Drill emergency is active.
          </p>
        </div>
      </div>

      <CharacterCountedTextarea
        label="Floor message"
        value={text}
        onValueChange={setText}
        minChars={0}
        maxChars={500}
        rows={3}
        required={false}
        placeholder="e.g. Fire drill at 10:30 — please stay with your groups."
        disabled={!canEdit || persist.isPending}
      />

      <CharacterCountedTextarea
        label="Justification (optional)"
        value={justification}
        onValueChange={setJustification}
        minChars={0}
        maxChars={200}
        rows={2}
        required={false}
        hint="Audit trail — min 10 if you fill it in"
        disabled={!canEdit || persist.isPending}
      />

      {!canEdit ? (
        <p className="text-xs text-muted-foreground">
          Manager role required to edit.
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="button"
          variant="outline"
          className="h-11 gap-1.5"
          disabled={!canEdit || !active || persist.isPending}
          onClick={() => {
            setText("");
            persist.mutate("");
          }}
        >
          <Trash2 className="h-4 w-4" />
          Clear message
        </Button>
        <Button
          type="button"
          className="h-11 gap-1.5"
          disabled={!canEdit || !dirty || persist.isPending}
          onClick={() => persist.mutate(text)}
        >
          <Save className="h-4 w-4" />
          {persist.isPending ? "Saving…" : "Save message"}
        </Button>
      </div>
    </div>
  );
}
