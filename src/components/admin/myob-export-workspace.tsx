import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ClientTime } from "@/components/ui/client-time";
import {
  buildCsv,
  downloadCsv,
  getLastExportedAt,
  listBillingReadyRows,
  recordExport,
  type BillingReadyRow,
} from "@/lib/api/myob-export";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function defaultStart(lastIso: string | null): string {
  if (!lastIso) {
    // 30 days back if no prior export.
    const d = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return lastIso.slice(0, 10);
}

export function MyobExportWorkspace() {
  const queryClient = useQueryClient();
  const lastExportQ = useQuery<string | null>({
    queryKey: ["myob-export", "last"],
    queryFn: getLastExportedAt,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const lastIso = lastExportQ.data ?? null;
  const [rangeStart, setRangeStart] = useState<string>(() =>
    defaultStart(lastIso),
  );
  const [rangeEnd, setRangeEnd] = useState<string>(todayIso());

  const previewQ = useQuery<BillingReadyRow[]>({
    queryKey: ["myob-export", "preview", rangeStart, rangeEnd],
    queryFn: () => listBillingReadyRows(rangeStart, rangeEnd),
    enabled: !!rangeStart && !!rangeEnd && rangeStart <= rangeEnd,
    staleTime: 15_000,
  });

  const rows = previewQ.data ?? [];

  const exportMut = useMutation({
    mutationFn: async () => {
      if (rows.length === 0) throw new Error("No billing-ready rows in range.");
      const csv = buildCsv(rows);
      downloadCsv(csv, `myob-export-${rangeStart}_to_${rangeEnd}.csv`);
      return recordExport(rangeStart, rangeEnd, rows.map((r) => r.logId));
    },
    onSuccess: (res) => {
      toast.success(`Exported ${res.rowCount} row${res.rowCount === 1 ? "" : "s"}.`);
      queryClient.invalidateQueries({ queryKey: ["myob-export"] });
    },
    onError: (e: Error) =>
      toast.error("Could not record export", { description: e.message }),
  });

  const summary = useMemo(() => {
    const total = rows.reduce((acc, r) => acc + (r.total || 0), 0);
    return { count: rows.length, total };
  }, [rows]);

  const rangeInvalid = rangeStart > rangeEnd;

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold tracking-tight">
            MYOB Export
          </h3>
          <p className="text-sm text-muted-foreground">
            Downloads billing-ready attendance rows as a MYOB-format CSV and
            flips them to <code>exported</code>.
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div className="font-semibold uppercase tracking-wide">
            Last export
          </div>
          <div>
            <ClientTime iso={lastIso} placeholder="never" />
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="rg-start" className="text-xs">
            From
          </Label>
          <Input
            id="rg-start"
            type="date"
            value={rangeStart}
            onChange={(e) => setRangeStart(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rg-end" className="text-xs">
            To
          </Label>
          <Input
            id="rg-end"
            type="date"
            value={rangeEnd}
            onChange={(e) => setRangeEnd(e.target.value)}
          />
        </div>
      </div>

      {rangeInvalid && (
        <p className="text-xs text-destructive">
          "From" must be on or before "To".
        </p>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Participant</TableHead>
              <TableHead>Service</TableHead>
              <TableHead className="text-right">Hours</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>NDIS Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {previewQ.isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-sm text-muted-foreground"
                >
                  <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />
                  Loading preview…
                </TableCell>
              </TableRow>
            ) : previewQ.isError ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-sm text-destructive"
                >
                  {(previewQ.error as Error).message}
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-sm text-muted-foreground"
                >
                  No billing-ready rows in this range.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.logId}>
                  <TableCell className="font-mono text-xs">
                    {r.rosterDate}
                  </TableCell>
                  <TableCell>{r.participantName}</TableCell>
                  <TableCell className="text-xs">{r.serviceCode}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.hours}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.total.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.ndisCancellationReason ?? "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {summary.count} row{summary.count === 1 ? "" : "s"} ·{" "}
          ${summary.total.toFixed(2)} total
        </div>
        <Button
          onClick={() => exportMut.mutate()}
          disabled={rangeInvalid || rows.length === 0 || exportMut.isPending}
          className="gap-1.5"
        >
          {exportMut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Export CSV
        </Button>
      </div>
    </section>
  );
}
