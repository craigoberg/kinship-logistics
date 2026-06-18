import { useEffect, useMemo, useRef, useState } from "react";
import { formatDate, formatDateTime } from "@/lib/utils";
import {
  Save,
  Plus,
  Search,
  AlertTriangle,
  CalendarClock,
  ShieldCheck,
  Pencil,
  Archive,
  ArchiveRestore,
  Syringe,
  CheckCircle2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { IddsiMatrix } from "./iddsi-matrix";
import { iddsiLevel } from "@/lib/iddsi";
import {
  type MedicationSchedule,
  type Participant,
  type ParticipantPatch,
} from "@/lib/data-store";
import { enqueue } from "@/lib/sync-queue";
import {
  useUpdateParticipant,
  useParticipantSchedules,
  useParticipantComplianceLogs,
  useTodaysComplianceLogs,
  useUpdateMedicationSchedule,
} from "@/hooks/use-supabase-data";
import { CarerNetworkPanel } from "./carer-network-panel";

import { usePendingScheduleMap } from "@/hooks/use-pending-schedules";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { ScheduledMedicationModal } from "@/components/medication/scheduled-medication-modal";
import { DiscontinueMedicationModal } from "@/components/medication/discontinue-medication-modal";
import {
  GiveDoseModal,
  findTodaysAdministrationLog,
} from "@/components/medication/give-dose-modal";
import { AttendanceTab } from "@/components/attendance/attendance-tab";
import { FinanceTab } from "@/components/finance/finance-tab";
import { toast } from "sonner";

interface Props {
  participant: Participant | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (p: Participant) => void;
}

export function CareProfileModal({ participant, open, onOpenChange, onSaved }: Props) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [ndisNumber, setNdisNumber] = useState("");
  const [streetAddress, setStreetAddress] = useState("");
  const [iddsi, setIddsi] = useState({ liquids: 0, foods: 7 });
  const [dirty, setDirty] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editMedSchedule, setEditMedSchedule] = useState<MedicationSchedule | null>(null);
  const [editMedOpen, setEditMedOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const online = useOnlineStatus();
  const updateMutation = useUpdateParticipant();
  const pending = usePendingScheduleMap();
  const medSectionRef = useRef<HTMLDivElement | null>(null);
  const [medPulse, setMedPulse] = useState(false);

  const scrollToMeds = () => {
    medSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setMedPulse(true);
    window.setTimeout(() => setMedPulse(false), 2200);
  };

  useEffect(() => {
    if (participant) {
      setFirstName(participant.firstName);
      setLastName(participant.lastName);
      setNdisNumber(participant.ndisNumber);
      setStreetAddress(participant.streetAddress ?? "");
      setIddsi(participant.iddsi);
      setDirty(false);
    }
  }, [participant]);

  if (!participant) return null;

  const liquid = iddsiLevel("liquids", iddsi.liquids);
  const food = iddsiLevel("foods", iddsi.foods);
  const isPending = pending.has(participant.id);


  const save = async () => {
    const patch: ParticipantPatch = {
      firstName,
      lastName,
      ndisNumber,
      streetAddress: streetAddress.trim() || null,
      iddsi,
    };
    if (!online) {
      enqueue("iddsi_change", { id: participant.id, patch: patch as unknown as Record<string, unknown> });
      toast.info("Queued offline", { description: "Profile changes will sync when back online." });
      setDirty(false);
      onOpenChange(false);
      return;
    }
    try {
      const updated = await updateMutation.mutateAsync({ id: participant.id, patch });
      toast.success("Profile updated", { description: `${updated.fullName} saved.` });
      onSaved?.(updated);
      setDirty(false);
      onOpenChange(false);
    } catch (err) {
      toast.error("Could not save profile", {
        description: (err as Error).message,
        className: "!bg-red-600 !text-white !border-red-700",
        duration: 12_000,
      });
    }
  };


  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-x-hidden flex flex-col border-border bg-card">
          <DialogHeader className="shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle className="truncate">{participant.fullName || "Participant"}</DialogTitle>
                <DialogDescription>
                  NDIS {participant.ndisNumber} · Updated {formatDate(participant.updatedAt)}
                </DialogDescription>
                {participant.streetAddress && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    📍 {participant.streetAddress}
                  </p>
                )}
              </div>
              {isPending && (
                <button
                  type="button"
                  onClick={scrollToMeds}
                  title="Jump to medication scheduling"
                  className="flex items-center gap-1.5 rounded-md border border-warning/50 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning transition-colors hover:bg-warning/20 focus:outline-none focus:ring-2 focus:ring-warning/60"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Scheduled Care Pending
                </button>
              )}
            </div>
          </DialogHeader>

          <Tabs defaultValue="profile" className="mt-2 flex flex-col flex-1 min-h-0 overflow-hidden">
            <TabsList className="w-full justify-start h-auto flex-wrap gap-2 flex-shrink-0 min-h-[44px]">
              <TabsTrigger value="profile" className="h-10 py-2 px-3">Care Profile</TabsTrigger>
              <TabsTrigger value="history" className="h-10 py-2 px-3">Care &amp; Medication History</TabsTrigger>
              <TabsTrigger value="attendance" className="h-10 py-2 px-3">Schedules &amp; Attendance</TabsTrigger>
              <TabsTrigger value="finance" className="h-10 py-2 px-3">Finance &amp; Ledger</TabsTrigger>
            </TabsList>

            {/* TAB 1 — Care Profile */}
            <TabsContent value="profile" className="flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto pr-1 pt-4 space-y-3">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                  <Field label="First name" className="sm:col-span-2">
                    <Input value={firstName} onChange={(e) => { setFirstName(e.target.value); setDirty(true); }} className="h-9" />
                  </Field>
                  <Field label="Last name" className="sm:col-span-2">
                    <Input value={lastName} onChange={(e) => { setLastName(e.target.value); setDirty(true); }} className="h-9" />
                  </Field>
                  <Field label="NDIS number" className="sm:col-span-1">
                    <Input value={ndisNumber} onChange={(e) => { setNdisNumber(e.target.value); setDirty(true); }} className="h-9 max-w-[180px]" />
                  </Field>
                  <Field label="Street address" className="sm:col-span-4">
                    <Input
                      value={streetAddress}
                      onChange={(e) => { setStreetAddress(e.target.value); setDirty(true); }}
                      placeholder="e.g. 42 Wattle Street, Parramatta NSW"
                      className="h-9"
                    />
                  </Field>
                </div>

                <CarerNetworkPanel
                  participantId={participant.id}
                  participantName={participant.fullName}
                />

                <div
                  ref={medSectionRef}
                  id="medication-scheduling-section"
                  className={
                    "scroll-mt-4 rounded-lg transition-all duration-700 " +
                    (medPulse
                      ? "ring-2 ring-warning ring-offset-2 ring-offset-card shadow-[0_0_0_4px_rgba(245,158,11,0.25)] animate-pulse"
                      : "ring-0")
                  }
                >
                  <SchedulingTab
                    participantId={participant.id}
                    participantName={participant.fullName}
                    onAdd={() => setScheduleOpen(true)}
                    onEdit={(s) => {
                      setEditMedSchedule(s);
                      setEditMedOpen(true);
                    }}
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    IDDSI summary
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {liquid && (
                      <div className={`rounded-md px-2 py-1 text-xs font-semibold ${liquid.swatch} ${liquid.text}`}>
                        Liquids · L{liquid.level} {liquid.name}
                      </div>
                    )}
                    {food && (
                      <div className={`rounded-md px-2 py-1 text-xs font-semibold ${food.swatch} ${food.text}`}>
                        Foods · L{food.level} {food.name}
                      </div>
                    )}
                  </div>
                </div>

                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="iddsi-edit" className="border-border">
                    <AccordionTrigger className="text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:no-underline">
                      Modify IDDSI Nutrition Levels
                    </AccordionTrigger>
                    <AccordionContent className="pt-2">
                      <IddsiMatrix
                        liquids={iddsi.liquids}
                        foods={iddsi.foods}
                        onChange={(next) => { setIddsi(next); setDirty(true); }}
                      />
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>

              <DialogFooter className="mt-1 shrink-0">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
                <Button onClick={save} disabled={!dirty || updateMutation.isPending} className="gap-1.5">
                  <Save className="h-4 w-4" />
                  {updateMutation.isPending ? "Saving…" : online ? "Save changes" : "Queue offline"}
                </Button>
              </DialogFooter>
            </TabsContent>

            {/* TAB 2 — History */}
            <TabsContent value="history" className="flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto pr-1 pt-4">
                <HistoryTab
                  participantId={participant.id}
                  query={historyQuery}
                  onQueryChange={setHistoryQuery}
                />
              </div>
            </TabsContent>

            {/* TAB 4 — Schedules & Attendance */}
            <TabsContent value="attendance" className="flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto pr-1 pt-4">
                <AttendanceTab
                  participantId={participant.id}
                  participantName={participant.fullName}
                />
              </div>
            </TabsContent>

            {/* TAB 5 — Finance & Ledger */}
            <TabsContent value="finance" className="flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto pr-1 pt-4">
                <FinanceTab
                  participantId={participant.id}
                  participantName={participant.fullName}
                />
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <ScheduledMedicationModal
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        participantId={participant.id}
        participantName={participant.fullName}
      />
      <ScheduledMedicationModal
        open={editMedOpen}
        onOpenChange={(o) => {
          setEditMedOpen(o);
          if (!o) setEditMedSchedule(null);
        }}
        participantId={participant.id}
        participantName={participant.fullName}
        editing={editMedSchedule}
      />
    </>
  );
}

// ---------- Scheduling tab ----------

function SchedulingTab({
  participantId,
  participantName,
  onAdd,
  onEdit,
}: {
  participantId: string;
  participantName: string;
  onAdd: () => void;
  onEdit: (s: MedicationSchedule) => void;
}) {
  const { data: schedules = [], isLoading, error } = useParticipantSchedules(participantId);
  const { data: todaysLogs = [] } = useTodaysComplianceLogs();
  const restore = useUpdateMedicationSchedule();
  const [showArchived, setShowArchived] = useState(false);
  const [discontinueTarget, setDiscontinueTarget] = useState<MedicationSchedule | null>(null);
  const [giveDoseTarget, setGiveDoseTarget] = useState<MedicationSchedule | null>(null);

  const active = schedules.filter((s) => s.active);
  const visible = showArchived ? schedules : active;
  const archivedCount = schedules.length - active.length;

  const onRestore = async (s: MedicationSchedule) => {
    try {
      await restore.mutateAsync({ id: s.id, patch: { active: true } });
      toast.success("Medication restored", { description: `${s.medicationName} reactivated.` });
    } catch {
      /* handled */
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Expected routines</h3>
          <p className="text-xs text-muted-foreground">
            {isLoading
              ? "Loading…"
              : `${active.length} active schedule${active.length === 1 ? "" : "s"} for ${participantName}.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border border-border bg-card/60 px-3 py-1.5">
            <Switch
              id="show-archived-meds"
              checked={showArchived}
              onCheckedChange={setShowArchived}
            />
            <Label
              htmlFor="show-archived-meds"
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
          <Button onClick={onAdd} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Add Scheduled Medication
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {(error as Error).message}
        </div>
      )}

      {visible.length === 0 && !isLoading ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          <CalendarClock className="mx-auto mb-2 h-5 w-5" />
          {showArchived
            ? "No scheduled medications on file."
            : "No active medications. Toggle Show archived to view past configurations."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Medication</th>
                <th className="px-4 py-2 font-medium">Dosage</th>
                <th className="px-4 py-2 font-medium">Expected time</th>
                <th className="px-4 py-2 font-medium">Frequency</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr
                  key={s.id}
                  className={
                    "border-t border-border " +
                    (s.active ? "" : "bg-muted/30 text-muted-foreground")
                  }
                >
                  <td className="px-4 py-2 font-medium">{s.medicationName}</td>
                  <td className="px-4 py-2 text-muted-foreground">{s.dosage}</td>
                  <td className="px-4 py-2 tabular-nums">{s.expectedTime.slice(0, 5)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{s.frequency}</td>
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
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      {s.active && (() => {
                        const log = findTodaysAdministrationLog(s, todaysLogs);
                        if (log) {
                          const ts = new Date(log.timestamp);
                          const hhmm = `${String(ts.getHours()).padStart(2, "0")}:${String(ts.getMinutes()).padStart(2, "0")}`;
                          const meta = log.metadata as Record<string, unknown>;
                          const status = String(meta.status ?? "Administered");
                          const isGreen = status === "Administered";
                          return (
                            <span
                              title="Already recorded today — see Care & Medication History for details"
                              className={
                                "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-white " +
                                (isGreen ? "bg-success" : "bg-warning")
                              }
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {status} {hhmm}
                            </span>
                          );
                        }
                        return (
                          <Button
                            size="sm"
                            onClick={() => setGiveDoseTarget(s)}
                            className="gap-1 bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-500"
                            title="Record a dual-witnessed administration"
                          >
                            <Syringe className="h-3.5 w-3.5" />
                            Give Dose
                          </Button>
                        );
                      })()}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1"
                        onClick={() => onEdit(s)}
                        title="Edit this medication"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                      {s.active ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1 text-destructive hover:text-destructive"
                          onClick={() => setDiscontinueTarget(s)}
                          title="Discontinue this routine (dual sign-off required)"
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

      <DiscontinueMedicationModal
        open={!!discontinueTarget}
        onOpenChange={(o) => {
          if (!o) setDiscontinueTarget(null);
        }}
        schedule={discontinueTarget}
      />

      <GiveDoseModal
        open={!!giveDoseTarget}
        onOpenChange={(o) => {
          if (!o) setGiveDoseTarget(null);
        }}
        schedule={giveDoseTarget}
        participantName={participantName}
      />
    </div>
  );
}


// ---------- History tab ----------

function HistoryTab({
  participantId,
  query,
  onQueryChange,
}: {
  participantId: string;
  query: string;
  onQueryChange: (v: string) => void;
}) {
  const { data: logs = [], isLoading, error, refetch, isFetching } = useParticipantComplianceLogs(participantId);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return logs;
    return logs.filter((l) => {
      const meta = l.metadata as Record<string, unknown>;
      const hay = [
        l.witness1,
        l.witness2,
        l.actionPerformed,
        String(meta.medication_name ?? ""),
        String(meta.dosage ?? ""),
        String(meta.notes ?? meta.medication_notes ?? ""),
      ].join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [logs, query]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search by medication, witness, or notes…"
            className="h-9 pl-9"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading history…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          <ShieldCheck className="mx-auto mb-2 h-5 w-5" />
          {query ? `No log entries match "${query}".` : "No medication or care logs yet."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Date / time</th>
                <th className="px-4 py-2 font-medium">Medication &amp; notes</th>
                <th className="px-4 py-2 font-medium">Witness 1</th>
                <th className="px-4 py-2 font-medium">Witness 2</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => {
                const meta = l.metadata as Record<string, unknown>;
                const name = String(meta.medication_name ?? "—");
                const dose = String(meta.dosage ?? "");
                const notes = String(meta.notes ?? meta.medication_notes ?? "");
                const ts = new Date(l.timestamp);
                return (
                  <tr key={l.id} className="border-t border-border align-top">
                    <td className="px-4 py-2 tabular-nums text-muted-foreground whitespace-nowrap">
                      {formatDateTime(ts)}
                    </td>
                    <td className="px-4 py-2">
                      <div className="font-medium">{name}{dose && <span className="text-muted-foreground"> · {dose}</span>}</div>
                      {notes && <div className="mt-0.5 text-xs text-muted-foreground">{notes}</div>}
                    </td>
                    <td className="px-4 py-2">{l.witness1 ?? "—"}</td>
                    <td className="px-4 py-2">{l.witness2 ?? "—"}</td>
                    <td className="px-4 py-2 text-right">
                      <span className="rounded bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {l.actionPerformed}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`grid gap-1.5 ${className ?? ""}`}>
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
