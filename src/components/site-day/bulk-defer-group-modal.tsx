import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  bulkDeferGroup,
  type ArrivalMethod,
  type ClientAttendanceRow,
} from "@/lib/api/client-attendance";

interface Props {
  open: boolean;
  sessionId: string;
  rows: ClientAttendanceRow[];
  nameMap: Record<string, string>;
  yellowThresholdMins: number;
  onClose: (changed: boolean) => void;
}

const METHODS: { value: ArrivalMethod; label: string }[] = [
  { value: "bus", label: "Bus / Pickup" },
  { value: "private", label: "Private / Family" },
  { value: "walk_in", label: "Walk-in" },
  { value: "other", label: "Other" },
];

const INCREMENTS = [15, 30, 45, 60];

export function BulkDeferGroupModal({
  open,
  sessionId,
  rows,
  nameMap,
  yellowThresholdMins,
  onClose,
}: Props) {
  const [method, setMethod] = useState<ArrivalMethod>("bus");
  const [minutes, setMinutes] = useState<number>(30);

  const affected = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.arrivalMethod === method &&
          r.status !== "checked_in" &&
          r.status !== "checked_out" &&
          r.status !== "accounted",
      ),
    [rows, method],
  );

  const mut = useMutation({
    mutationFn: () =>
      bulkDeferGroup(sessionId, method, minutes, yellowThresholdMins),
    onSuccess: (res) => {
      toast.success(
        `Deferred ${res.deferredCount} ${method} passenger(s) by ${minutes} min`,
        res.yellowsAutoCleared > 0
          ? { description: `${res.yellowsAutoCleared} YELLOW warning(s) auto-cleared.` }
          : undefined,
      );
      onClose(true);
    },
    onError: (e: Error) => {
      toast.error("Bulk defer failed", { description: e.message });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !mut.isPending && onClose(false)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk Defer Group</DialogTitle>
          <DialogDescription>
            Push the expected arrival forward for every un-arrived client in
            a transport group (e.g. the entire bus when it's delayed). YELLOW
            warnings that clear the overdue window are auto-resolved. RED
            escalations stay open for manager review.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Arrival method</Label>
            <Select
              value={method}
              onValueChange={(v) => setMethod(v as ArrivalMethod)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Defer by</Label>
            <div className="flex gap-2">
              {INCREMENTS.map((n) => (
                <Button
                  key={n}
                  type="button"
                  variant={minutes === n ? "default" : "outline"}
                  size="sm"
                  onClick={() => setMinutes(n)}
                  className="flex-1"
                >
                  +{n} min
                </Button>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            <div className="font-medium text-slate-900">
              {affected.length} client(s) will be deferred
            </div>
            {affected.length > 0 ? (
              <ul className="mt-1 max-h-32 overflow-auto text-xs text-muted-foreground">
                {affected.map((r) => (
                  <li key={r.id}>
                    • {nameMap[r.participantId] ?? "Client"}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-1 text-xs text-muted-foreground">
                No un-arrived clients match this method.
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onClose(false)}
            disabled={mut.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || affected.length === 0}
          >
            {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Defer {affected.length} by +{minutes} min
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
