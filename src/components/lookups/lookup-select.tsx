import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLookupParameters } from "@/hooks/use-supabase-data";

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
  const { data = [], isLoading, error, isFetched } = useLookupParameters(category);

  const onValueChange = (code: string) => {
    const hit = data.find((p) => p.code === code);
    onChange(code, hit?.displayName ?? code);
  };

  const noOptions = data.length === 0 && isFetched;

  return (
    <Select
      value={value || undefined}
      onValueChange={onValueChange}
      disabled={disabled || (blockUntilLoaded && isLoading && data.length === 0)}
    >
      <SelectTrigger>
        <SelectValue
          placeholder={
            isLoading && data.length === 0
              ? "Loading…"
              : error && data.length === 0
                ? "Lookup unavailable (offline)"
                : (placeholder ?? "Select…")
          }
        />
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
  );
}
