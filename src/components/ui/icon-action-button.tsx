import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Icon-only action button with hover tooltip (BL-060).
 * Prefer this over bare `size="icon"` Buttons so operators can read the action
 * before clicking. `tooltip` also seeds `aria-label` when none is provided.
 */
export interface IconActionButtonProps extends Omit<ButtonProps, "size"> {
  /** Short hover label — e.g. "Open template", "Archive". */
  tooltip: string;
  side?: "top" | "right" | "bottom" | "left";
}

export const IconActionButton = React.forwardRef<
  HTMLButtonElement,
  IconActionButtonProps
>(function IconActionButton(
  {
    tooltip,
    side = "top",
    className,
    variant = "ghost",
    type = "button",
    "aria-label": ariaLabel,
    children,
    ...props
  },
  ref,
) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={ref}
          type={type}
          variant={variant}
          size="icon"
          className={cn(className)}
          aria-label={ariaLabel ?? tooltip}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={side}>{tooltip}</TooltipContent>
    </Tooltip>
  );
});
