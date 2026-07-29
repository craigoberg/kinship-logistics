/**
 * Compact solid-fill chip for manager Health & Safety / emergency actions.
 * Style guide: "Manager ops toolbar" — never thin outline on dark UI.
 */
import type { ReactNode } from "react";
import {
  FieldActionButton,
  type FieldActionVariant,
} from "@/components/ui/field-action-button";

export type ManagerOpsTone = "emergency" | "caution" | "neutral";

const TONE_TO_VARIANT: Record<ManagerOpsTone, FieldActionVariant> = {
  emergency: "destructive",
  caution: "caution",
  neutral: "secondary",
};

export function ManagerOpsChip(props: {
  tone: ManagerOpsTone;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  /** Toolbar wrap (default) vs full-width stack (Event Deliver / Manifest). */
  layout?: "chip" | "stack";
  className?: string;
  type?: "button" | "submit";
}) {
  const {
    tone,
    onClick,
    children,
    disabled,
    layout = "chip",
    className,
    type = "button",
  } = props;

  return (
    <FieldActionButton
      type={type}
      variant={TONE_TO_VARIANT[tone]}
      size="sm"
      fullWidth={layout === "stack"}
      disabled={disabled}
      onClick={onClick}
      className={className}
    >
      {children}
    </FieldActionButton>
  );
}
