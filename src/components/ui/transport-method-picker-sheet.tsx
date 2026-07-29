/**
 * One-tap method picker — saves selection and closes (does not check-in/out).
 */
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import type {
  FloorMethodPickerOption,
  FloorTransportSelection,
} from "@/lib/ui/floor-transport-method";
import { floorSelectionKey } from "@/lib/ui/floor-transport-method";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  options: FloorMethodPickerOption[];
  selected: FloorTransportSelection | null;
  pending?: boolean;
  onSelect: (next: FloorTransportSelection) => void;
}

export function TransportMethodPickerSheet({
  open,
  onOpenChange,
  title,
  description,
  options,
  selected,
  pending,
  onSelect,
}: Props) {
  const selectedKey = selected ? floorSelectionKey(selected) : "";

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
    >
      <div className="space-y-2 pb-2 pt-1">
        {options.map((opt) => {
          const key = floorSelectionKey({
            kind: opt.kind,
            busRunCode: opt.busRunCode,
            label: opt.label,
          });
          return (
            <MobileFieldButton
              key={opt.id}
              title={opt.title}
              subtitle={opt.subtitle}
              active={key === selectedKey}
              disabled={pending}
              onClick={() => {
                onSelect({
                  kind: opt.kind,
                  busRunCode: opt.busRunCode,
                  label: opt.label,
                });
                onOpenChange(false);
              }}
            />
          );
        })}
      </div>
    </BottomSheet>
  );
}
