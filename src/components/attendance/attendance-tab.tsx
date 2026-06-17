import { useMemo, useState } from "react";
import { Plus, Pencil, CalendarDays, ClipboardList, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useAttendanceLogs,
  useAttendanceSchedules,
} from "@/hooks/use-supabase-data";
import { formatDate } from "@/lib/utils";
import type { AttendanceLog } from "@/lib/data-store";
import { AddAttendanceScheduleModal } from "./add-attendance-schedule-modal";
import { EditAttendanceLogModal } from "./edit-attendance-log-modal";
import { AttendanceStatusBadge } from "./attendance-status-badge";

interface Props {
  participantId: string;
  participantName: string;
}

export function AttendanceTab({ participantId, participantName }: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [editLog, setEditLog] = useState<AttendanceLog | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [query, setQuery] = useState("");

  const schedulesQ = useAttendanceSchedules(participantId);
  const logsQ = useAttendanceLogs(participantId);

  const schedules = schedulesQ.data ?? [];
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

  return (
    <div className="space-y-6">
      {/* ===== Section A — Baseline Rules ===== */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Operational schedules</h3>
            <p className="text-xs text-muted-foreground">
              Baseline weekly attendance rules for {participantName}.
            </p>
          </div>
          <Button onClick={() => setAddOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Add Operational Schedule
          </Button>
        </div>

        {schedulesQ.error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
            {(schedulesQ.error as Error).message}
          </div>
        )}

        {schedules.length === 0 && !schedulesQ.isLoading ? (
          <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
            <CalendarDays className="mx-auto mb-2 h-5 w-5" />
            No operational schedules yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Day</th>
                  <th className="px-4 py-2 font-medium">Service type</th>
                  <th className="px-4 py-2 font-medium">Transport rule</th>
                  <th className="px-4 py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="px-4 py-2 font-medium">{s.dayOfWeek}</td>
                    <td className="px-4 py-2">{s.serviceType}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {s.transportRule}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span
                        className={
                          s.active
                            ? "rounded-full bg-success px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                            : "rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                        }
                      >
                        {s.active ? "Active" : "Inactive"}
                      </span>
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
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search dates, status, notes…"
              className="h-9 pl-9"
            />
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
      <EditAttendanceLogModal
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) setEditLog(null);
        }}
        log={editLog}
      />
    </div>
  );
}
