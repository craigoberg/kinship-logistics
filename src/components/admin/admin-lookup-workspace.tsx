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
  type LookupParameter,
} from "@/lib/data-store";
import {
  clearLookupCacheCategory,
  useLookupParameters,
} from "@/hooks/use-supabase-data";

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
          <CategoryPanel category={c.category} label={c.label} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function CategoryPanel({
  category,
  label,
}: {
  category: string;
  label: string;
}) {
  const qc = useQueryClient();
  const { data = [], isFetching, refetch } = useLookupParameters(category);
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");

  const insert = useMutation({
    mutationFn: () =>
      insertLookupParameter({
        category,
        code: code.trim(),
        displayName: displayName.trim() || code.trim(),
      }),
    onSuccess: () => {
      clearLookupCacheCategory(category);
      qc.invalidateQueries({
        queryKey: ["system_lookup_parameters", category],
        exact: true,
      });
      setCode("");
      setDisplayName("");
      toast.success(`${label} entry added`);
    },
    onError: (e: Error) =>
      toast.error("Could not add entry", { description: e.message }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteLookupParameter(id),
    onSuccess: () => {
      clearLookupCacheCategory(category);
      qc.invalidateQueries({
        queryKey: ["system_lookup_parameters", category],
        exact: true,
      });
      toast.success("Entry removed");
    },
    onError: (e: Error) =>
      toast.error("Could not remove entry", { description: e.message }),
  });

  const canSubmit = code.trim().length > 0 && !insert.isPending;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card/40 p-4">
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Code (stored value)
          </Label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. Saturday"
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
            clearLookupCacheCategory(category);
            qc.invalidateQueries({
              queryKey: ["system_lookup_parameters", category],
              exact: true,
            });
            refetch();
          }}
          className="gap-1.5"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Code</th>
              <th className="px-3 py-2 text-left">Display name</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-3 py-6 text-center text-xs text-muted-foreground"
                >
                  No entries yet. Add one above to expose it across the app.
                </td>
              </tr>
            ) : (
              data.map((row: LookupParameter) => (
                <tr key={row.id} className="border-t border-border/60">
                  <td className="px-3 py-2 font-mono text-xs">{row.code}</td>
                  <td className="px-3 py-2">{row.displayName}</td>
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
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
