import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SYSTEM_PARAMETERS_QUERY_KEY, useSystemParameters } from "@/hooks/use-system-parameters";
import {
  canManageSystemParameters,
  updateSystemParameter,
  type JsonValue,
  type SystemParameterRow,
} from "@/lib/api/system-parameters";
import { getActiveUserProfile } from "@/lib/data-store";
import { ClientTime } from "@/components/ui/client-time";
import { MyobExportWorkspace } from "./myob-export-workspace";


function isManagerRole(staffRole: string | null | undefined): boolean {
  return (staffRole ?? "").toLowerCase().includes("manager");
}

function formatValue(v: JsonValue): string {
  if (v == null) return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return String(v);
  }
  return JSON.stringify(v);
}

// Browser-local timestamp rendering lives in <ClientTime> — see
// PROJECT_CONTEXT.md §10. Never display raw toISOString() strings to users.


export function SystemParameterWorkspace() {
  const q = useSystemParameters();
  const profile = useMemo(() => getActiveUserProfile(), []);
  const permissionQ = useQuery({
    queryKey: ["system-parameters", "can-manage", profile?.staffId ?? "auth-user"],
    queryFn: () => canManageSystemParameters(profile?.staffId),
    staleTime: 60_000,
  });
  const canEdit = isManagerRole(profile?.staffRole) || permissionQ.data === true;
  const [editing, setEditing] = useState<SystemParameterRow | null>(null);

  if (q.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading parameters…</div>;
  }
  if (q.error) {
    return (
      <div className="text-sm text-destructive">
        Failed to load system parameters: {(q.error as Error).message}
      </div>
    );
  }

  const rows = q.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Tunable operational thresholds. Every change is appended to the operational ledger with
          the Managers justification.
        </p>
        {!canEdit && <Badge variant="secondary">Read-only · Managers can edit</Badge>}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No parameters configured.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="font-mono text-xs">{r.key}</TableCell>
                  <TableCell className="font-mono">{formatValue(r.value)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.description}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <ClientTime iso={r.updated_at} />
                  </TableCell>

                  <TableCell>
                    {canEdit && (
                      <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                        <Pencil className="mr-1 h-3 w-3" /> Edit
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {editing && <EditParameterModal row={editing} onClose={() => setEditing(null)} />}

      <MyobExportWorkspace />
    </div>
  );
}

function EditParameterModal({ row, onClose }: { row: SystemParameterRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string>(() =>
    typeof row.value === "object" ? JSON.stringify(row.value, null, 2) : String(row.value ?? ""),
  );
  const [boolDraft, setBoolDraft] = useState<boolean>(
    typeof row.value === "boolean" ? row.value : false,
  );
  const [justification, setJustification] = useState("");

  const valueKind =
    typeof row.value === "number"
      ? "number"
      : typeof row.value === "boolean"
        ? "boolean"
        : typeof row.value === "string"
          ? "string"
          : "json";

  const mutation = useMutation({
    mutationFn: async () => {
      let parsed: JsonValue;
      if (valueKind === "number") {
        const n = Number(draft);
        if (!Number.isFinite(n)) throw new Error("Value must be a number.");
        parsed = n;
      } else if (valueKind === "boolean") {
        parsed = boolDraft;
      } else if (valueKind === "string") {
        parsed = draft;
      } else {
        try {
          parsed = JSON.parse(draft) as JsonValue;
        } catch (e) {
          throw new Error(`Value must be valid JSON: ${(e as Error).message}`);
        }
      }
      return updateSystemParameter({
        key: row.key,
        newValue: parsed,
        justification,
      });
    },
    onSuccess: () => {
      toast.success(`Updated ${row.key}`);
      queryClient.invalidateQueries({ queryKey: SYSTEM_PARAMETERS_QUERY_KEY });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const changed =
    valueKind === "boolean"
      ? boolDraft !== row.value
      : draft !==
        (typeof row.value === "object"
          ? JSON.stringify(row.value, null, 2)
          : String(row.value ?? ""));
  const canSubmit = changed && justification.trim().length >= 10 && !mutation.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">{row.key}</DialogTitle>
          <DialogDescription>{row.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Current value</Label>
            <div className="rounded border bg-muted px-2 py-1 font-mono text-sm">
              {formatValue(row.value)}
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="new-value">New value ({valueKind})</Label>
            {valueKind === "boolean" ? (
              <div className="flex items-center gap-2">
                <Switch id="new-value" checked={boolDraft} onCheckedChange={setBoolDraft} />
                <span className="text-sm">{boolDraft ? "true" : "false"}</span>
              </div>
            ) : valueKind === "json" ? (
              <Textarea
                id="new-value"
                rows={5}
                className="font-mono text-xs"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            ) : (
              <Input
                id="new-value"
                type={valueKind === "number" ? "number" : "text"}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="justification">
              Justification <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="justification"
              rows={3}
              placeholder="Why is this changing? (min 10 chars, recorded in the ledger)"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSubmit}>
            {mutation.isPending ? "Saving…" : "Save & log"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
