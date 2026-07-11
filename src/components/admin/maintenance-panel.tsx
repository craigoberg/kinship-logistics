/**
 * MaintenancePanel — Governance Hub "Maintenance & Repairs" tab
 *
 * Matches the Human Incidents + Compliance & Renewals UX pattern:
 *   Active / Deferred sub-tabs · Search · Category + Severity filters
 *   Manage dialog (ManageItemShell) with notes timeline + defer + resolve
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { FormattedDateTime } from "@/components/ui/formatted-time";
import { ManageItemShell } from "@/components/governance/manage-item-shell";
import { MIN_TIMELINE_NOTE } from "@/lib/governance/constants";
import { defaultDeferIso } from "@/lib/governance/default-defer-iso";
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

const STATUS_BADGE: Record<string, string> = {
  open: "bg-orange-500 text-white",
  in_progress: "bg-sky-600 text-white",
  deferred: "bg-amber-500 text-black",
  resolved: "bg-green-600 text-white",
  closed: "bg-slate-500 text-white",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  deferred: "Deferred",
  resolved: "Resolved",
  closed: "Closed",
};

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

  useEffect(() => {
    if (open) {
      setNote("");
      setDeferOn(false);
      setDeferAt(defaultDeferIso());
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
    // Initial log line from item creation
    const created = new Date(item.createdAt).toLocaleString("en-AU", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
    const createdLine = `[${created}${item.reportedBy ? ` · ${item.reportedBy}` : ""}] Item logged — ${item.description}`;
    return [createdLine, ...lines];
  }, [notesQuery.data, item]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: MAINTENANCE_ITEMS_KEY });
    qc.invalidateQueries({ queryKey: maintenanceNotesKey(item.id) });
  };

  const getAuthor = async () => {
    const id = getStaffId() || (await resolveStaffIdWithFallback());
    return staffName(id);
  };

  const noteOk = note.trim().length >= MIN_TIMELINE_NOTE;
  const deferValid = !deferOn || (deferAt.length > 0 && !Number.isNaN(Date.parse(deferAt)));

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
      toast.success(kind === "defer" ? "Item deferred." : "Note added to timeline.");
    },
    onError: (e: Error) => toast.error("Action failed", { description: e.message }),
  });

  const startMut = useMutation({
    mutationFn: async () => {
      const author = await getAuthor();
      await updateMaintenanceStatus(item.id, "in_progress");
      await addMaintenanceNote(item.id, "Work started.", author);
    },
    onSuccess: () => {
      invalidate();
      toast.success("Marked as In Progress.");
    },
    onError: (e: Error) => toast.error("Update failed", { description: e.message }),
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
      toast.success("Item marked as resolved.");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error("Resolve failed", { description: e.message }),
  });

  const closeMut = useMutation({
    mutationFn: async () => {
      const author = await getAuthor();
      await updateMaintenanceStatus(item.id, "closed");
      await addMaintenanceNote(item.id, "Item closed.", author);
    },
    onSuccess: () => {
      invalidate();
      toast.success("Item closed.");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error("Close failed", { description: e.message }),
  });

  const busy =
    logMut.isPending ||
    startMut.isPending ||
    resolveMut.isPending ||
    closeMut.isPending;

  const canLog = noteOk && deferValid && !busy;
  const canResolve = noteOk && !deferOn && !busy;

  const contextCard = (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={SEV_BADGE[item.severity]}>{item.severity.toUpperCase()}</Badge>
        <Badge className={SOURCE_BADGE[item.source]}>{SOURCE_LABELS[item.source]}</Badge>
        <Badge className={STATUS_BADGE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
        {item.deferredUntil && item.status === "deferred" && (
          <span className="text-xs text-amber-600 font-medium">
            ↻ Deferred to {item.deferredUntil}
            {item.deferCount > 1 && ` (×${item.deferCount})`}
          </span>
        )}
      </div>
      <p className="font-medium leading-snug">{item.title}</p>
      {item.description !== item.title && (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap">{item.description}</p>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {item.locationLabel && (
          <>
            <span className="font-medium text-foreground/70">Location</span>
            <span>{item.locationLabel}</span>
          </>
        )}
        {item.reportedBy && (
          <>
            <span className="font-medium text-foreground/70">Reported by</span>
            <span>{item.reportedBy}</span>
          </>
        )}
        {item.assignedTo && (
          <>
            <span className="font-medium text-foreground/70">Assigned to</span>
            <span>{item.assignedTo}</span>
          </>
        )}
        <span className="font-medium text-foreground/70">Logged</span>
        <span><FormattedDateTime value={item.createdAt} /></span>
        {item.resolvedAt && (
          <>
            <span className="font-medium text-foreground/70">Resolved</span>
            <span><FormattedDateTime value={item.resolvedAt} /></span>
          </>
        )}
      </div>
    </div>
  );

  return (
    <ManageItemShell
      open={open}
      onOpenChange={(o) => { if (busy) return; if (!o) setNote(""); onOpenChange(o); }}
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
      showEscalate={false}
      onLogUpdate={() => logMut.mutate()}
      logUpdateLabel={deferOn ? "Defer Item" : "Log Note"}
      canLog={canLog}
      onResolveClose={
        item.status !== "resolved" && item.status !== "closed"
          ? () => resolveMut.mutate()
          : undefined
      }
      resolveCloseLabel="Mark Resolved"
      canResolve={canResolve}
      extraFooterStart={
        <div className="flex gap-2">
          {item.status === "open" && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => startMut.mutate()}
            >
              {startMut.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Start Work
            </Button>
          )}
          {item.status === "resolved" && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => closeMut.mutate()}
            >
              {closeMut.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Close
            </Button>
          )}
        </div>
      }
    />
  );
}

// ── Add item dialog ────────────────────────────────────────────────────────────

function AddItemDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<MaintenanceSeverity>("yellow");
  const [locationLabel, setLocationLabel] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const id = getStaffId() || (await resolveStaffIdWithFallback());
      return createMaintenanceItem({
        title: title.trim(),
        description: description.trim(),
        severity,
        source: "manual",
        locationLabel: locationLabel.trim() || null,
        reportedBy: staffName(id),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MAINTENANCE_ITEMS_KEY });
      toast.success("Maintenance item added.");
      setTitle(""); setDescription(""); setSeverity("yellow"); setLocationLabel("");
      onClose();
    },
    onError: (e: Error) => toast.error("Could not add item", { description: e.message }),
  });

  const canSubmit = title.trim().length >= 5 && description.trim().length >= 10;

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
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Title</Label>
            <Input placeholder="e.g. Toilet 2 tap leaking" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</Label>
            <Textarea rows={3} placeholder="Describe what needs repairing." value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Severity</Label>
            <div className="flex flex-wrap gap-2">
              {(["red", "yellow", "green"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeverity(s)}
                  data-active={severity === s}
                  className={
                    s === "red"
                      ? "rounded-full border px-3 py-1 text-xs font-semibold transition border-red-600/60 bg-red-600/10 text-red-700 data-[active=true]:bg-red-600 data-[active=true]:text-white"
                      : s === "yellow"
                        ? "rounded-full border px-3 py-1 text-xs font-semibold transition border-yellow-500/60 bg-yellow-500/10 text-yellow-700 data-[active=true]:bg-yellow-400 data-[active=true]:text-black"
                        : "rounded-full border px-3 py-1 text-xs font-semibold transition border-green-600/60 bg-green-600/10 text-green-700 data-[active=true]:bg-green-600 data-[active=true]:text-white"
                  }
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Location (optional)</Label>
            <Input placeholder="e.g. Main hall, Toilet block 3" value={locationLabel} onChange={(e) => setLocationLabel(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Add Item
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Items table ───────────────────────────────────────────────────────────────

interface ItemsTableProps {
  tab: MaintenanceTabFilter;
  onManage: (item: MaintenanceItem) => void;
}

function ItemsTable({ tab, onManage }: ItemsTableProps) {
  const [categoryFilter, setCategoryFilter] = useState<MaintenanceSource | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<MaintenanceSeverity | "all">("all");
  const [search, setSearch] = useState("");

  const { data: items = [], isLoading, isFetching } = useQuery({
    queryKey: [...MAINTENANCE_ITEMS_KEY, tab, severityFilter, categoryFilter],
    queryFn: () =>
      listMaintenanceItems({
        tab,
        severity: severityFilter === "all" ? undefined : severityFilter,
        source: categoryFilter === "all" ? undefined : categoryFilter,
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
    active: "Open items and any overdue deferrals needing attention now.",
    deferred: "Items parked until a future date. They return to Active automatically when their date arrives.",
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

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Severity</TableHead>
              <TableHead className="hidden sm:table-cell w-36">Category</TableHead>
              <TableHead>Issue</TableHead>
              <TableHead className="hidden lg:table-cell w-40">Logged</TableHead>
              <TableHead className="hidden md:table-cell">Location / Reporter</TableHead>
              <TableHead className="hidden lg:table-cell w-40">Updated</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="text-right w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  {tab === "active"
                    ? "No open items — good news!"
                    : tab === "deferred"
                      ? "Nothing deferred."
                      : "No items match your filter."}
                </TableCell>
              </TableRow>
            )}
            {visible.map((item) => (
              <TableRow key={item.id} className="align-top cursor-pointer hover:bg-muted/30" onClick={() => onManage(item)}>
                <TableCell className="pt-3">
                  <Badge className={SEV_BADGE[item.severity]}>{item.severity.toUpperCase()}</Badge>
                </TableCell>
                <TableCell className="hidden sm:table-cell pt-3">
                  <Badge className={SOURCE_BADGE[item.source]}>{SOURCE_LABELS[item.source]}</Badge>
                </TableCell>
                <TableCell className="max-w-xs">
                  <p className="font-medium text-sm leading-tight">{item.title}</p>
                  {item.description !== item.title && (
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{item.description}</p>
                  )}
                  {item.deferredUntil && item.status === "deferred" && (
                    <p className="mt-1 text-xs text-amber-600 font-medium">
                      ↻ Deferred to {item.deferredUntil}
                    </p>
                  )}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-xs text-muted-foreground pt-3">
                  <FormattedDateTime value={item.createdAt} />
                </TableCell>
                <TableCell className="hidden md:table-cell text-xs text-muted-foreground pt-3">
                  {item.locationLabel && <div>{item.locationLabel}</div>}
                  {item.reportedBy && <div className="text-muted-foreground/70">{item.reportedBy}</div>}
                  {!item.locationLabel && !item.reportedBy && "—"}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-xs text-muted-foreground pt-3">
                  <FormattedDateTime value={item.updatedAt} />
                </TableCell>
                <TableCell className="pt-3">
                  <Badge className={STATUS_BADGE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
                </TableCell>
                <TableCell className="text-right pt-2.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={(e) => { e.stopPropagation(); onManage(item); }}
                  >
                    Manage
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
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
      <div className="flex items-center justify-between gap-2">
        <div /> {/* spacer */}
        <Button size="sm" onClick={() => setAddOpen(true)} className="h-8 text-xs">
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add Item
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as MaintenanceTabFilter)}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="deferred">Deferred</TabsTrigger>
          <TabsTrigger value="resolved">Resolved</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4">
          <ItemsTable tab="active" onManage={setManaging} />
        </TabsContent>
        <TabsContent value="deferred" className="mt-4">
          <ItemsTable tab="deferred" onManage={setManaging} />
        </TabsContent>
        <TabsContent value="resolved" className="mt-4">
          <ItemsTable tab="resolved" onManage={setManaging} />
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
