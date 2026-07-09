/**
 * Venues Management workspace — GUARDRAILS §12.2
 *
 * Tabs:
 *   Registry  — list all venues; create / edit / archive / clone
 *   [selected venue] — template fields + baseline sign-off history
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { CharacterCountedInput } from "@/components/ui/character-counted-input";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import { verifyManagerPin } from "@/components/auth/pin-verify";
import { getActiveUserProfile } from "@/lib/data-store";
import { FormattedDateTime } from "@/components/ui/formatted-time";
import { invalidateEventDayCaches } from "@/lib/query/invalidation";
import { VenueComplianceTab } from "./venue-compliance-tab";
import {
  addVenueTemplateField,
  archiveVenue,
  cloneVenue,
  deleteVenueTemplateField,
  getLatestBaselineSignoff,
  listBaselineSignoffs,
  listVenueTemplateFields,
  listVenues,
  submitBaselineSignoff,
  updateVenueTemplateField,
  upsertVenue,
  type AnswerType,
  type BaselineSignoffAnswer,
  type RiskTier,
  type Venue,
  type VenueSafetyBaselineSignoff,
  type VenueTemplateField,
} from "@/lib/api/venues";
import { MIN_EVIDENCE } from "@/lib/governance/constants";

// ─── Query keys ────────────────────────────────────────────────────────────

const VENUES_KEY = ["venues", "all"] as const;
const venueFieldsKey = (id: string) => ["venue-template-fields", id] as const;
const venueSignoffsKey = (id: string) => ["venue-baseline-signoffs", id] as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function riskBadge(tier: RiskTier) {
  if (tier === "high")
    return <Badge className="bg-destructive text-destructive-foreground">High</Badge>;
  if (tier === "medium")
    return <Badge className="bg-yellow-500 text-black">Medium</Badge>;
  return <Badge className="bg-emerald-600 text-white">Low</Badge>;
}

function statusBadge(status: Venue["status"]) {
  if (status === "archived")
    return <Badge variant="secondary">Archived</Badge>;
  return <Badge className="bg-emerald-600 text-white">Active</Badge>;
}

// ─── Main workspace ─────────────────────────────────────────────────────────

export function VenuesWorkspace() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"active" | "all">("active");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Venue | null>(null);

  // Create / edit
  const [editing, setEditing] = useState<Venue | "new" | null>(null);
  // Clone
  const [cloneSource, setCloneSource] = useState<Venue | null>(null);
  // Archive confirm
  const [archiveTarget, setArchiveTarget] = useState<Venue | null>(null);

  const { data: venues = [], isLoading } = useQuery({
    queryKey: VENUES_KEY,
    queryFn: () => listVenues(),
    staleTime: 60_000,
  });

  const visible = useMemo(() => {
    let rows = venues;
    if (statusFilter === "active") rows = rows.filter((v) => v.status === "active");
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        (v.venue_type ?? "").toLowerCase().includes(q) ||
        (v.street_address ?? "").toLowerCase().includes(q),
    );
  }, [venues, statusFilter, search]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: VENUES_KEY });
    invalidateEventDayCaches(qc);
  };

  const archiveMut = useMutation({
    mutationFn: (id: string) => archiveVenue(id),
    onSuccess: () => {
      toast.success("Venue archived.");
      invalidate();
      setArchiveTarget(null);
      if (selected?.id === archiveTarget?.id) setSelected(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <p className="text-sm text-muted-foreground">
          Managed destination registry for out-of-centre outings (§12.2). Venue safety
          templates and baseline sign-offs are stored here — not per-event.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search venues…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-56"
        />
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as "active" | "all")}
        >
          <SelectTrigger className="h-9 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="mr-1.5 h-4 w-4" />
          Add Venue
        </Button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No venues found. Add one to get started.
        </p>
      ) : (
        <div className="divide-y rounded-lg border">
          {visible.map((v) => (
            <div
              key={v.id}
              className="flex items-start gap-3 px-4 py-3 hover:bg-muted/40 cursor-pointer"
              onClick={() => setSelected(v)}
            >
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-sm">{v.name}</span>
                  {statusBadge(v.status)}
                  {riskBadge(v.risk_tier)}
                  <span className="text-xs text-muted-foreground capitalize">{v.venue_type}</span>
                </div>
                {v.street_address && (
                  <p className="mt-0.5 text-xs text-muted-foreground truncate">
                    {v.street_address}
                  </p>
                )}
              </div>
              <div
                className="flex items-center gap-1 shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Edit"
                  onClick={() => setEditing(v)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Clone"
                  onClick={() => setCloneSource(v)}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                {v.status === "active" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    title="Archive"
                    onClick={() => setArchiveTarget(v)}
                  >
                    <Archive className="h-3.5 w-3.5" />
                  </Button>
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Venue detail side-panel */}
      {selected && (
        <VenueDetailPanel
          venue={selected}
          onClose={() => setSelected(null)}
          onEdit={() => setEditing(selected)}
          onInvalidate={invalidate}
        />
      )}

      {/* Create / Edit sheet */}
      {editing !== null && (
        <VenueFormSheet
          open
          venue={editing === "new" ? null : editing}
          onOpenChange={(open) => !open && setEditing(null)}
          onSaved={(v) => {
            invalidate();
            setEditing(null);
            setSelected(v);
          }}
        />
      )}

      {/* Clone dialog */}
      {cloneSource && (
        <CloneVenueDialog
          open
          source={cloneSource}
          onOpenChange={(open) => !open && setCloneSource(null)}
          onCloned={(v) => {
            invalidate();
            setCloneSource(null);
            setSelected(v);
          }}
        />
      )}

      {/* Archive confirm */}
      <AlertDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive "{archiveTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              The venue will be hidden from outing planning and the active registry. Existing
              event references are preserved. This can be reversed by a Manager.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={archiveMut.isPending}
              onClick={() => archiveTarget && archiveMut.mutate(archiveTarget.id)}
            >
              {archiveMut.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Archiving…</>
              ) : (
                "Archive venue"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Venue detail panel ──────────────────────────────────────────────────────

interface DetailProps {
  venue: Venue;
  onClose: () => void;
  onEdit: () => void;
  onInvalidate: () => void;
}

function VenueDetailPanel({ venue, onClose, onEdit, onInvalidate }: DetailProps) {
  const qc = useQueryClient();
  const [panelTab, setPanelTab] = useState<"template" | "signoffs" | "compliance">("template");
  const [signoffOpen, setSignoffOpen] = useState(false);

  const { data: fields = [], isLoading: fieldsLoading } = useQuery({
    queryKey: venueFieldsKey(venue.id),
    queryFn: () => listVenueTemplateFields(venue.id),
    staleTime: 30_000,
  });

  const { data: signoffs = [] } = useQuery({
    queryKey: venueSignoffsKey(venue.id),
    queryFn: () => listBaselineSignoffs(venue.id),
    staleTime: 30_000,
  });

  const latestSignoff = signoffs[0] ?? null;

  return (
    <div className="mt-2 rounded-lg border bg-card">
      {/* Panel header */}
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="space-y-0.5">
          <h3 className="font-semibold text-sm">{venue.name}</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            {statusBadge(venue.status)}
            {riskBadge(venue.risk_tier)}
            <span className="text-xs text-muted-foreground capitalize">{venue.venue_type}</span>
            {venue.max_safe_group_size && (
              <span className="text-xs text-muted-foreground">
                Max group: {venue.max_safe_group_size}
              </span>
            )}
          </div>
          {venue.street_address && (
            <p className="text-xs text-muted-foreground">{venue.street_address}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      {/* Baseline status */}
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5 bg-muted/30">
        <div className="flex items-center gap-2">
          {latestSignoff ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-medium">
                Baseline signed off{" "}
                <FormattedDateTime iso={latestSignoff.signed_off_at} />
              </span>
            </>
          ) : (
            <>
              <ShieldCheck className="h-4 w-4 text-yellow-600" />
              <span className="text-sm font-medium text-yellow-700">
                No baseline sign-off yet
              </span>
            </>
          )}
        </div>
        <Button size="sm" onClick={() => setSignoffOpen(true)}>
          <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />
          {latestSignoff ? "Re-sign baseline" : "Sign baseline"}
        </Button>
      </div>

      {/* Panel tabs */}
      <div className="flex border-b">
        {(["template", "signoffs", "compliance"] as const).map((t) => (
          <button
            key={t}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              panelTab === t
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setPanelTab(t)}
          >
            {t === "template" ? "Safety template" : t === "signoffs" ? "Sign-off history" : "Compliance"}
          </button>
        ))}
      </div>

      {/* Template tab */}
      {panelTab === "template" && (
        <TemplateFieldsEditor
          venue={venue}
          fields={fields}
          isLoading={fieldsLoading}
          onInvalidate={onInvalidate}
        />
      )}

      {/* Sign-off history tab */}
      {panelTab === "signoffs" && (
        <SignoffHistory signoffs={signoffs} />
      )}

      {/* Compliance tab */}
      {panelTab === "compliance" && (
        <div className="px-4 py-4">
          <VenueComplianceTab venue={venue} />
        </div>
      )}

      {/* Baseline sign-off dialog */}
      {signoffOpen && (
        <BaselineSignoffDialog
          open
          venue={venue}
          fields={fields}
          onOpenChange={(open) => !open && setSignoffOpen(false)}
          onSigned={() => {
            void qc.invalidateQueries({ queryKey: venueSignoffsKey(venue.id) });
            onInvalidate();
            setSignoffOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ─── Template fields editor ──────────────────────────────────────────────────

interface TemplateEditorProps {
  venue: Venue;
  fields: VenueTemplateField[];
  isLoading: boolean;
  onInvalidate: () => void;
}

function TemplateFieldsEditor({ venue, fields, isLoading, onInvalidate }: TemplateEditorProps) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [addPrompt, setAddPrompt] = useState("");
  const [addType, setAddType] = useState<AnswerType>("yes_no");
  const [addMandatory, setAddMandatory] = useState(true);
  const [addBusy, setAddBusy] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: venueFieldsKey(venue.id) });

  const handleAdd = async () => {
    if (!addPrompt.trim()) return;
    setAddBusy(true);
    try {
      await addVenueTemplateField({
        venue_id: venue.id,
        prompt: addPrompt.trim(),
        answer_type: addType,
        is_mandatory: addMandatory,
        sort_order: fields.length * 10 + 10,
      });
      toast.success("Field added.");
      setAddPrompt("");
      setAddType("yes_no");
      setAddMandatory(true);
      setAddOpen(false);
      invalidate();
      onInvalidate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAddBusy(false);
    }
  };

  const handleDelete = async (field: VenueTemplateField) => {
    try {
      await deleteVenueTemplateField(field.id);
      toast.success("Field removed.");
      invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          These fields appear in every baseline sign-off and per-event reconfirmation for this
          venue. System core fields (§12.2.2) cannot be removed.
        </p>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add field
        </Button>
      </div>

      {fields.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">No fields yet.</p>
      ) : (
        <div className="divide-y rounded-lg border text-sm">
          {fields.map((f) => (
            <div key={f.id} className="flex items-start gap-3 px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <span className="font-medium">{f.prompt}</span>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {f.answer_type.replace("_", " ")}
                  </Badge>
                  {f.is_mandatory && (
                    <Badge variant="outline" className="text-[10px]">Required</Badge>
                  )}
                  {f.is_system_core && (
                    <Badge variant="secondary" className="text-[10px]">Core</Badge>
                  )}
                </div>
              </div>
              {!f.is_system_core && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  title="Remove field"
                  onClick={() => handleDelete(f)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add field inline */}
      {addOpen && (
        <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Prompt</Label>
            <Input
              placeholder="e.g. Fire extinguisher accessible?"
              value={addPrompt}
              onChange={(e) => setAddPrompt(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Answer type</Label>
              <Select value={addType} onValueChange={(v) => setAddType(v as AnswerType)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes_no">Yes / No</SelectItem>
                  <SelectItem value="text">Text</SelectItem>
                  <SelectItem value="number">Number</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2 pb-0.5">
              <Switch
                id="add-mandatory"
                checked={addMandatory}
                onCheckedChange={setAddMandatory}
              />
              <Label htmlFor="add-mandatory" className="text-xs cursor-pointer">
                Mandatory
              </Label>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!addPrompt.trim() || addBusy}
              onClick={handleAdd}
            >
              {addBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sign-off history ────────────────────────────────────────────────────────

function SignoffHistory({ signoffs }: { signoffs: VenueSafetyBaselineSignoff[] }) {
  if (signoffs.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No baseline sign-offs recorded yet.
      </p>
    );
  }
  return (
    <div className="divide-y p-0">
      {signoffs.map((s) => (
        <div key={s.id} className="px-4 py-3 space-y-0.5">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            <span className="text-sm font-medium">
              <FormattedDateTime iso={s.signed_off_at} />
            </span>
          </div>
          <p className="text-xs text-muted-foreground ml-5.5">
            Evidence: {s.evidence_ref}
          </p>
          {s.notes && (
            <p className="text-xs text-muted-foreground ml-5.5">{s.notes}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Venue form sheet (create / edit) ────────────────────────────────────────

interface VenueFormSheetProps {
  open: boolean;
  venue: Venue | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (v: Venue) => void;
}

function VenueFormSheet({ open, venue, onOpenChange, onSaved }: VenueFormSheetProps) {
  const isEdit = !!venue;

  const [name, setName] = useState("");
  const [venueType, setVenueType] = useState("general");
  const [streetAddress, setStreetAddress] = useState("");
  const [accessNotes, setAccessNotes] = useState("");
  const [siteContactName, setSiteContactName] = useState("");
  const [siteContactPhone, setSiteContactPhone] = useState("");
  const [maxGroupSize, setMaxGroupSize] = useState("");
  const [riskTier, setRiskTier] = useState<RiskTier>("medium");

  useEffect(() => {
    if (!open) return;
    if (venue) {
      setName(venue.name);
      setVenueType(venue.venue_type);
      setStreetAddress(venue.street_address ?? "");
      setAccessNotes(venue.access_notes ?? "");
      setSiteContactName(venue.site_contact_name ?? "");
      setSiteContactPhone(venue.site_contact_phone ?? "");
      setMaxGroupSize(venue.max_safe_group_size?.toString() ?? "");
      setRiskTier(venue.risk_tier);
    } else {
      setName("");
      setVenueType("general");
      setStreetAddress("");
      setAccessNotes("");
      setSiteContactName("");
      setSiteContactPhone("");
      setMaxGroupSize("");
      setRiskTier("medium");
    }
  }, [open, venue]);

  const mut = useMutation({
    mutationFn: () =>
      upsertVenue({
        id: venue?.id,
        name,
        venue_type: venueType,
        street_address: streetAddress || null,
        access_notes: accessNotes || null,
        site_contact_name: siteContactName || null,
        site_contact_phone: siteContactPhone || null,
        max_safe_group_size: maxGroupSize ? Number(maxGroupSize) : null,
        risk_tier: riskTier,
      }),
    onSuccess: (v) => {
      toast.success(isEdit ? "Venue updated." : "Venue created.");
      onSaved(v);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSave = name.trim().length >= 2;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? "Edit venue" : "Add venue"}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? "Update venue details. Safety templates and sign-offs are managed separately."
              : "A new venue will have the mandatory safety template fields (§12.2.2) seeded automatically."}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="v-name" className="text-sm font-semibold">
              Venue name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="v-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Centennial Park"
              className={name.trim().length < 2 && name !== "" ? "border-2 border-destructive" : ""}
            />
          </div>

          {/* Type */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold">Venue type</Label>
            <Select value={venueType} onValueChange={setVenueType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  ["general", "General"],
                  ["park", "Park / outdoor"],
                  ["hotel", "Hotel / accommodation"],
                  ["cinema", "Cinema / theatre"],
                  ["museum", "Museum / gallery"],
                  ["sports", "Sports / recreation"],
                  ["restaurant", "Restaurant / café"],
                  ["shopping", "Shopping centre"],
                  ["club", "Club / social venue"],
                ].map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Risk tier */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold">Risk tier</Label>
            <Select value={riskTier} onValueChange={(v) => setRiskTier(v as RiskTier)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Address */}
          <div className="space-y-1.5">
            <Label htmlFor="v-addr" className="text-sm font-semibold">
              Street address
            </Label>
            <Input
              id="v-addr"
              value={streetAddress}
              onChange={(e) => setStreetAddress(e.target.value)}
              placeholder="123 Example St, Suburb NSW 2000"
            />
          </div>

          {/* Access notes */}
          <div className="space-y-1.5">
            <Label htmlFor="v-access" className="text-sm font-semibold">
              Access notes
            </Label>
            <Textarea
              id="v-access"
              value={accessNotes}
              onChange={(e) => setAccessNotes(e.target.value)}
              placeholder="Parking, entry gates, step-free route…"
              rows={2}
              className="text-sm"
            />
          </div>

          {/* Site contact */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="v-contact-name" className="text-sm font-semibold">
                Site contact name
              </Label>
              <Input
                id="v-contact-name"
                value={siteContactName}
                onChange={(e) => setSiteContactName(e.target.value)}
                placeholder="Jane Smith"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-contact-phone" className="text-sm font-semibold">
                Contact phone
              </Label>
              <Input
                id="v-contact-phone"
                value={siteContactPhone}
                onChange={(e) => setSiteContactPhone(e.target.value)}
                placeholder="0400 000 000"
              />
            </div>
          </div>

          {/* Max group size */}
          <div className="space-y-1.5">
            <Label htmlFor="v-maxgroup" className="text-sm font-semibold">
              Max safe group size
            </Label>
            <Input
              id="v-maxgroup"
              type="number"
              min={1}
              value={maxGroupSize}
              onChange={(e) => setMaxGroupSize(e.target.value)}
              placeholder="e.g. 30"
              className="w-32"
            />
          </div>
        </div>

        <SheetFooter className="mt-6 gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mut.mutate()} disabled={!canSave || mut.isPending}>
            {mut.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isEdit ? "Saving…" : "Creating…"}</>
            ) : (
              isEdit ? "Save changes" : "Create venue"
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ─── Clone dialog ────────────────────────────────────────────────────────────

interface CloneDialogProps {
  open: boolean;
  source: Venue;
  onOpenChange: (open: boolean) => void;
  onCloned: (v: Venue) => void;
}

function CloneVenueDialog({ open, source, onOpenChange, onCloned }: CloneDialogProps) {
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setNewName(`${source.name} (copy)`);
  }, [open, source.name]);

  const handleClone = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const v = await cloneVenue(source.id, newName.trim());
      toast.success(
        `"${v.name}" created — template field structure copied. A fresh baseline sign-off is required.`,
      );
      onCloned(v);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Clone venue</DialogTitle>
          <DialogDescription>
            Copies <strong>{source.name}</strong>'s safety template field structure only —
            answers are <em>never</em> copied (§12.2.2). A fresh baseline sign-off is required
            before the new venue can be used on events.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="clone-name" className="text-sm font-semibold">
            New venue name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="clone-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Hyde Park"
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={handleClone}
            disabled={!newName.trim() || busy}
          >
            {busy ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Cloning…</>
            ) : (
              "Clone venue"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Baseline sign-off dialog ────────────────────────────────────────────────

interface BaselineSignoffDialogProps {
  open: boolean;
  venue: Venue;
  fields: VenueTemplateField[];
  onOpenChange: (open: boolean) => void;
  onSigned: () => void;
}

function BaselineSignoffDialog({
  open,
  venue,
  fields,
  onOpenChange,
  onSigned,
}: BaselineSignoffDialogProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [evidence, setEvidence] = useState("");
  const [notes, setNotes] = useState("");
  const [managerPinVerified, setManagerPinVerified] = useState(false);
  const verifiedManagerPinRef = useRef("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const managerStaffId = getActiveUserProfile()?.staffId ?? "";

  useEffect(() => {
    if (open) {
      setAnswers({});
      setEvidence("");
      setNotes("");
      setManagerPinVerified(false);
      verifiedManagerPinRef.current = "";
      setPinError(null);
    }
  }, [open]);

  const mandatoryFields = fields.filter((f) => f.is_mandatory);
  const allMandatoryAnswered = mandatoryFields.every((f) => {
    const a = answers[f.id] ?? "";
    return a.trim().length > 0;
  });
  const evidenceOk = evidence.trim().length >= MIN_EVIDENCE;
  const pinOk = managerPinVerified;
  const canSubmit = allMandatoryAnswered && evidenceOk && pinOk && !busy;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setPinError(null);
    try {
      const answerRows: BaselineSignoffAnswer[] = fields
        .filter((f) => answers[f.id])
        .map((f) => ({ field_id: f.id, answer_text: answers[f.id] }));

      await submitBaselineSignoff({
        venue_id: venue.id,
        managerPin: verifiedManagerPinRef.current,
        evidence_ref: evidence.trim(),
        notes: notes.trim() || null,
        answers: answerRows,
      });

      toast.success("Baseline sign-off recorded.");
      onSigned();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.toLowerCase().includes("pin") || msg.toLowerCase().includes("manager")) {
        setPinError(msg);
        setManagerPinVerified(false);
        verifiedManagerPinRef.current = "";
      } else {
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Venue safety baseline sign-off</DialogTitle>
          <DialogDescription>
            Complete all mandatory checklist fields, then sign with your Manager PIN. This
            record is immutable once saved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No template fields configured for this venue. Add fields on the Safety template tab first.
            </p>
          ) : (
            <>
              {fields.map((f) => (
                <AnswerField
                  key={f.id}
                  field={f}
                  value={answers[f.id] ?? ""}
                  onChange={(v) => setAnswers((prev) => ({ ...prev, [f.id]: v }))}
                />
              ))}

              <div className="pt-2 border-t space-y-3">
                <CharacterCountedInput
                  label="Evidence reference"
                  value={evidence}
                  onValueChange={setEvidence}
                  minChars={MIN_EVIDENCE}
                  placeholder="e.g. Site inspection report #123 or verbal briefing ref"
                />

                <div className="space-y-1.5">
                  <Label className="text-sm font-semibold">Notes (optional)</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Additional context for this sign-off…"
                    rows={2}
                    className="text-sm"
                  />
                </div>

                {/* Manager PIN */}
                <div className="space-y-1.5">
                  <Label className="text-sm font-semibold">
                    Manager PIN <span className="text-destructive">*</span>
                  </Label>
                  <PinEntryTrigger
                    label="Tap to enter manager PIN"
                    verified={managerPinVerified}
                    verifiedLabel="Manager PIN verified"
                    length={4}
                    title="Venue safety baseline sign-off"
                    description="Immutable record — manager PIN required."
                    disabled={!managerStaffId}
                    required
                    onVerify={async (p) => {
                      await verifyManagerPin(managerStaffId, p);
                    }}
                    onSuccess={(p) => {
                      verifiedManagerPinRef.current = p;
                      setManagerPinVerified(true);
                      setPinError(null);
                    }}
                  />
                  {pinError && (
                    <p className="text-sm text-destructive font-medium">{pinError}</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {busy ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
            ) : (
              "Sign off baseline"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Answer field renderer ───────────────────────────────────────────────────

function AnswerField({
  field,
  value,
  onChange,
}: {
  field: VenueTemplateField;
  value: string;
  onChange: (v: string) => void;
}) {
  const answered = value.trim().length > 0;

  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-semibold">
        {field.prompt}
        {field.is_mandatory && <span className="ml-1 text-destructive">*</span>}
      </Label>

      {field.answer_type === "yes_no" ? (
        <div className="flex gap-2">
          {["Yes", "No"].map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              className={`rounded-md border px-4 py-1.5 text-sm font-medium transition-colors ${
                value === opt
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background hover:bg-muted"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      ) : field.answer_type === "number" ? (
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-32 ${field.is_mandatory && !answered ? "border-2 border-destructive" : ""}`}
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={field.is_mandatory && !answered ? "border-2 border-destructive" : ""}
          placeholder="Enter answer…"
        />
      )}
    </div>
  );
}
