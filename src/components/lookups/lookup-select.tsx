import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLookupParameters } from "@/hooks/use-supabase-data";

interface Props {
  /** `system_lookup_parameters.category` to query — e.g. `SERVICE_TYPE`. */
  category: string;
  value: string;
  onChange: (label: string, code: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** When true, the select stays disabled while the query is loading. */
  blockUntilLoaded?: boolean;
}

/**
 * Generic schema-driven dropdown. Hydrates options from
 * `system_lookup_parameters` filtered by `category`.
 *
 * Never inline an `<SelectItem>` array next to one of these and never wrap
 * with a hardcoded `Record<>` fallback — when the lookup is empty the
 * coordinator team has to fix the data, not the code.
 */
export function LookupSelect({
  category,
  value,
  onChange,
  placeholder,
  disabled,
  blockUntilLoaded = true,
}: Props) {
  const { data = [], isLoading, error } = useLookupParameters(category);

  const onValueChange = (label: string) => {
    const hit = data.find((p) => p.label === label);
    onChange(label, hit?.code ?? label);
  };

  return (
    <Select
      value={value || undefined}
      onValueChange={onValueChange}
      disabled={disabled || (blockUntilLoaded && isLoading)}
    >
      <SelectTrigger>
        <SelectValue
          placeholder={
            isLoading
              ? "Loading…"
              : error
                ? "Lookup unavailable"
                : (placeholder ?? "Select…")
          }
        />
      </SelectTrigger>
      <SelectContent>
        {data.length === 0 && !isLoading ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            No options configured for{" "}
            <span className="font-mono">{category}</span>.
          </div>
        ) : (
          data.map((opt) => (
            <SelectItem key={opt.id} value={opt.label}>
              {opt.label}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}
