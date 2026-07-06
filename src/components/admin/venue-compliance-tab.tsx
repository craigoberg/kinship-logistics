/**
 * VenueComplianceTab — compliance assets linked to a specific venue (§12 Phase 7)
 *
 * Shows all compliance_assets where subject_table='venues' and subject_id=venue.id.
 * Allows managers to create new assets (public liability, hire permit, WHS cert etc.)
 * and edit/manage existing ones.
 *
 * Traffic-light status uses the same computeRyge() logic as the main compliance panel.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  FileCheck2,
  Loader2,
  Pencil,
  Plus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { CharacterCountedInput } from "@/components/ui/character-counted-input";
import { FormattedDate } from "@/components/ui/formatted-time";
import { useComplianceWarningDays } from "@/hooks/use-system-parameters";
import {
  computeRyge,
  listVenueComplianceAssets,
  upsertComplianceAsset,
  type ComplianceAsset,
  type ComplianceActionModule,
} from "@/lib/api/compliance-assets";
import type { Venue } from "@/lib/api/venues";

const venueComplianceKey = (venueId: string) =>
  ["compliance-assets", "venues", venueId] as const;

interface Props {
  venue: Venue;
}

// Preset asset types for venues — coordinators can also enter freeform.
const VENUE_ASSET_TYPES: Array<{ value: string; label: string }> = [
  { value: "public_liability", label: "Public liability insurance" },
  { value: "venue_hire_permit", label: "Venue hire permit / booking" },
  { value: "whs_certificate", label: "WHS / safety certificate" },
  { value: "first_aid_kit_check", label: "First aid kit inspection" },
  { value: "fire_safety_check", label: "Fire safety / evacuation plan" },
  { value: "food_handler_cert", label: "Food handler certificate" },
  { value: "accessibility_audit", label: "Accessibility audit" },
  { value: "generic_resolve", label: "Other (specify in name)" },
];

function rygeBadge(asset: ComplianceAsset, params: { default: number; shortCycle: number }) {
  const r = computeRyge(asset, params);
  if (r === "red")
    return <Badge className="bg-destructive text-destructive-foreground text-[10px]">RED</Badge>;
  if (r === "yellow")
    return <Badge className="bg-yellow-500 text-black text-[10px]">YELLOW</Badge>;
  return <Badge className="bg-emerald-600 text-white text-[10px]">GREEN</Badge>;
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const today = new Date();
  const expiry = new Date(iso + "T00:00:00");
  return Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
}

export function VenueComplianceTab({ venue }: Props) {
  const qc = useQueryClient();
  const warningDays = useComplianceWarningDays();
  const [addOpen, setAddOpen] = useState(false);
  const [editAsset, setEditAsset] = useState<ComplianceAsset | null>(null);

  const { data: assets = [], isLoading } = useQuery({
    queryKey: venueComplianceKey(venue.id),
    queryFn: () => listVenueComplianceAssets(venue.id),
    staleTime: 30_000,
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: venueComplianceKey(venue.id) });

  const active = assets.filter((a) => a.status === "active");
  const archived = assets.filter((a) => a.status === "archived");

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Compliance assets tied to this venue — permits, insurance, safety certificates.
          Traffic-light status is based on expiry date.
        </p>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add asset
        </Button>
      </div>

      {active.length === 0 ? (
        <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
          <FileCheck2 className="mx-auto mb-2 h-5 w-5" />
          No compliance assets linked to this venue yet.
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {active.map((asset) => (
            <AssetRow
              key={asset.id}
              asset={asset}
              warningDays={warningDays}
              onEdit={() => setEditAsset(asset)}
            />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            {archived.length} archived asset{archived.length > 1 ? "s" : ""}
          </summary>
          <div className="mt-2 divide-y rounded-lg border opacity-60">
            {archived.map((asset) => (
              <AssetRow
                key={asset.id}
                asset={asset}
                warningDays={warningDays}
                onEdit={() => setEditAsset(asset)}
              />
            ))}
          </div>
        </details>
      )}

      {/* Add dialog */}
      <AssetFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        venue={venue}
        onSaved={invalidate}
      />

      {/* Edit dialog */}
      {editAsset && (
        <AssetFormDialog
          open
          onOpenChange={(o) => !o && setEditAsset(null)}
          venue={venue}
          existing={editAsset}
          onSaved={() => { invalidate(); setEditAsset(null); }}
        />
      )}
    </div>
  );
}

// ─── Asset row ────────────────────────────────────────────────────────────────

interface AssetRowProps {
  asset: ComplianceAsset;
  warningDays: { default: number; shortCycle: number };
  onEdit: () => void;
}

function AssetRow({ asset, warningDays, onEdit }: AssetRowProps) {
  const days = daysUntil(asset.expiry_date);

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="mt-0.5">{rygeBadge(asset, warningDays)}</div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium">{asset.name}</span>
          {asset.type && (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {VENUE_ASSET_TYPES.find((t) => t.value === asset.type)?.label ?? asset.type}
            </span>
          )}
        </div>
        {asset.description && (
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{asset.description}</p>
        )}
        <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
          {asset.expiry_date ? (
            <span className={days !== null && days <= 0 ? "font-semibold text-destructive" : days !== null && days <= 30 ? "text-yellow-700 font-semibold" : ""}>
              Expires <FormattedDate value={asset.expiry_date} />
              {days !== null && (
                <span className="ml-1">
                  ({days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "today" : `${days}d`})
                </span>
              )}
            </span>
          ) : (
            <span>No expiry</span>
          )}
          {asset.status === "archived" && (
            <span className="text-muted-foreground">Archived</span>
          )}
        </div>
      </div>
      <Button size="sm" variant="ghost" className="h-7 px-2 shrink-0" onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ─── Add / edit dialog ────────────────────────────────────────────────────────

interface FormDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  venue: Venue;
  existing?: ComplianceAsset;
  onSaved: () => void;
}

function AssetFormDialog({ open, onOpenChange, venue, existing, onSaved }: FormDialogProps) {
  const [name, setName] = useState(existing?.name ?? "");
  const [assetType, setAssetType] = useState(existing?.type ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [expiryDate, setExpiryDate] = useState(existing?.expiry_date ?? "");
  const [justification, setJustification] = useState("");
  const [archive, setArchive] = useState(false);

  const isEdit = !!existing;

  const saveMut = useMutation({
    mutationFn: () =>
      upsertComplianceAsset(
        {
          id: existing?.id ?? null,
          category: "FACILITY",
          type: assetType || "generic_resolve",
          name: name.trim(),
          description: description.trim() || null,
          subject_table: "venues",
          subject_id: venue.id,
          expiry_date: expiryDate || null,
          action_module: "generic_resolve" as ComplianceActionModule,
          config: existing?.config ?? {},
          status: archive ? "archived" : "active",
        },
        justification,
      ),
    onSuccess: () => {
      toast.success(isEdit ? "Asset updated." : "Asset added.");
      onSaved();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSave = name.trim().length >= 3 && justification.trim().length >= 20;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            <FileCheck2 className="mr-2 inline h-4 w-4" />
            {isEdit ? "Edit compliance asset" : "Add compliance asset"}
          </DialogTitle>
          <DialogDescription>
            Linked to: <span className="font-medium">{venue.name}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">
              Asset name <span className="text-destructive">*</span>
            </Label>
            <CharacterCountedInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={3}
              maxLength={120}
              placeholder="e.g. Public Liability Insurance 2026/27"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Asset type</Label>
            <Select value={assetType} onValueChange={setAssetType}>
              <SelectTrigger>
                <SelectValue placeholder="Select type…" />
              </SelectTrigger>
              <SelectContent>
                {VENUE_ASSET_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Description (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Policy number, issuer, notes…"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Expiry date</Label>
            <Input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              className="h-9"
            />
            <p className="text-[10px] text-muted-foreground">
              Traffic-light status (GREEN → YELLOW → RED) is based on days until expiry.
            </p>
          </div>

          {isEdit && (
            <div className="flex items-center gap-2 rounded border border-destructive/30 bg-destructive/5 px-3 py-2">
              <input
                type="checkbox"
                id="archive-check"
                checked={archive}
                onChange={(e) => setArchive(e.target.checked)}
                className="rounded"
              />
              <Label htmlFor="archive-check" className="text-xs font-medium cursor-pointer text-destructive">
                Archive this asset
              </Label>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">
              Change justification <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={2}
              placeholder="Min. 20 characters — reason for adding / updating this asset…"
              className={
                justification.length > 0 && justification.trim().length < 20
                  ? "border-2 border-destructive"
                  : ""
              }
            />
            <p className="text-[10px] text-muted-foreground">
              {justification.trim().length}/20 min characters
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!canSave || saveMut.isPending}
            onClick={() => saveMut.mutate()}
          >
            {saveMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
            {isEdit ? "Save changes" : "Add asset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
