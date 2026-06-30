import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, RefreshCw } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  ADMIN_LOOKUP_CATEGORIES,
  deleteLookupParameter,
  insertLookupParameter,
  LOOKUP_CATEGORIES,
  updateLookupParameterColor,
  type LookupParameter,
} from "@/lib/data-store";
import {
  clearLookupCacheCategory,
  useLookupParameters,
} from "@/hooks/use-supabase-data";
import { TransportSiteAddressesPanel } from "@/components/admin/transport-site-addresses-panel";

/** Categories where each entry can have a badge color configured. */
const COLOR_ENABLED_CATEGORIES = new Set(["bus_runs", "transport_types"]);

/** Fallback palette cycled when a run has no configured color. */
const RUN_PALETTE = [
  "#7c3aed", // violet
  "#d97706", // amber
  "#0891b2", // cyan
  "#e11d48", // rose
  "#059669", // emerald
  "#7c2d12", // brown-orange
];

export function AdminLookupWorkspace() {
  const first = ADMIN_LOOKUP_CATEGORIES[0]?.category ?? "";
  const [active, setActive] = useState(first);

  return (
    <Tabs value={active} onValueChange={setActive} className="space-y-4">
      <TabsList>
        {ADMIN_LOOKUP_CATEGORIES.map((c) => (
          <TabsTrigger key={c.category} value={c.category}>
            {c.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {ADMIN_LOOKUP_CATEGORIES.map((c) => (
        <TabsContent key={c.category} value={c.category} className="space-y-4">
          <p className="text-sm text-muted-foreground">{c.description}</p>
          {c.category === LOOKUP_CATEGORIES.busRun && <TransportSiteAddressesPanel />}
          <CategoryPanel
            category={c.category}
            label={c.label}
            showColor={COLOR_ENABLED_CATEGORIES.has(c.category)}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function CategoryPanel({
  category,
  label,
  showColor,
}: {
  category: string;
  label: string;
  showColor: boolean;
}) {
  const qc = useQueryClient();
  const { data = [], isFetching, refetch } = useLookupParameters(category);
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");

  const invalidate = () => {
    clearLookupCacheCategory(category);
    qc.invalidateQueries({ queryKey: ["system_lookup_parameters", category], exact: true });
    // Also invalidate the directory indicators so badge colors refresh immediately.
    qc.invalidateQueries({ queryKey: ["participant-directory-indicators"] });
  };

  const insert = useMutation({
    mutationFn: () =>
      insertLookupParameter({
        category,
        code: code.trim(),
        displayName: displayName.trim() || code.trim(),
      }),
    onSuccess: async (inserted) => {
      // If a color was chosen and the category supports it, save it immediately.
      if (showColor && newColor && newColor !== "#3b82f6") {
        await updateLookupParameterColor(inserted.id, newColor);
      }
      invalidate();
      setCode("");
      setDisplayName("");
      setNewColor("#3b82f6");
      toast.success(`${label} entry added`);
    },
    onError: (e: Error) =>
      toast.error("Could not add entry", { description: e.message }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteLookupParameter(id),
    onSuccess: () => {
      invalidate();
      toast.success("Entry removed");
    },
    onError: (e: Error) =>
      toast.error("Could not remove entry", { description: e.message }),
  });

  const updateColor = useMutation({
    mutationFn: ({ id, color }: { id: string; color: string }) =>
      updateLookupParameterColor(id, color),
    onSuccess: () => {
      invalidate();
    },
    onError: (e: Error) =>
      toast.error("Could not save color", { description: e.message }),
  });

  const canSubmit = code.trim().length > 0 && !insert.isPending;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card/40 p-4">
      {/* ── Add entry form ─────────────────────────────────────────────── */}
      <div
        className={`grid gap-3 md:items-end ${
          showColor
            ? "md:grid-cols-[1fr_1fr_auto_auto]"
            : "md:grid-cols-[1fr_1fr_auto]"
        }`}
      >
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Code (stored value)
          </Label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. R3"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Display name
          </Label>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Visible label"
          />
        </div>
        {showColor && (
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Badge colour
            </Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="h-9 w-14 cursor-pointer rounded border border-input bg-input p-0.5"
                title="Pick badge colour"
              />
              <span className="text-xs font-mono text-muted-foreground">{newColor}</span>
            </div>
          </div>
        )}
        <Button
          onClick={() => insert.mutate()}
          disabled={!canSubmit}
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" />
          {insert.isPending ? "Adding…" : "Add entry"}
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {data.length} {data.length === 1 ? "entry" : "entries"} configured
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            invalidate();
            refetch();
          }}
          className="gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* ── Entry table ────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Code</th>
              <th className="px-3 py-2 text-left">Display name</th>
              {showColor && <th className="px-3 py-2 text-left">Badge colour</th>}
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td
                  colSpan={showColor ? 4 : 3}
                  className="px-3 py-6 text-center text-xs text-muted-foreground"
                >
                  No entries yet. Add one above to expose it across the app.
                </td>
              </tr>
            ) : (
              data.map((row: LookupParameter, idx: number) => {
                // Effective color: stored color → palette fallback for runs → null
                const effectiveColor =
                  row.badgeColor ??
                  (category === "bus_runs"
                    ? RUN_PALETTE[idx % RUN_PALETTE.length]
                    : null);

                return (
                  <tr key={row.id} className="border-t border-border/60">
                    <td className="px-3 py-2 font-mono text-xs">{row.code}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {effectiveColor && (
                          <span
                            className="inline-flex h-5 min-w-[2.5rem] items-center justify-center rounded px-1.5 text-[10px] font-bold text-white"
                            style={{ backgroundColor: effectiveColor }}
                          >
                            {row.displayName}
                          </span>
                        )}
                        {!effectiveColor && row.displayName}
                      </div>
                    </td>
                    {showColor && (
                      <td className="px-3 py-2">
                        <ColorCell
                          row={row}
                          fallback={effectiveColor}
                          onSave={(color) =>
                            updateColor.mutate({ id: row.id, color })
                          }
                          isSaving={updateColor.isPending}
                        />
                      </td>
                    )}
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => remove.mutate(row.id)}
                        disabled={remove.isPending}
                        className="gap-1.5 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Inline color picker cell — change fires save immediately. */
function ColorCell({
  row,
  fallback,
  onSave,
  isSaving,
}: {
  row: LookupParameter;
  fallback: string | null;
  onSave: (color: string) => void;
  isSaving: boolean;
}) {
  const current = row.badgeColor ?? fallback ?? "#3b82f6";
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        defaultValue={current}
        onChange={(e) => onSave(e.target.value)}
        disabled={isSaving}
        className="h-8 w-10 cursor-pointer rounded border border-input bg-input p-0.5 disabled:opacity-50"
        title="Click to change badge colour"
      />
      <span className="font-mono text-xs text-muted-foreground">{current}</span>
      {!row.badgeColor && (
        <span className="text-[10px] text-muted-foreground/60 italic">default</span>
      )}
    </div>
  );
}
