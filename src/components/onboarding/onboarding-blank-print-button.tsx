import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OnboardingPrintPortal } from "@/components/onboarding/onboarding-print-view";
import {
  emptyPayloadForPack,
  type OnboardingPackType,
} from "@/lib/onboarding/form-types";

const BLANK_PRINT_LABELS: Record<OnboardingPackType, string> = {
  client: "Print blank client",
  staff: "Print blank staff",
  volunteer: "Print blank volunteer",
  accompanying: "Print blank accompanying",
};

interface Props {
  pack: OnboardingPackType;
  size?: "sm" | "default";
  variant?: "outline" | "ghost";
}

/** Print an empty pack immediately — no draft, no confirm, no fields. */
export function OnboardingBlankPrintButton({
  pack,
  size = "sm",
  variant = "outline",
}: Props) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => {
      window.print();
      setArmed(false);
    }, 400);
    return () => window.clearTimeout(t);
  }, [armed]);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className="gap-1.5"
        onClick={() => setArmed(true)}
      >
        <Printer className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
        {BLANK_PRINT_LABELS[pack]}
      </Button>
      {armed ? (
        <OnboardingPrintPortal payload={emptyPayloadForPack(pack)} blank />
      ) : null}
    </>
  );
}
