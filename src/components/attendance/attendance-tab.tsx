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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  useAttendanceLogs,
  useAttendanceSchedules,
  useArchiveAttendanceSchedule,
  useUpdateAttendanceSchedule,
} from "@/hooks/use-supabase-data";
import { formatDate } from "@/lib/utils";
import type { AttendanceLog, AttendanceSchedule } from "@/lib/data-store";
import { AddAttendanceScheduleModal } from "./add-attendance-schedule-modal";
import { EditAttendanceLogModal } from "./edit-attendance-log-modal";
import { MarkAttendanceExceptionModal } from "./mark-attendance-exception-modal";
import { LogPlannedAbsenceModal } from "./log-planned-absence-modal";
import { AttendanceStatusBadge } from "./attendance-status-badge";
import { NoShowCountdownModal } from "./no-show-countdown-modal";
import { toast } from "sonner";

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

  const schedulesQ = useAttendanceSchedules(participantId);
  const logsQ = useAttendanceLogs(participantId);
  const archive = useArchiveAttendanceSchedule();
  const restore = useUpdateAttendanceSchedule();

  const allSchedules = schedulesQ.data ?? [];
  const schedules = showArchived
    ? allSchedules
    : allSchedules.filter((s) => s.active);
  const archivedCount = allSchedules.filter((s) => !s.active).length;
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

  const onArchive = async (s: AttendanceSchedule) => {
    try {
      await archive.mutateAsync(s.id);
      toast.success("Schedule archived", {
        description: `${s.dayOfWeek} · ${s.serviceType} marked inactive.`,
      });
    } catch {
      /* handled in hook */
    }
  };
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
                  <th className="px-4 py-2 font-medium">Day</th>
                  <th className="px-4 py-2 font-medium">Service type</th>
                  <th className="px-4 py-2 font-medium">Transport rule</th>
                  <th className="px-4 py-2 font-medium">Status</th>
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
                    <td className="px-4 py-2 font-medium">{s.dayOfWeek}</td>
                    <td className="px-4 py-2">{s.serviceType}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {s.transportRule}
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
                            onClick={() => onArchive(s)}
                            disabled={archive.isPending}
                            title="Archive (keeps history, sets active=false)"
                          >
                            <Archive className="h-3.5 w-3.5" />
                            Archive
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
