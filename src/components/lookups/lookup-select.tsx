import { useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLookupParameters, clearLookupCacheCategory } from "@/hooks/use-supabase-data";

interface Props {
  /** `system_lookup_parameters.category` to query — e.g. `service_types`. */
  category: string;
  /** Current selection — the lookup `code`. */
  value: string;
  /** Receives the selected `code` and its `display_name`. */
  onChange: (code: string, displayName: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** When true, the select stays disabled while the query is loading. */
  blockUntilLoaded?: boolean;
}

/**
 * Generic schema-driven dropdown. Hydrates options from
 * `system_lookup_parameters` filtered by `category`. Uses `code` as the
 * stored internal value and `display_name` as the visible label.
 *
 * Offline-safe: the underlying hook seeds from a localStorage cache and
 * shows a neutral "unavailable" trigger instead of crashing.
 */
export function LookupSelect({
  category,
  value,
  onChange,
  placeholder,
  disabled,
  blockUntilLoaded = true,
}: Props) {
  const queryClient = useQueryClient();
  const { data = [], isLoading, error, isFetched, refetch } = useLookupParameters(category);

  const onValueChange = (code: string) => {
    const hit = data.find((p) => p.code === code);
    onChange(code, hit?.displayName ?? code);
  };

  const noOptions = data.length === 0 && isFetched;

  const handleRefresh = useCallback(() => {
    clearLookupCacheCategory(category);
    queryClient.invalidateQueries({ queryKey: ["system_lookup_parameters", category], exact: true });
    refetch();
  }, [category, queryClient, refetch]);

  const triggerPlaceholder =
    isLoading && data.length === 0
      ? "Loading…"
      : error && data.length === 0
        ? "Lookup unavailable (offline)"
        : (placeholder ?? "Select…");

  return (
    <div className="flex items-center gap-2">
      <Select
        value={value || undefined}
        onValueChange={onValueChange}
        disabled={disabled || (blockUntilLoaded && isLoading && data.length === 0)}
      >
        <SelectTrigger>
          <SelectValue placeholder={triggerPlaceholder} />
        </SelectTrigger>
        <SelectContent>
          {noOptions ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              No options configured for{" "}
              <span className="font-mono">{category}</span>.
            </div>
          ) : (
            data.map((opt) => (
              <SelectItem key={opt.id} value={opt.code}>
                {opt.displayName}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
      <button
        type="button"
        onClick={handleRefresh}
        title="Retry / Refresh Parameters"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-card/50 text-foreground transition-colors hover:bg-primary/20 hover:text-primary focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="Retry / Refresh Parameters"
      >
        <RefreshCw
          className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
        />
      </button>
    </div>
  );
}
