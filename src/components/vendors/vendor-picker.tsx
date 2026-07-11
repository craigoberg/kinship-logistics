import { useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { findVendorByName, type Vendor } from "@/lib/api/vendors";

interface Props {
  value: string;
  onChange: (value: string) => void;
  vendors: Vendor[];
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Combobox vendor field — type to filter, pick from dropdown, or enter a new name.
 */
export function VendorPicker({
  value,
  onChange,
  vendors,
  disabled,
  placeholder = "Type to filter or pick a vendor…",
}: Props) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeVendors = useMemo(
    () => vendors.filter((v) => v.status === "active"),
    [vendors],
  );

  const filteredVendors = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return activeVendors;
    return activeVendors.filter((v) => v.name.toLowerCase().includes(q));
  }, [activeVendors, value]);

  const exactMatch = useMemo(
    () => (value.trim() ? findVendorByName(activeVendors, value) : null),
    [activeVendors, value],
  );

  function selectVendor(name: string) {
    onChange(name);
    setOpen(false);
    inputRef.current?.focus();
  }

  return (
    <div className="space-y-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="flex w-full">
            <Input
              ref={inputRef}
              value={value}
              onChange={(e) => {
                onChange(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              disabled={disabled}
              placeholder={placeholder}
              autoComplete="off"
              role="combobox"
              aria-expanded={open}
              aria-autocomplete="list"
              className="rounded-r-none border-r-0 focus-visible:z-10"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={disabled}
              aria-label="Show vendor list"
              className="shrink-0 rounded-l-none border-l-0 px-2.5"
              onClick={() => {
                setOpen((prev) => !prev);
                inputRef.current?.focus();
              }}
            >
              <ChevronsUpDown className="h-4 w-4 opacity-60" />
            </Button>
          </div>
        </PopoverAnchor>

        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-anchor-width)] p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
            {value.trim()
              ? `${filteredVendors.length} matching vendor${filteredVendors.length === 1 ? "" : "s"}`
              : `${activeVendors.length} vendor${activeVendors.length === 1 ? "" : "s"} — type to filter`}
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {filteredVendors.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No matching vendors.
                {value.trim() ? (
                  <>
                    {" "}
                    Press <span className="font-medium text-foreground">Save</span> to use &ldquo;
                    {value.trim()}&rdquo; or add it in Admin → Vendors.
                  </>
                ) : (
                  " Add vendors in Admin → Vendors."
                )}
              </p>
            ) : (
              filteredVendors.map((v) => {
                const selected = exactMatch?.id === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm",
                      "hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                      selected && "bg-muted/70",
                    )}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectVendor(v.name)}
                  >
                    <Check
                      className={cn("h-4 w-4 shrink-0", selected ? "opacity-100" : "opacity-0")}
                    />
                    <span className="truncate">{v.name}</span>
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>

      {exactMatch && value.trim() && (
        <p className="text-[11px] text-muted-foreground">
          Matches registry: <span className="font-medium text-foreground">{exactMatch.name}</span>
        </p>
      )}
    </div>
  );
}
