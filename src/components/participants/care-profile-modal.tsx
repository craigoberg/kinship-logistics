import { useEffect, useMemo, useState } from "react";
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
  useArchiveMedicationSchedule,
  useUpdateMedicationSchedule,
} from "@/hooks/use-supabase-data";
import { CarerNetworkPanel } from "./carer-network-panel";

import { usePendingScheduleMap } from "@/hooks/use-pending-schedules";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { ScheduledMedicationModal } from "@/components/medication/scheduled-medication-modal";
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
  // Primary carer state
  const [carerName, setCarerName] = useState("");
  const [carerPhone, setCarerPhone] = useState("");
  const [carerEmail, setCarerEmail] = useState("");
  const [carerAddress, setCarerAddress] = useState("");
  const [carerRelationship, setCarerRelationship] = useState("");
  const online = useOnlineStatus();
  const updateMutation = useUpdateParticipant();
  const upsertCarer = useUpsertPrimaryCarer();
  const { data: primaryCarer } = usePrimaryCarer(participant?.id ?? null);
  const pending = usePendingScheduleMap();

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

  useEffect(() => {
    setCarerName(primaryCarer?.fullName ?? "");
    setCarerPhone(primaryCarer?.phone ?? "");
    setCarerEmail(primaryCarer?.email ?? "");
    setCarerAddress(primaryCarer?.streetAddress ?? "");
    setCarerRelationship(primaryCarer?.relationship ?? "");
  }, [primaryCarer]);

  if (!participant) return null;

  const liquid = iddsiLevel("liquids", iddsi.liquids);
  const food = iddsiLevel("foods", iddsi.foods);
  const isPending = pending.has(participant.id);

  const carerDirty =
    (carerName.trim() || "") !== (primaryCarer?.fullName ?? "") ||
    (carerPhone.trim() || "") !== (primaryCarer?.phone ?? "") ||
    (carerEmail.trim() || "") !== (primaryCarer?.email ?? "") ||
    (carerAddress.trim() || "") !== (primaryCarer?.streetAddress ?? "") ||
    (carerRelationship.trim() || "") !== (primaryCarer?.relationship ?? "");

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
      if (carerDirty && carerName.trim().length > 0) {
        await upsertCarer.mutateAsync({
          participantId: participant.id,
          payload: {
            fullName: carerName.trim(),
            phone: carerPhone.trim() || null,
            email: carerEmail.trim() || null,
            streetAddress: carerAddress.trim() || null,
            relationship: carerRelationship.trim() || null,
            notes: null,
          },
        });
      }
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
        <DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto border-border bg-card">
          <DialogHeader>
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
                <div className="flex items-center gap-1.5 rounded-md border border-warning/50 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Scheduled Care Pending
                </div>
              )}
            </div>
          </DialogHeader>

          <Tabs defaultValue="profile" className="mt-2">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="profile">Care Profile</TabsTrigger>
              <TabsTrigger value="scheduling">Medication Scheduling</TabsTrigger>
              <TabsTrigger value="history">Care &amp; Medication History</TabsTrigger>
              <TabsTrigger value="attendance">Schedules &amp; Attendance</TabsTrigger>
              <TabsTrigger value="finance">Finance &amp; Ledger</TabsTrigger>
            </TabsList>

            {/* TAB 1 — Care Profile */}
            <TabsContent value="profile" className="space-y-4 pt-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="First name">
                  <Input value={firstName} onChange={(e) => { setFirstName(e.target.value); setDirty(true); }} />
                </Field>
                <Field label="Last name">
                  <Input value={lastName} onChange={(e) => { setLastName(e.target.value); setDirty(true); }} />
                </Field>
                <Field label="NDIS number">
                  <Input value={ndisNumber} onChange={(e) => { setNdisNumber(e.target.value); setDirty(true); }} />
                </Field>
                <Field label="Street address" className="sm:col-span-2">
                  <Input
                    value={streetAddress}
                    onChange={(e) => { setStreetAddress(e.target.value); setDirty(true); }}
                    placeholder="e.g. 42 Wattle Street, Parramatta NSW"
                  />
                </Field>
              </div>

              <div className="rounded-lg border-2 border-destructive/30 bg-destructive/5 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-destructive">
                      Primary Carer &amp; Emergency Network
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Saved as the participant's primary emergency contact.
                    </div>
                  </div>
                  {primaryCarer && (
                    <span className="rounded-full bg-destructive px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-destructive-foreground">
                      On file
                    </span>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Carer name" className="sm:col-span-2">
                    <Input
                      value={carerName}
                      onChange={(e) => setCarerName(e.target.value)}
                      placeholder="e.g. Maria Costa"
                    />
                  </Field>
                  <Field label="Phone">
                    <Input
                      value={carerPhone}
                      onChange={(e) => setCarerPhone(e.target.value)}
                      placeholder="+61 …"
                    />
                  </Field>
                  <Field label="Relationship">
                    <Input
                      value={carerRelationship}
                      onChange={(e) => setCarerRelationship(e.target.value)}
                      placeholder="Mother, Spouse, Support Coordinator…"
                    />
                  </Field>
                  <Field label="Email" className="sm:col-span-2">
                    <Input
                      type="email"
                      value={carerEmail}
                      onChange={(e) => setCarerEmail(e.target.value)}
                    />
                  </Field>
                  <Field label="Address" className="sm:col-span-2">
                    <Input
                      value={carerAddress}
                      onChange={(e) => setCarerAddress(e.target.value)}
                    />
                  </Field>
                </div>
              </div>


              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  IDDSI summary
                </div>
                <div className="flex flex-wrap gap-2">
                  {liquid && (
                    <div className={`rounded-md px-3 py-1.5 text-xs font-semibold ${liquid.swatch} ${liquid.text}`}>
                      Liquids · L{liquid.level} {liquid.name}
                    </div>
                  )}
                  {food && (
                    <div className={`rounded-md px-3 py-1.5 text-xs font-semibold ${food.swatch} ${food.text}`}>
                      Foods · L{food.level} {food.name}
                    </div>
                  )}
                </div>
              </div>

              <IddsiMatrix
                liquids={iddsi.liquids}
                foods={iddsi.foods}
                onChange={(next) => { setIddsi(next); setDirty(true); }}
              />

              <DialogFooter className="mt-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
                <Button onClick={save} disabled={(!dirty && !carerDirty) || updateMutation.isPending || upsertCarer.isPending} className="gap-1.5">
                  <Save className="h-4 w-4" />
                  {updateMutation.isPending ? "Saving…" : online ? "Save changes" : "Queue offline"}
                </Button>
              </DialogFooter>
            </TabsContent>

            {/* TAB 2 — Medication Scheduling */}
            <TabsContent value="scheduling" className="pt-4">
              <SchedulingTab
                participantId={participant.id}
                participantName={participant.fullName}
                onAdd={() => setScheduleOpen(true)}
                onEdit={(s) => {
                  setEditMedSchedule(s);
                  setEditMedOpen(true);
                }}
              />

            </TabsContent>

            {/* TAB 3 — History */}
            <TabsContent value="history" className="pt-4">
              <HistoryTab
                participantId={participant.id}
                query={historyQuery}
                onQueryChange={setHistoryQuery}
              />
            </TabsContent>

            {/* TAB 4 — Schedules & Attendance */}
            <TabsContent value="attendance" className="pt-4">
              <AttendanceTab
                participantId={participant.id}
                participantName={participant.fullName}
              />
            </TabsContent>

            {/* TAB 5 — Finance & Ledger */}
            <TabsContent value="finance" className="pt-4">
              <FinanceTab
                participantId={participant.id}
                participantName={participant.fullName}
              />
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
  const archive = useArchiveMedicationSchedule();
  const restore = useUpdateMedicationSchedule();
  const [showArchived, setShowArchived] = useState(false);

  const active = schedules.filter((s) => s.active);
  const visible = showArchived ? schedules : active;
  const archivedCount = schedules.length - active.length;

  const onArchive = async (s: MedicationSchedule) => {
    try {
      await archive.mutateAsync(s.id);
      toast.success("Medication archived", { description: `${s.medicationName} marked inactive.` });
    } catch {
      /* handled in hook */
    }
  };

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
                    <div className="flex items-center justify-end gap-1">
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
