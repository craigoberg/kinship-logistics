import { useMemo, useState } from "react";
import {
  Plus,
  Pencil,
  Archive,
  ArchiveRestore,
  CalendarDays,
  CalendarX,
  CalendarOff,
  ClipboardList,
  Search,
  AlertTriangle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  useAttendanceLogs,
  useAttendanceSchedules,
  useUpdateAttendanceSchedule,
  useRemoveAttendanceSchedule,
  useBusRunMap,
} from "@/hooks/use-supabase-data";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils";
import type { AttendanceLog, AttendanceSchedule } from "@/lib/data-store";

// Canonical weekday sort order for the schedules table.
const DAY_ORDER: Record<string, number> = {
  "DAY-MON": 0, "DAY-TUE": 1, "DAY-WED": 2, "DAY-THU": 3,
  "DAY-FRI": 4, "DAY-SAT": 5, "DAY-SUN": 6,
};
const DAY_LABELS: Record<string, string> = {
  "DAY-MON": "Monday", "DAY-TUE": "Tuesday", "DAY-WED": "Wednesday",
  "DAY-THU": "Thursday", "DAY-FRI": "Friday", "DAY-SAT": "Saturday", "DAY-SUN": "Sunday",
};
function dayRank(code: string): number {
  return DAY_ORDER[code] ?? 99;
}

import { AddAttendanceScheduleModal } from "./add-attendance-schedule-modal";
import { EditAttendanceLogModal } from "./edit-attendance-log-modal";
import { MarkAttendanceExceptionModal } from "./mark-attendance-exception-modal";
import { LogPlannedAbsenceModal } from "./log-planned-absence-modal";
import { AttendanceStatusBadge } from "./attendance-status-badge";
import { NoShowCountdownModal } from "./no-show-countdown-modal";
import { toast } from "sonner";

type ScheduleSortCol = "day" | "service" | "inbound" | "outbound" | "status";
type SortDir = "asc" | "desc";

interface BusRunBadge { label: string; color: string; }

/** Renders a colored run badge (R1, R2…) or plain muted text for generic codes. */
function TransportCodeBadge({
  code,
  runMap,
}: {
  code: string;
  runMap: Map<string, BusRunBadge>;
}) {
  const run = runMap.get(code);
  if (run) {
    return (
      <span
        className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-bold text-white"
        style={{ backgroundColor: run.color }}
      >
        {run.label}
      </span>
    );
  }
  return <span className="text-muted-foreground">{code || "—"}</span>;
}

interface Props {
  participantId: string;
  participantName: string;
}

export function AttendanceTab({ participantId, participantName }: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [editSchedule, setEditSchedule] = useState<AttendanceSchedule | null>(null);
  const [editScheduleOpen, setEditScheduleOpen] = useState(false);
  const [editLog, setEditLog] = useState<AttendanceLog | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [exceptionSchedule, setExceptionSchedule] = useState<AttendanceSchedule | null>(null);
  const [exceptionOpen, setExceptionOpen] = useState(false);
  const [absenceOpen, setAbsenceOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [noShowOpen, setNoShowOpen] = useState(false);
  const [sortCol, setSortCol] = useState<ScheduleSortCol>("day");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [removeTarget, setRemoveTarget] = useState<AttendanceSchedule | null>(null);
  const [removeReason, setRemoveReason] = useState("");

  const schedulesQ = useAttendanceSchedules(participantId);
  const logsQ = useAttendanceLogs(participantId);
  const restore = useUpdateAttendanceSchedule();
  const removeMut = useRemoveAttendanceSchedule();
  const busRunMap = useBusRunMap();

  const allSchedules = schedulesQ.data ?? [];
  const archivedCount = allSchedules.filter((s) => !s.active).length;

  const schedules = useMemo(() => {
    const base = showArchived ? allSchedules : allSchedules.filter((s) => s.active);
    return [...base].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "day":
          cmp = dayRank(a.dayOfWeek) - dayRank(b.dayOfWeek);
          break;
        case "service":
          cmp = a.serviceType.localeCompare(b.serviceType);
          break;
        case "inbound":
          cmp = (a.inboundTransport || a.transportRule).localeCompare(
            b.inboundTransport || b.transportRule,
          );
          break;
        case "outbound":
          cmp = (a.outboundTransport || a.transportRule).localeCompare(
            b.outboundTransport || b.transportRule,
          );
          break;
        case "status":
          cmp = Number(b.active) - Number(a.active);
          break;
      }
      // Secondary sort: always day order when primary col ties.
      if (cmp === 0 && sortCol !== "day") cmp = dayRank(a.dayOfWeek) - dayRank(b.dayOfWeek);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [allSchedules, showArchived, sortCol, sortDir]);
  const logs = logsQ.data ?? [];

  const filteredLogs = useMemo(() => {
    const n = query.trim().toLowerCase();
    if (!n) return logs;
    return logs.filter((l) =>
      [
        l.rosterDate,
        l.expectedService,
        l.actualStatus,
        l.driverNotes ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(n),
    );
  }, [logs, query]);

  const onRestore = async (s: AttendanceSchedule) => {
    try {
      await restore.mutateAsync({ id: s.id, patch: { active: true } });
      toast.success("Schedule restored", {
        description: `${s.dayOfWeek} · ${s.serviceType} reactivated.`,
      });
    } catch {
      /* handled */
    }
  };

  return (
    <div className="space-y-6">
      {/* ===== Section A — Baseline Rules ===== */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Operational schedules</h3>
            <p className="text-xs text-muted-foreground">
              Baseline weekly attendance rules for {participantName}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-md border border-border bg-card/60 px-3 py-1.5">
              <Switch
                id="show-archived-attendance"
                checked={showArchived}
                onCheckedChange={setShowArchived}
              />
              <Label
                htmlFor="show-archived-attendance"
                className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-foreground"
              >
                Show archived requirements
                {archivedCount > 0 && (
                  <span className="ml-1 rounded-full bg-warning px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {archivedCount}
                  </span>
                )}
              </Label>
            </div>
            <Button onClick={() => setAddOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />
              Add Operational Schedule
            </Button>
          </div>
        </div>

        {schedulesQ.error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
            {(schedulesQ.error as Error).message}
          </div>
        )}

        {schedules.length === 0 && !schedulesQ.isLoading ? (
          <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
            <CalendarDays className="mx-auto mb-2 h-5 w-5" />
            {showArchived
              ? "No schedules on file."
              : "No active operational schedules. Toggle Show archived to view past configurations."}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  {(
                    [
                      { col: "day" as ScheduleSortCol, label: "Day" },
                      { col: "service" as ScheduleSortCol, label: "Service type" },
                      { col: "inbound" as ScheduleSortCol, label: "Transport IN" },
                      { col: "outbound" as ScheduleSortCol, label: "Transport OUT" },
                      { col: "status" as ScheduleSortCol, label: "Status" },
                    ] as const
                  ).map(({ col, label }) => {
                    const active = sortCol === col;
                    const Icon = active
                      ? sortDir === "asc" ? ArrowUp : ArrowDown
                      : ArrowUpDown;
                    return (
                      <th key={col} className="px-4 py-2 font-medium">
                        <button
                          type="button"
                          onClick={() => {
                            if (sortCol === col) {
                              setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                            } else {
                              setSortCol(col);
                              setSortDir("asc");
                            }
                          }}
                          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                        >
                          {label}
                          <Icon className={`h-3 w-3 ${active ? "text-primary" : "opacity-40"}`} />
                        </button>
                      </th>
                    );
                  })}
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr
                    key={s.id}
                    className={
                      "border-t border-border " +
                      (s.active ? "" : "bg-muted/30 text-muted-foreground")
                    }
                  >
                    <td className="px-4 py-2 font-medium">
                      {DAY_LABELS[s.dayOfWeek] ?? s.dayOfWeek}
                    </td>
                    <td className="px-4 py-2">{s.serviceType}</td>
                    <td className="px-4 py-2">
                      <TransportCodeBadge code={s.inboundTransport || s.transportRule} runMap={busRunMap} />
                    </td>
                    <td className="px-4 py-2">
                      <TransportCodeBadge code={s.outboundTransport || s.transportRule} runMap={busRunMap} />
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={
                          s.active
                            ? "rounded-full bg-success px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                            : "rounded-full bg-muted-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                        }
                      >
                        {s.active ? "Active" : "Archived"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {s.active && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1"
                            onClick={() => {
                              setExceptionSchedule(s);
                              setExceptionOpen(true);
                            }}
                            title="Mark a one-day exception"
                          >
                            <CalendarX className="h-3.5 w-3.5" />
                            Exception
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1"
                          onClick={() => {
                            setEditSchedule(s);
                            setEditScheduleOpen(true);
                          }}
                          title="Edit this schedule"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                        {s.active ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1 text-destructive hover:text-destructive"
                            onClick={() => {
                              setRemoveTarget(s);
                              setRemoveReason("");
                            }}
                            title="Remove this schedule (permanent change, audit logged)"
                          >
                            <Archive className="h-3.5 w-3.5" />
                            Remove
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1 text-primary hover:text-primary"
                            onClick={() => onRestore(s)}
                            disabled={restore.isPending}
                            title="Restore (sets active=true)"
                          >
                            <ArchiveRestore className="h-3.5 w-3.5" />
                            Restore
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ===== Section B — Historical Truth ===== */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Roster history</h3>
            <p className="text-xs text-muted-foreground">
              Actual attendance vs. expected service.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search dates, status, notes…"
                className="h-9 pl-9"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => setNoShowOpen(true)}
              className="gap-1.5 border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <AlertTriangle className="h-4 w-4" />
              Trigger No-Show Countdown
            </Button>
            <Button onClick={() => setAbsenceOpen(true)} className="gap-1.5">
              <CalendarOff className="h-4 w-4" />
              Log Planned Absence / Suspension
            </Button>
          </div>
        </div>

        {logsQ.error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
            {(logsQ.error as Error).message}
          </div>
        )}

        {logsQ.isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Loading attendance…
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
            <ClipboardList className="mx-auto mb-2 h-5 w-5" />
            {query
              ? `No roster entries match "${query}".`
              : "No roster history yet."}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Roster date</th>
                  <th className="px-4 py-2 font-medium">Expected service</th>
                  <th className="px-4 py-2 font-medium">Actual status</th>
                  <th className="px-4 py-2 font-medium">Driver notes</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((l) => (
                  <tr key={l.id} className="border-t border-border align-top">
                    <td className="whitespace-nowrap px-4 py-2 font-medium tabular-nums">
                      {formatDate(l.rosterDate)}
                    </td>
                    <td className="px-4 py-2">{l.expectedService}</td>
                    <td className="px-4 py-2">
                      <AttendanceStatusBadge status={l.actualStatus} />
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {l.driverNotes || (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1"
                        onClick={() => {
                          setEditLog(l);
                          setEditOpen(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Update
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Remove schedule confirmation ─────────────────────────────── */}
      <Dialog
        open={!!removeTarget}
        onOpenChange={(o) => {
          if (!o) { setRemoveTarget(null); setRemoveReason(""); }
        }}
      >
        <DialogContent className="max-w-md border-border bg-card">
          <DialogHeader>
            <DialogTitle>Remove operational schedule</DialogTitle>
            <DialogDescription>
              This is a permanent schedule change for{" "}
              <span className="font-semibold text-foreground">{participantName}</span>.
              The row will be deactivated and the reason logged to the audit trail.
              Historical attendance records are preserved.
            </DialogDescription>
          </DialogHeader>
          {removeTarget && (
            <div className="space-y-3 pt-1">
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                <div className="font-semibold">
                  {DAY_LABELS[removeTarget.dayOfWeek] ?? removeTarget.dayOfWeek}
                  {" — "}
                  {removeTarget.serviceType}
                </div>
                <div className="text-xs text-muted-foreground">
                  IN: {removeTarget.inboundTransport || removeTarget.transportRule}
                  {" · "}
                  OUT: {removeTarget.outboundTransport || removeTarget.transportRule}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Reason for removal <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  rows={3}
                  value={removeReason}
                  onChange={(e) => setRemoveReason(e.target.value)}
                  placeholder="e.g. Client has changed their days — no longer attending on this day."
                  className="resize-none"
                />
                <p className="text-[11px] text-muted-foreground">
                  Minimum 10 characters. This will appear in the Governance Hub audit log.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setRemoveTarget(null); setRemoveReason(""); }}
            >
              Close
            </Button>
            <Button
              variant="destructive"
              disabled={removeReason.trim().length < 10 || removeMut.isPending}
              onClick={async () => {
                if (!removeTarget) return;
                try {
                  await removeMut.mutateAsync({
                    id: removeTarget.id,
                    reason: removeReason.trim(),
                  });
                  toast.success("Schedule removed", {
                    description: `${DAY_LABELS[removeTarget.dayOfWeek] ?? removeTarget.dayOfWeek} · ${removeTarget.serviceType} removed for ${participantName}.`,
                  });
                  setRemoveTarget(null);
                  setRemoveReason("");
                } catch {
                  /* surfaced via hook */
                }
              }}
              className="gap-1.5"
            >
              <Archive className="h-4 w-4" />
              {removeMut.isPending ? "Removing…" : "Confirm Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddAttendanceScheduleModal
        open={addOpen}
        onOpenChange={setAddOpen}
        participantId={participantId}
        participantName={participantName}
      />
      <AddAttendanceScheduleModal
        open={editScheduleOpen}
        onOpenChange={(o) => {
          setEditScheduleOpen(o);
          if (!o) setEditSchedule(null);
        }}
        participantId={participantId}
        participantName={participantName}
        editing={editSchedule}
      />
      <EditAttendanceLogModal
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) setEditLog(null);
        }}
        log={editLog}
      />
      <MarkAttendanceExceptionModal
        open={exceptionOpen}
        onOpenChange={(o) => {
          setExceptionOpen(o);
          if (!o) setExceptionSchedule(null);
        }}
        schedule={exceptionSchedule}
        participantName={participantName}
      />
      <LogPlannedAbsenceModal
        open={absenceOpen}
        onOpenChange={setAbsenceOpen}
        participantId={participantId}
        participantName={participantName}
      />
      <NoShowCountdownModal
        open={noShowOpen}
        onOpenChange={setNoShowOpen}
        participantId={participantId}
        participantName={participantName}
      />
    </div>
  );
}
