// Per-card check-out trigger. Three quick-tap departure vector buttons —
// Bus / Family / Independent — that call checkOutParticipant() on the
// attendance row. Used in attendance-roll-panel.tsx beside the Clock icon
// when status === 'checked_in'.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bus, Home, LogOut, User } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  checkOutParticipant,
  type ClientAttendanceRow,
  type DepartureVector,
} from "@/lib/api/client-attendance";

interface Props {
  row: ClientAttendanceRow;
  participantName: string;
  onCheckedOut: () => void;
}

const VECTORS: { code: DepartureVector; label: string; Icon: typeof Bus }[] = [
  { code: "bus", label: "Bus", Icon: Bus },
  { code: "family", label: "Family", Icon: Home },
  { code: "independent", label: "Independent", Icon: User },
];

export function CheckOutPopover({ row, participantName, onCheckedOut }: Props) {
  const [open, setOpen] = useState(false);

  const mut = useMutation({
    mutationFn: (vector: DepartureVector) => checkOutParticipant(row, vector),
    onSuccess: (_result, vector) => {
      toast.success(`${participantName} checked out via ${vector}.`, {
        description:
          _result.departureAutoCloseOutcome === "red_left_open"
            ? "RED issue remains open in the Governance Hub for manager review."
            : _result.departureAutoCloseOutcome === "yellow_closed"
              ? "YELLOW departure issue auto-resolved."
              : undefined,
      });
      setOpen(false);
      onCheckedOut();
    },
    onError: (e: Error) =>
      toast.error("Check-out failed", { description: e.message }),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          aria-label={`Check out ${participantName}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              setOpen(true);
            }
          }}
          className={cn(
            "inline-flex items-center justify-center rounded-md p-2",
            "min-h-11 min-w-11 cursor-pointer",
            "border border-slate-300 bg-white hover:bg-slate-100",
            "text-slate-900 shadow-sm",
          )}
        >
          <LogOut className="h-4 w-4" />
        </span>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Check out via…
        </div>
        <div className="flex flex-col gap-1">
          {VECTORS.map(({ code, label, Icon }) => (
            <Button
              key={code}
              variant="ghost"
              className="h-11 touch-manipulation justify-start text-sm"
              disabled={mut.isPending}
              onClick={() => mut.mutate(code)}
            >
              <Icon className="mr-2 h-4 w-4" />
              {label}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
