import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ClientTime } from "@/components/ui/client-time";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DAY_CODE_LABEL,
  listCentreHours,
  updateCentreHours,
  type CentreHourRow,
  type DayCode,
} from "@/lib/api/centre-hours";
import { canManageSystemParameters } from "@/lib/api/system-parameters";
import { getActiveUserProfile } from "@/lib/data-store";

const QKEY = ["centre-operating-hours"] as const;

function isManagerRole(staffRole: string | null | undefined): boolean {
  return (staffRole ?? "").toLowerCase().includes("manager");
}

export function CentreOperatingHoursWorkspace() {
  const profile = useMemo(() => getActiveUserProfile(), []);
  const permQ = useQuery({
    queryKey: ["system-parameters", "can-manage", profile?.staffId ?? "auth-user"],
    queryFn: () => canManageSystemParameters(profile?.staffId),
    staleTime: 60_000,
  });
  const canEdit = isManagerRole(profile?.staffRole) || permQ.data === true;

  const q = useQuery({ queryKey: QKEY, queryFn: listCentreHours, staleTime: 30_000 });

  if (q.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading centre hours…</div>;
  }
  if (q.error) {
    return (
      <div className="text-sm text-destructive">
        Failed to load centre operating hours: {(q.error as Error).message}
        <div className="mt-1 text-xs">
          Run <code>docs/sql/2026-07-12_centre_operating_hours.sql</code> in
          the Supabase SQL editor if the table does not yet exist.
        </div>
      </div>
    );
  }

  const rows = q.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Facility-wide open/close defaults. Tier 2 of the daily seeder ladder:
          used when a participant has no per-client schedule override.
        </p>
        {!canEdit && <Badge variant="secondary">Read-only · Managers can edit</Badge>}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Weekday</TableHead>
              <TableHead>Open</TableHead>
              <TableHead>Close</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-[260px]">Save</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <CentreHoursRow key={r.dayOfWeek} row={r} canEdit={canEdit} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CentreHoursRow({ row, canEdit }: { row: CentreHourRow; canEdit: boolean }) {
  const qc = useQueryClient();
  const [openTime, setOpenTime] = useState(row.openTime);
  const [closeTime, setCloseTime] = useState(row.closeTime);
  const [just, setJust] = useState("");

  const mut = useMutation({
    mutationFn: () =>
      updateCentreHours({
        dayOfWeek: row.dayOfWeek as DayCode,
        openTime,
        closeTime,
        justification: just,
      }),
    onSuccess: () => {
      toast.success(`Saved ${DAY_CODE_LABEL[row.dayOfWeek]} hours.`);
      setJust("");
      qc.invalidateQueries({ queryKey: QKEY });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dirty = openTime !== row.openTime || closeTime !== row.closeTime;
  const canSave =
    canEdit &&
    dirty &&
    just.trim().length >= 10 &&
    /^\d{2}:\d{2}$/.test(openTime) &&
    /^\d{2}:\d{2}$/.test(closeTime) &&
    openTime < closeTime &&
    !mut.isPending;

  return (
    <TableRow>
      <TableCell className="font-medium">{DAY_CODE_LABEL[row.dayOfWeek]}</TableCell>
      <TableCell>
        <input
          type="time"
          value={openTime}
          disabled={!canEdit}
          onChange={(e) => setOpenTime(e.target.value)}
          className="h-9 rounded border border-input bg-background px-2 text-sm"
        />
      </TableCell>
      <TableCell>
        <input
          type="time"
          value={closeTime}
          disabled={!canEdit}
          onChange={(e) => setCloseTime(e.target.value)}
          className="h-9 rounded border border-input bg-background px-2 text-sm"
        />
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        <ClientTime iso={row.updatedAt} />
      </TableCell>
      <TableCell>
        {canEdit && dirty ? (
          <div className="space-y-1">
            <Label htmlFor={`just-${row.dayOfWeek}`} className="text-[11px] text-muted-foreground">
              Justification (min 10 chars, ledger receipt)
            </Label>
            <Textarea
              id={`just-${row.dayOfWeek}`}
              rows={2}
              value={just}
              onChange={(e) => setJust(e.target.value)}
              placeholder="Why is this changing?"
              className="text-xs"
            />
            <Button size="sm" onClick={() => mut.mutate()} disabled={!canSave}>
              {mut.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-3.5 w-3.5" />
              )}
              Save
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}
