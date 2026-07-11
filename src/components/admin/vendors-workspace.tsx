import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, Pencil, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormattedDateTime } from "@/components/ui/formatted-time";
import { canManageSystemParameters } from "@/lib/api/system-parameters";
import {
  createVendor,
  listVendors,
  normalizeVendorName,
  updateVendor,
  type Vendor,
} from "@/lib/api/vendors";
import { getActiveUserProfile, isActiveUserManager } from "@/lib/data-store";

function sortVendors(rows: Vendor[]): Vendor[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}

function patchVendorList(
  rows: Vendor[] | undefined,
  vendor: Vendor,
): Vendor[] {
  const list = rows ?? [];
  const idx = list.findIndex((v) => v.id === vendor.id);
  if (idx >= 0) {
    const next = [...list];
    next[idx] = vendor;
    return sortVendors(next);
  }
  return sortVendors([...list, vendor]);
}

export function VendorsWorkspace() {
  const qc = useQueryClient();
  const profile = useMemo(() => getActiveUserProfile(), []);
  const permissionQ = useQuery({
    queryKey: ["vendors", "can-manage", profile?.staffId ?? "auth-user"],
    queryFn: () => canManageSystemParameters(profile?.staffId),
    staleTime: 60_000,
  });
  const canEdit = isActiveUserManager() || permissionQ.data === true;

  const { data: vendors = [], isLoading } = useQuery({
    queryKey: ["vendors", "all"],
    queryFn: () => listVendors("all"),
    staleTime: 30_000,
  });

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "all">("active");
  const [editor, setEditor] = useState<"new" | Vendor | null>(null);
  const [draftName, setDraftName] = useState("");

  const visible = useMemo(() => {
    let rows = vendors;
    if (statusFilter === "active") rows = rows.filter((v) => v.status === "active");
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((v) => v.name.toLowerCase().includes(q));
  }, [vendors, query, statusFilter]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const name = normalizeVendorName(draftName);
      if (name.length < 2) throw new Error("Vendor name must be at least 2 characters.");
      if (editor === "new") return createVendor(name);
      if (editor && editor !== "new") return updateVendor(editor.id, { name });
      throw new Error("Nothing to save.");
    },
    onSuccess: async (vendor) => {
      const wasNew = editor === "new";
      qc.setQueryData<Vendor[]>(["vendors", "all"], (old) => patchVendorList(old, vendor));
      if (vendor.status === "active") {
        qc.setQueryData<Vendor[]>(["vendors", "active"], (old) => patchVendorList(old, vendor));
      }
      await qc.invalidateQueries({ queryKey: ["vendors"] });
      toast.success(wasNew ? "Vendor added" : "Vendor updated");
      setEditor(null);
      setDraftName("");
    },
    onError: (e: Error) => toast.error("Could not save vendor", { description: e.message }),
  });

  const archiveMut = useMutation({
    mutationFn: (vendor: Vendor) => updateVendor(vendor.id, { status: "archived" }),
    onSuccess: async (vendor) => {
      qc.setQueryData<Vendor[]>(["vendors", "all"], (old) => patchVendorList(old, vendor));
      qc.setQueryData<Vendor[]>(["vendors", "active"], (old) =>
        (old ?? []).filter((v) => v.id !== vendor.id),
      );
      await qc.invalidateQueries({ queryKey: ["vendors"] });
      toast.success("Vendor archived");
    },
    onError: (e: Error) => toast.error("Could not archive vendor", { description: e.message }),
  });

  const restoreMut = useMutation({
    mutationFn: (vendor: Vendor) => updateVendor(vendor.id, { status: "active" }),
    onSuccess: async (vendor) => {
      qc.setQueryData<Vendor[]>(["vendors", "all"], (old) => patchVendorList(old, vendor));
      qc.setQueryData<Vendor[]>(["vendors", "active"], (old) => patchVendorList(old, vendor));
      await qc.invalidateQueries({ queryKey: ["vendors"] });
      toast.success("Vendor restored");
    },
    onError: (e: Error) => toast.error("Could not restore vendor", { description: e.message }),
  });

  function openNew() {
    setEditor("new");
    setDraftName("");
  }

  function openEdit(vendor: Vendor) {
    setEditor(vendor);
    setDraftName(vendor.name);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Simple supplier name list for event expense logging. Names should match MYOB vendor
            records so exports stay aligned — full vendor management lives in MYOB.
          </p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={openNew}>
            <Plus className="mr-1 h-4 w-4" /> Add vendor
          </Button>
        )}
      </div>

      {!canEdit && <Badge variant="secondary">Read-only · Managers can edit</Badge>}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search vendor name…"
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "active" | "all")}>
          <SelectTrigger className="h-9 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vendor name</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-40">Added</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  Loading vendors…
                </TableCell>
              </TableRow>
            ) : visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No vendors match this filter.
                </TableCell>
              </TableRow>
            ) : (
              visible.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">{v.name}</TableCell>
                  <TableCell>
                    {v.status === "active" ? (
                      <Badge className="bg-emerald-600 text-white">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Archived</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <FormattedDateTime value={v.createdAt} />
                  </TableCell>
                  <TableCell>
                    {canEdit && (
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(v)}
                          aria-label={`Edit ${v.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {v.status === "active" ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => archiveMut.mutate(v)}
                            aria-label={`Archive ${v.name}`}
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => restoreMut.mutate(v)}
                          >
                            Restore
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={editor !== null} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editor === "new" ? "Add vendor" : "Edit vendor"}</DialogTitle>
            <DialogDescription>
              Use the exact supplier name as it appears in MYOB.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="vendor-name">Vendor name</Label>
            <Input
              id="vendor-name"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="e.g. Hoyts Cinemas"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || normalizeVendorName(draftName).length < 2}
            >
              {saveMut.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
