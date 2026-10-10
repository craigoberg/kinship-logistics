/**
 * Admin read-only Activity log — operational_ledger, human readable.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ClientTime } from "@/components/ui/client-time";
import { getOperationalTodayIso } from "@/lib/operational-clock";
import { parseIsoDateLocal, toIsoDateString } from "@/lib/utils";
import {
  ACTIVITY_AREAS,
  ACTIVITY_LOG_KEY,
  ACTIVITY_LOG_LIMIT,
  listActivityLog,
  type ActivityAreaId,
} from "@/lib/api/activity-log";

function shiftIsoDays(iso: string, days: number): string {
  const d = parseIsoDateLocal(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + days);
  return toIsoDateString(d);
}

export function ActivityLogWorkspace() {
  const today = getOperationalTodayIso();
  const [fromIso, setFromIso] = useState(() => shiftIsoDays(today, -13));
  const [toIso, setToIso] = useState(today);
  const [area, setArea] = useState<ActivityAreaId>("all");
  const [search, setSearch] = useState("");

  const rangeInvalid = !fromIso || !toIso || fromIso > toIso;

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: [...ACTIVITY_LOG_KEY, fromIso, toIso, area],
    queryFn: () => listActivityLog({ fromIso, toIso, area }),
    enabled: !rangeInvalid,
    staleTime: 15_000,
  });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.actorName, r.summary, r.actionLabel, r.areaLabel, r.actionType, r.location, r.why, r.gpsLabel]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, search]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Who did what, to whom, where, when, and why. Type is a filter (Day
        Centre, trips, vehicles), not the place — that is the Where column.
        GPS is shown when the browser captured it. Yellow/Red lines name who
        is overdue; automated sweeps credit System. Read-only — nothing here
        can be edited. The NDIS Audit Pack ZIP remains under System Parameters
        for auditor USB dumps.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <DatePicker
            value={parseIsoDateLocal(fromIso)}
            onChange={(d) => setFromIso(d ? toIsoDateString(d) : "")}
            dateFormat="dd-MMM-yy"
            captionLayout="dropdown"
            className="h-11 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <DatePicker
            value={parseIsoDateLocal(toIso)}
            onChange={(d) => setToIso(d ? toIsoDateString(d) : "")}
            dateFormat="dd-MMM-yy"
            captionLayout="dropdown"
            className="h-11 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Type</Label>
          <Select value={area} onValueChange={(v) => setArea(v as ActivityAreaId)}>
            <SelectTrigger className="h-11 w-48" aria-label="Filter activity type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTIVITY_AREAS.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search who, what, where, why…"
            className="h-11 pl-9"
            aria-label="Search activity log"
          />
        </div>
      </div>

      {rangeInvalid ? (
        <p className="text-sm text-destructive">Choose a From date on or before To.</p>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {(error as Error).message}
        </div>
      ) : null}

      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading activity…</p>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
          {rows.length === 0
            ? "No ledger rows in this date range."
            : "No rows match this search."}
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Showing {visible.length}
            {rows.length >= ACTIVITY_LOG_LIMIT ? ` (capped at ${ACTIVITY_LOG_LIMIT})` : ""}{" "}
            in this range. Newest first.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>What happened</TableHead>
                  <TableHead>Where</TableHead>
                  <TableHead>Why</TableHead>
                  <TableHead className="whitespace-nowrap">Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                      <ClientTime iso={r.createdAt} />
                    </TableCell>
                    <TableCell className="font-medium">{r.actorName}</TableCell>
                    <TableCell>{r.summary}</TableCell>
                    <TableCell className="text-sm">
                      <div>{r.location || "—"}</div>
                      {r.gpsLabel ? (
                        <div className="text-xs text-muted-foreground">GPS {r.gpsLabel}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.why || "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {r.areaLabel}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
