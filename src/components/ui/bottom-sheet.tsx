/**
 * BottomSheet — mobile-first slide-up panel.
 * Uses the existing Radix Sheet (side=bottom) with driver-friendly sizing.
 * On a phone this fills most of the viewport; on desktop it stays max-h-[60vh].
 */
import type { ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Extra class on the content panel — e.g. to set a custom bg. */
  className?: string;
}

export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: BottomSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className={cn(
          // Sizing: tall on mobile, capped on desktop
          "max-h-[92dvh] overflow-y-auto rounded-t-2xl",
          // Safe area below home bar
          "pb-[max(env(safe-area-inset-bottom),16px)]",
          className,
        )}
      >
        <SheetHeader className="mb-4">
          <SheetTitle className="text-left text-lg">{title}</SheetTitle>
          {description && (
            <SheetDescription className="text-left text-sm">{description}</SheetDescription>
          )}
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  );
}
