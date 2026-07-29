/**
 * MaintenancePanel — Governance Hub "Maintenance & Repairs" tab
 *
 * Matches the Human Incidents + Compliance & Renewals UX pattern:
 *   Active / Deferred sub-tabs · Search · Category + Severity filters
 *   Manage dialog (ManageItemShell) with notes timeline + defer + resolve
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { FormattedDateTime } from "@/components/ui/formatted-time";
import { HubListCard } from "@/components/governance/hub-list-card";
import { HubListCardBody } from "@/components/governance/hub-list-card-body";
import { HubContextMetaGrid, HubListMetaRows } from "@/components/governance/hub-context-meta-grid";
import { maintenanceItemBodyLines } from "@/lib/governance/hub-maintenance-item-body";
import { ManageItemShell } from "@/components/governance/manage-item-shell";
import { RYGE_SEVERITY_CHIPS } from "@/lib/ui/ryge-severity-chips";
import { operationToasts } from "@/lib/ui/operation-toasts";
import {
  findHubReviewStartedNote,
  formatHubWaitDuration,
  isHubReviewStarted,
} from "@/lib/governance/hub-review-started";
import {
  computeHubUrgency,
  HUB_WORKFLOW_STATUS_BADGE,
  HUB_WORKFLOW_STATUS_LABEL,
  maintenanceWorkflowStatus,
} from "@/lib/governance/hub-workflow-status";
import { useMaintenanceUrgencyParams } from "@/hooks/use-system-parameters";
import { MIN_TIMELINE_NOTE } from "@/lib/governance/constants";
import { defaultDeferIso } from "@/lib/governance/default-defer-iso";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { PinReauthDialog } from "@/components/auth/pin-reauth-dialog";
import { isManagerProfile } from "@/lib/governance/is-manager";
import { resolveStaffIdWithFallback, getStaffId, resolveStaffDisplayName } from "@/lib/data-store";
import {
  addMaintenanceNote,
  createMaintenanceItem,
  deferMaintenanceItem,
  listMaintenanceItems,
  listMaintenanceNotes,
  renderMaintenanceNote,
  updateMaintenanceStatus,
  MAINTENANCE_ITEMS_KEY,
  maintenanceNotesKey,
  type MaintenanceItem,
  type MaintenanceNote,
  type MaintenanceSource,
  type MaintenanceSeverity,
  type MaintenanceTabFilter,
} from "@/lib/api/maintenance";

// ── Constants ─────────────────────────────────────────────────────────────────

const SEV_BADGE: Record<MaintenanceSeverity, string> = {
  red: "bg-red-600 text-white",
  yellow: "bg-yellow-400 text-black",
  green: "bg-green-600 text-white",
};

const STATUS_BADGE = HUB_WORKFLOW_STATUS_BADGE;
const STATUS_LABEL = HUB_WORKFLOW_STATUS_LABEL;

const SOURCE_BADGE: Record<MaintenanceSource, string> = {
  venue_issue:    "bg-violet-600 text-white",
  centre_issue:   "bg-blue-600 text-white",
  vehicle_issue:  "bg-sky-600 text-white",
  incident_fault: "bg-amber-600 text-white",
  manual:         "bg-slate-500 text-white",
};

const SOURCE_LABELS: Record<MaintenanceSource, string> = {
  venue_issue:    "Venue Walkround",
  centre_issue:   "Centre Walkround",
  vehicle_issue:  "Vehicle Walkround",
  incident_fault: "Incident / Fault",
  manual:         "Manual",
};

function staffName(id: string): string {
  return resolveStaffDisplayName(id);
}

// ── Manage Dialog ─────────────────────────────────────────────────────────────

interface ManageDialogProps {
  item: MaintenanceItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ManageMaintenanceDialog({ item, open, onOpenChange }: ManageDialogProps) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [deferOn, setDeferOn] = useState(false);
  const [deferAt, setDeferAt] = useState<string>(defaultDeferIso());
  const [deferDatetimeValid, setDeferDatetimeValid] = useState(true);
  const [pinOpen, setPinOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"resolve" | "close">("resolve");

  useEffect(() => {
    if (open) {
      setNote("");
      setDeferOn(false);
      setDeferAt(defaultDeferIso());
      setDeferDatetimeValid(true);
    }
  }, [open, item.id]);

  const notesQuery = useQuery({
    queryKey: maintenanceNotesKey(item.id),
    enabled: open,
    refetchInterval: 10_000,
    queryFn: () => listMaintenanceNotes(item.id),
  });

  const timelineLines = useMemo(() => {
    const notes: MaintenanceNote[] = notesQuery.data ?? [];
    const lines = notes.map(renderMaintenanceNote);
    const created = formatDateTime(item.createdAt);
    const createdLine = `[${created}${item.reportedBy ? ` · ${item.reportedBy}` : ""}] Item logged — ${item.description}`;
    return [createdLine, ...lines];
  }, [notesQuery.data, item]);

  const maintenanceNotesForReview = useMemo(
    () =>
      (notesQuery.data ?? []).map((n) => ({
        note: n.noteText,
        stampedAt: n.createdAt,
        metadata: null as Record<string, unknown> | null,
      })),
    [notesQuery.data],
  );
  const reviewStartedNote = useMemo(
    () => findHubReviewStartedNote(maintenanceNotesForReview),
    [maintenanceNotesForReview],
  );
  const reviewStarted =
    item.status === "in_progress" || isHubReviewStarted(maintenanceNotesForReview);
  const waitLabel = reviewStartedNote
    ? formatHubWaitDuration(item.createdAt, reviewStartedNote.stampedAt)
    : formatHubWaitDuration(item.createdAt, new Date().toISOString());

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: MAINTENANCE_ITEMS_KEY });
    qc.invalidateQueries({ queryKey: maintenanceNotesKey(item.id) });
  };

  const getAuthor = async () => {
    const id = getStaffId() || (await resolveStaffIdWithFallback());
    return staffName(id);
  };

  const noteOk = note.trim().length >= MIN_TIMELINE_NOTE;
  const deferValid = !deferOn || deferDatetimeValid;

  const logMut = useMutation({
    mutationFn: async () => {
      const author = await getAuthor();
      if (deferOn) {
        const dateOnly = deferAt.split("T")[0];
        await deferMaintenanceItem(item.id, dateOnly, note.trim(), author);
        return "defer" as const;
      }
      await addMaintenanceNote(item.id, note.trim(), author);
      return "note" as const;
    },
    onSuccess: (kind) => {
      invalidate();
      setNote("");
      setDeferOn(false);
      if (kind === "defer") {
        operationToasts.maintenanceDeferred();
      } else {
        operationToasts.noteLogged();
      }
    },
    onError: (e: Error) => operationToasts.actionFailed(e.message),
  });

  const startMut = useMutation({
    mutationFn: async () => {
      const author = await getAuthor();
      await updateMaintenanceStatus(item.id, "in_progress");
      await addMaintenanceNote(item.id, "Work started.", author);
    },
    onSuccess: () => {
      invalidate();
      const waitLabel = formatHubWaitDuration(item.createdAt, new Date().toISOString());
      operationToasts.reviewStarted(waitLabel);
    },
    onError: (e: Error) => operationToasts.actionFailed(e.message),
  });

  const resolveMut = useMutation({
    mutationFn: async () => {
      const author = await getAuthor();
      await updateMaintenanceStatus(item.id, "resolved", note.trim() || undefined);
      if (note.trim()) {
        await addMaintenanceNote(item.id, `Resolved. ${note.trim()}`, author);
      }
    },
    onSuccess: () => {
      invalidate();
      setNote("");
      operationToasts.maintenanceResolved();
      onOpenChange(false);
    },
    onError: (e: Error) => operationToasts.resolutionFailed(e.message),
  });

  const closeMut = useMutation({
    mutationFn: async () => {
      const author = await getAuthor();
      await updateMaintenanceStatus(item.id, "closed");
      await addMaintenanceNote(item.id, "Item closed.", author);
    },
    onSuccess: () => {
      invalidate();
      operationToasts.maintenanceClosed();
      onOpenChange(false);
    },
    onError: (e: Error) => operationToasts.actionFailed(e.message),
  });

  const autoStartRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      autoStartRef.current = null;
      return;
    }
    if (item.status !== "open") return;
    if (autoStartRef.current === item.id) return;
    autoStartRef.current = item.id;
    startMut.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per open session
  }, [open, item.id, item.status]);

  // startMut is a background housekeeping step (auto-transition open→in_progress).
  // It must NOT contribute to busy — that would lock the form while the silent
  // background call is in-flight and confuse the user.
  const busy =
    logMut.isPending ||
    resolveMut.isPending ||
    closeMut.isPending;

  const canLog = noteOk && deferValid && !busy;
  const canResolve = noteOk && !deferOn && !busy;

  const handleResolveClick = () => {
    if (!canResolve) return;
    setPendingAction("resolve");
    setPinOpen(true);
  };

  const handleCloseClick = () => {
    if (busy) return;
    setPendingAction("close");
    setPinOpen(true);
  };

  const handlePinAuthenticated = () => {
    if (!isManagerProfile()) {
      operationToasts.managerPinRequired();
      setPinOpen(false);
      return;
    }
    setPinOpen(false);
    if (pendingAction === "close") {
      closeMut.mutate();
    } else {
      resolveMut.mutate();
    }
  };

  const contextCard = (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={SEV_BADGE[item.severity]}>{item.severity.toUpperCase()}</Badge>
        <Badge className={SOURCE_BADGE[item.source]}>{SOURCE_LABELS[item.source]}</Badge>
        <Badge className={STATUS_BADGE[maintenanceWorkflowStatus(item.status)]}>
          {STATUS_LABEL[maintenanceWorkflowStatus(item.status)]}
        </Badge>
        {item.deferredUntil && item.status === "deferred" && (
          <span className="text-xs text-amber-600 font-medium">
            ↻ Deferred to {formatDate(item.deferredUntil)}
            {item.deferCount > 1 && ` (×${item.deferCount})`}
          </span>
        )}
      </div>
      <p className="font-medium leading-snug">{item.title}</p>
      {item.description !== item.title && (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap">{item.description}</p>
      )}
      <HubContextMetaGrid
        rows={[
          { label: "Location", value: item.locationLabel },
          { label: "Reported by", value: item.reportedBy ?? "Unknown staff" },
          { label: "Logged", value: <FormattedDateTime value={item.createdAt} /> },
          reviewStarted && reviewStartedNote
            ? {
                label: "Review started",
                value: (
                  <>
                    <FormattedDateTime value={reviewStartedNote.stampedAt} />
                    {waitLabel ? ` (${waitLabel} after logged)` : ""}
                  </>
                ),
              }
            : item.status !== "resolved" && item.status !== "closed"
              ? { label: "Waiting", value: `${waitLabel} since logged` }
              : { label: "Waiting", value: null },
          item.assignedTo
            ? { label: "Assigned to", value: item.assignedTo }
            : { label: "Assigned to", value: null },
          item.resolvedAt
            ? {
                label: "Resolved",
                value: <FormattedDateTime value={item.resolvedAt} />,
              }
            : { label: "Resolved", value: null },
        ]}
      />
    </div>
  );

  return (
    <>
    <ManageItemShell
      open={open}
      onOpenChange={(o) => {
        // Never block the close/X path — user must always be able to escape.
        // In-flight mutations will be abandoned naturally by React Query on unmount.
        if (!o) setNote("");
        onOpenChange(o);
      }}
      busy={busy}
      title="Manage Maintenance Item"
      description="Log progress notes, defer to a future date, or mark as resolved."
      contextCard={contextCard}
      timelineLines={timelineLines}
      timelineLoading={notesQuery.isFetching && !notesQuery.data}
      note={note}
      onNoteChange={setNote}
      noteLabel="Progress note"
      showDefer={item.status !== "resolved" && item.status !== "closed"}
      deferOn={deferOn}
      onDeferOnChange={setDeferOn}
      deferAt={deferAt}
      onDeferAtChange={setDeferAt}
      onDeferDatetimeValidChange={setDeferDatetimeValid}
      showEscalate={false}
      onLogUpdate={() => logMut.mutate()}
      logUpdateLabel={deferOn ? "Defer Item" : "Log Note"}
      canLog={canLog}
      onResolveClose={
        item.status !== "resolved" && item.status !== "closed"
          ? handleResolveClick
          : undefined
      }
      resolveCloseLabel="Mark Resolved"
      canResolve={canResolve}
      extraFooterStart={
        item.status === "resolved" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={handleCloseClick}
          >
            {closeMut.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Close Item
          </Button>
        ) : undefined
      }
    />
    <PinReauthDialog
      open={pinOpen}
      onOpenChange={setPinOpen}
      reason="Manager PIN required to resolve or close a maintenance item."
      onAuthenticated={handlePinAuthenticated}
    />
    </>
  );
}

// ── Add item dialog ────────────────────────────────────────────────────────────

function AddItemDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<MaintenanceSeverity>("yellow");
  const [workaround, setWorkaround] = useState("");
  const [managerName, setManagerName] = useState("");
  const [locationLabel, setLocationLabel] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const id = getStaffId() || (await resolveStaffIdWithFallback());
      // Build description with severity context
      let fullDescription = description.trim();
      if (severity === "yellow" && workaround.trim()) {
        fullDescription = `Workaround: ${workaround.trim()}\n\n${fullDescription}`.trim();
      }
      if (severity === "red" && managerName.trim()) {
        fullDescription = `Manager verbally notified: ${managerName.trim()}\n\n${fullDescription}`.trim();
      }
      return createMaintenanceItem({
        title: title.trim(),
        description: fullDescription,
        severity,
        source: "manual",
        locationLabel: locationLabel.trim() || null,
        reportedBy: staffName(id),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MAINTENANCE_ITEMS_KEY });
      operationToasts.maintenanceAdded();
      setTitle(""); setDescription(""); setSeverity("yellow");
      setWorkaround(""); setManagerName(""); setLocationLabel("");
      onClose();
    },
    onError: (e: Error) => operationToasts.actionFailed(e.message),
  });

  const workaroundOk = severity !== "yellow" || workaround.trim().length >= 5;
  const managerOk    = severity !== "red"    || managerName.trim().length >= 2;
  const canSubmit    = title.trim().length >= 5 && workaroundOk && managerOk && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-amber-500" />
            Add Maintenance Item
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Title *</Label>
            <Input placeholder="e.g. Toilet 2 tap leaking" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          {/* Severity selector */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Severity</Label>
            <div className="flex flex-wrap gap-2">
              {RYGE_SEVERITY_CHIPS.map((chip) => (
                <button
                  key={chip.value}
                  type="button"
                  onClick={() => setSeverity(chip.value as MaintenanceSeverity)}
                  className={cn(
                    "rounded-full border-2 px-4 py-1.5 text-xs font-bold transition",
                    severity === chip.value ? chip.activeClass : chip.idleClass,
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          {/* Yellow: workaround required */}
          {severity === "yellow" && (
            <div className="space-y-1">
              <Label className="text-xs font-semibold uppercase tracking-wide text-yellow-500">
                Workaround in place *
              </Label>
              <Textarea
                rows={2}
                placeholder="e.g. Toilet 2 out of order — redirect participants to Toilet 1."
                value={workaround}
                onChange={(e) => setWorkaround(e.target.value)}
                className={workaround.trim().length > 0 && workaround.trim().length < 5 ? "border-destructive" : ""}
              />
            </div>
          )}

          {/* Red: manager name required */}
          {severity === "red" && (
            <div className="rounded-md border border-red-600/40 bg-red-600/10 p-3 space-y-2">
              <p className="text-xs font-semibold text-red-400">
                RED items require verbal notification to a manager before logging.
              </p>
              <div className="space-y-1">
                <Label className="text-xs font-semibold uppercase tracking-wide text-red-400">
                  Manager verbally notified *
                </Label>
                <Input
                  placeholder="Manager's name"
                  value={managerName}
                  onChange={(e) => setManagerName(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description (optional)</Label>
            <Textarea rows={3} placeholder="Describe what needs repairing." value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Location (optional)</Label>
            <Input placeholder="e.g. Main hall, Toilet block 3" value={locationLabel} onChange={(e) => setLocationLabel(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSubmit}>
            {mutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Add Item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Items list (card rows) ────────────────────────────────────────────────────

interface ItemsListProps {
  tab: MaintenanceTabFilter;
  onManage: (item: MaintenanceItem) => void;
}

function ItemsList({ tab, onManage }: ItemsListProps) {
  const [categoryFilter, setCategoryFilter] = useState<MaintenanceSource | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<MaintenanceSeverity | "all">("all");
  const [search, setSearch] = useState("");
  const urgencyParams = useMaintenanceUrgencyParams();

  const { data: items = [], isLoading, isFetching } = useQuery({
    queryKey: [...MAINTENANCE_ITEMS_KEY, tab, severityFilter, categoryFilter, urgencyParams.deferRewarnMs],
    queryFn: () =>
      listMaintenanceItems({
        tab,
        severity: severityFilter === "all" ? undefined : severityFilter,
        source: categoryFilter === "all" ? undefined : categoryFilter,
        deferRewarnMs: urgencyParams.deferRewarnMs,
      }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((i) => {
      const hay = `${i.title} ${i.description} ${i.locationLabel ?? ""} ${i.reportedBy ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [items, search]);

  const tabDesc = {
    active: "Open items and any deferred items whose deadline is approaching or overdue.",
    deferred: "Items safely parked with a future deadline. They return to Active automatically when the deadline is near.",
    resolved: "Resolved and closed items — read-only history.",
    all: "All maintenance items regardless of status.",
  }[tab];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{tabDesc}</p>
        <div className="flex items-center gap-2">
          {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <Badge variant="secondary">{visible.length} {tab === "active" ? "open" : tab === "deferred" ? "deferred" : "items"}</Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Category</Label>
          <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as MaintenanceSource | "all")}>
            <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="venue_issue">Venue Walkround</SelectItem>
              <SelectItem value="centre_issue">Centre Walkround</SelectItem>
              <SelectItem value="vehicle_issue">Vehicle Walkround</SelectItem>
              <SelectItem value="incident_fault">Incident / Fault</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Severity</Label>
          <Select value={severityFilter} onValueChange={(v) => setSeverityFilter(v as MaintenanceSeverity | "all")}>
            <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="red">Red</SelectItem>
              <SelectItem value="yellow">Yellow</SelectItem>
              <SelectItem value="green">Green</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-[12rem] space-y-1">
          <Label className="text-xs text-muted-foreground">Search</Label>
          <Input
            className="h-8"
            placeholder="Search title, description, location, reporter…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
          {tab === "active"
            ? "No open items — good news!"
            : tab === "deferred"
              ? "Nothing deferred."
              : "No items match your filter."}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((item) => {
            const bodyLines = maintenanceItemBodyLines(item);
            const nowMs = Date.now();
            const lastActivityMs = item.lastNoteAt
              ? new Date(item.lastNoteAt).getTime()
              : null;
            const deferredUntilMs = item.deferredUntil
              ? new Date(item.deferredUntil).getTime()
              : null;
            const urgency = tab === "resolved" ? "none" : computeHubUrgency({
              nowMs,
              createdAtMs: new Date(item.createdAt).getTime(),
              lastActivityMs,
              deferredUntilMs,
              params: urgencyParams,
            });
            return (
            <HubListCard
              key={item.id}
              ariaLabel={`Manage ${bodyLines.issue}`}
              summary={bodyLines.issue}
              body={
                <HubListCardBody lines={bodyLines} severity={item.severity} />
              }
              onClick={() => onManage(item)}
              badges={
                <>
                  <Badge className={SEV_BADGE[item.severity]}>
                    {item.severity.toUpperCase()}
                  </Badge>
                  <Badge className={SOURCE_BADGE[item.source]}>
                    {SOURCE_LABELS[item.source]}
                  </Badge>
                </>
              }
              status={
                <Badge className={STATUS_BADGE[maintenanceWorkflowStatus(item.status)]}>
                  {STATUS_LABEL[maintenanceWorkflowStatus(item.status)]}
                </Badge>
              }
              urgency={urgency}
              meta={
                <HubListMetaRows
                  rows={[
                    ...(item.deferredUntil && item.status === "deferred"
                      ? [
                          {
                            label: "Deferred to",
                            value: formatDate(item.deferredUntil),
                          },
                        ]
                      : []),
                    { label: "Location", value: item.locationLabel },
                    { label: "Reported by", value: item.reportedBy ?? "Unknown staff" },
                    { label: "Logged", value: <FormattedDateTime value={item.createdAt} /> },
                    {
                      label: "Updated",
                      value: <FormattedDateTime value={item.updatedAt} />,
                    },
                  ]}
                />
              }
            />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function MaintenancePanel() {
  const [tab, setTab] = useState<MaintenanceTabFilter>("active");
  const [managing, setManaging] = useState<MaintenanceItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as MaintenanceTabFilter)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="deferred">Deferred</TabsTrigger>
            <TabsTrigger value="resolved">Resolved</TabsTrigger>
          </TabsList>
          <Button size="sm" onClick={() => setAddOpen(true)} className="h-8 text-xs">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Item
          </Button>
        </div>

        <TabsContent value="active" className="mt-4">
          <ItemsList tab="active" onManage={setManaging} />
        </TabsContent>
        <TabsContent value="deferred" className="mt-4">
          <ItemsList tab="deferred" onManage={setManaging} />
        </TabsContent>
        <TabsContent value="resolved" className="mt-4">
          <ItemsList tab="resolved" onManage={setManaging} />
        </TabsContent>
      </Tabs>

      {managing && (
        <ManageMaintenanceDialog
          key={managing.id}
          item={managing}
          open
          onOpenChange={(o) => { if (!o) setManaging(null); }}
        />
      )}

      <AddItemDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
