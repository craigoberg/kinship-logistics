/**
 * Admin → Venues → Venue types.
 * The name is what people see. The code stays on each venue.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ChevronDown, ChevronRight, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CharacterCountedInput } from "@/components/ui/character-counted-input";
import { Input } from "@/components/ui/input";
import { IconActionButton } from "@/components/ui/icon-action-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  CAUTION_CALLOUT_CLASS,
} from "@/lib/ui/caution-callout";
import type { Venue } from "@/lib/api/venues";
import { VenueTypeRequirements } from "@/components/admin/venue-type-requirements";
import {
  OVERNIGHT_VENUE_TYPE_CODES,
  createVenueType,
  listVenueTypes,
  setVenueTypeStatus,
  updateVenueTypeLabel,
  venueTypeCodeFromLabel,
  type VenueType,
  type VenueTypeCatalog,
} from "@/lib/api/venue-types";

export const VENUE_TYPES_KEY = ["venue-types"] as const;

export function useVenueTypes() {
  return useQuery({
    queryKey: VENUE_TYPES_KEY,
    queryFn: listVenueTypes,
    staleTime: 60_000,
  });
}

export function VenueTypesPanel({
  venues,
  catalog,
  loading,
  onEditVenue,
}: {
  venues: Venue[];
  catalog: VenueTypeCatalog | undefined;
  loading: boolean;
  onEditVenue: (venue: Venue) => void;
}) {
  const qc = useQueryClient();
  const types = catalog?.types ?? [];
  const fromDatabase = catalog?.fromDatabase === true;
  const [editor, setEditor] = useState<"new" | VenueType | null>(null);
  const [name, setName] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<VenueType | null>(null);
  const [search, setSearch] = useState("");
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const usedBy = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of venues) {
      const code = (v.venue_type ?? "").trim();
      if (!code) continue;
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    return counts;
  }, [venues]);

  const rows = useMemo(
    () =>
      [...types].sort((a, b) => {
        if (a.status !== b.status) return a.status === "active" ? -1 : 1;
        return a.sort_order - b.sort_order || a.label.localeCompare(b.label);
      }),
    [types],
  );

  const q = search.trim().toLowerCase();

  const venuesFor = (code: string) =>
    venues
      .filter((v) => (v.venue_type ?? "").trim() === code)
      .sort((a, b) => a.name.localeCompare(b.name));

  const visibleVenues = (row: VenueType) => {
    const all = venuesFor(row.code);
    if (!q) return all;
    if (row.label.toLowerCase().includes(q)) return all;
    return all.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        (v.street_address ?? "").toLowerCase().includes(q),
    );
  };

  const visibleRows = rows.filter((row) => !q || visibleVenues(row).length > 0 || row.label.toLowerCase().includes(q));

  const invalidate = () => qc.invalidateQueries({ queryKey: VENUE_TYPES_KEY });

  const saveMut = useMutation({
    mutationFn: () =>
      editor === "new" || !editor
        ? createVenueType(name)
        : updateVenueTypeLabel(editor.id, name),
    onSuccess: () => {
      toast.success(editor === "new" ? "Venue type added" : "Venue type updated");
      setEditor(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusMut = useMutation({
    mutationFn: (row: VenueType) =>
      setVenueTypeStatus(row.id, row.status === "active" ? "archived" : "active"),
    onSuccess: () => {
      toast.success("Venue type updated");
      setArchiveTarget(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const nameOk = name.trim().length >= 2;
  const missing = !nameOk ? ["Venue type name (min 2)"] : [];
  const previewCode =
    editor === "new"
      ? venueTypeCodeFromLabel(name)
      : editor
        ? editor.code
        : "";

  function openNew() {
    setName("");
    setEditor("new");
  }
  function openEdit(row: VenueType) {
    setName(row.label);
    setEditor(row);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Add a type such as Cruise here. Expand it and tick the checks that type should have.
        Rename a type with Edit. Venues stay on that type. Itinerary lines already saved
        keep the old name. The next line you add uses the new name. Hotel / accommodation
        is the overnight stay.
      </p>
      {!fromDatabase && !loading && (
        <div className={cn(CAUTION_CALLOUT_CLASS, "px-3 py-2 text-sm")}>
          This is still the built-in list. Run the venue types SQL, then hard refresh, to add or rename types.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a venue or a type…"
            className="pl-9"
          />
        </div>
        <Button size="sm" onClick={openNew} disabled={!fromDatabase}>
          <Plus className="mr-1 h-4 w-4" />
          Add venue type
        </Button>
      </div>
      <div className="space-y-2">
        {loading ? (
          <p className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">
            Loading venue types…
          </p>
        ) : visibleRows.length === 0 ? (
          <p className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">
            {q ? "No venue or type matches that search." : "No venue types yet."}
          </p>
        ) : (
          visibleRows.map((row) => {
            const overnight = OVERNIGHT_VENUE_TYPE_CODES.has(row.code);
            const count = usedBy.get(row.code) ?? 0;
            const open = q ? true : openIds.has(row.id);
            const listed = visibleVenues(row);
            return (
              <div key={row.id} className="rounded-lg border">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() =>
                      setOpenIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(row.id)) next.delete(row.id);
                        else next.add(row.id);
                        return next;
                      })
                    }
                    aria-expanded={open}
                  >
                    {open ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate font-medium">{row.label}</span>
                    {overnight && (
                      <Badge variant="outline" className="text-[10px]">
                        Overnight
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {count} {count === 1 ? "venue" : "venues"}
                    </span>
                  </button>
                  {row.status === "active" ? (
                    <Badge className="bg-emerald-600 text-white">Active</Badge>
                  ) : (
                    <Badge variant="secondary">Archived</Badge>
                  )}
                  {fromDatabase && (
                    <Button type="button" size="sm" variant="outline" onClick={() => openEdit(row)}>
                      Edit
                    </Button>
                  )}
                  {fromDatabase && !overnight && (
                    <IconActionButton
                      className="h-8 w-8"
                      tooltip={row.status === "active" ? "Archive" : "Restore"}
                      onClick={() =>
                        row.status === "active" ? setArchiveTarget(row) : statusMut.mutate(row)
                      }
                    >
                      <Archive className="h-4 w-4" />
                    </IconActionButton>
                  )}
                </div>
                {open && (
                  <div className="border-t">
                    <VenueTypeRequirements typeCode={row.code} />
                    {listed.length === 0 ? (
                      <p className="px-3 py-3 text-sm text-muted-foreground">No venues of this type.</p>
                    ) : (
                      listed.map((v) => (
                        <div
                          key={v.id}
                          className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{v.name}</p>
                            {v.street_address ? (
                              <p className="truncate text-xs text-muted-foreground">{v.street_address}</p>
                            ) : null}
                          </div>
                          {v.status === "archived" && <Badge variant="secondary">Archived</Badge>}
                          <Button type="button" size="sm" variant="outline" onClick={() => onEditVenue(v)}>
                            Edit
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <Dialog open={!!editor} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editor === "new" ? "Add venue type" : "Edit venue type"}</DialogTitle>
            <DialogDescription>
              {editor === "new"
                ? "This name is offered when you add a venue, and copied onto each new itinerary line."
                : "Venues stay on this type. Itinerary lines already saved keep the old name. A new itinerary line uses this name."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <CharacterCountedInput
              label="Name"
              value={name}
              onValueChange={setName}
              minChars={2}
              maxChars={60}
              required
              placeholder="e.g. Visitor Centre"
            />
            {editor === "new" && nameOk && previewCode && (
              <p className="text-xs text-muted-foreground">
                Stored as <span className="font-mono">{previewCode}</span>.
              </p>
            )}
            {missing.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Missing: {missing.join(", ")}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditor(null)}>
              Close
            </Button>
            <Button
              type="button"
              disabled={!nameOk || saveMut.isPending}
              onClick={() => saveMut.mutate()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!archiveTarget} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{archiveTarget?.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              New venues will not offer this type.
              {(archiveTarget && (usedBy.get(archiveTarget.code) ?? 0) > 0)
                ? ` ${usedBy.get(archiveTarget.code)} venue${usedBy.get(archiveTarget!.code) === 1 ? "" : "s"} already use it and keep the name.`
                : " No venues use it yet."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={statusMut.isPending}
              onClick={() => archiveTarget && statusMut.mutate(archiveTarget)}
            >
              Archive type
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
