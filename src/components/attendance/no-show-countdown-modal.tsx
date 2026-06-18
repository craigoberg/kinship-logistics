import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Phone, UserX } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { usePrimaryCarer } from "@/hooks/use-supabase-data";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participantId: string;
  participantName: string;
  /** Countdown in seconds. Defaults to 5 minutes. */
  durationSeconds?: number;
}

function formatClock(s: number): string {
  const m = Math.floor(Math.max(0, s) / 60);
  const sec = Math.max(0, s) % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function NoShowCountdownModal({
  open,
  onOpenChange,
  participantId,
  participantName,
  durationSeconds = 300,
}: Props) {
  const [remaining, setRemaining] = useState(durationSeconds);
  const { data: carer, isLoading } = usePrimaryCarer(participantId);

  useEffect(() => {
    if (!open) return;
    setRemaining(durationSeconds);
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setRemaining(Math.max(0, durationSeconds - elapsed));
    }, 250);
    return () => window.clearInterval(id);
  }, [open, durationSeconds]);

  const expired = remaining <= 0;
  const critical = remaining <= 60;
  const clockClass = useMemo(
    () =>
      expired
        ? "text-destructive animate-pulse"
        : critical
          ? "text-destructive animate-pulse"
          : "text-foreground",
    [expired, critical],
  );

  const telHref = carer?.phone ? `tel:${carer.phone.replace(/[^+\d]/g, "")}` : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-2 border-destructive bg-card">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <DialogTitle className="text-destructive">
              No-Show Countdown · {participantName}
            </DialogTitle>
          </div>
          <DialogDescription>
            5-minute window to confirm arrival before escalating to the primary carer.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-2 py-2">
          <div
            className={
              "font-mono text-6xl font-extrabold tabular-nums tracking-widest " +
              clockClass
            }
          >
            {formatClock(remaining)}
          </div>
          {expired && (
            <div className="text-sm font-semibold uppercase tracking-wide text-destructive">
              Timer expired — escalate immediately
            </div>
          )}
        </div>

        <div className="rounded-lg border-2 border-destructive/50 bg-destructive/10 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-destructive">
            Primary Emergency Carer
          </div>
          {isLoading ? (
            <div className="py-4 text-center text-sm text-muted-foreground">Loading carer…</div>
          ) : carer ? (
            <div className="mt-2 space-y-2">
              <div className="text-3xl font-extrabold leading-tight">{carer.fullName}</div>
              {carer.relationship && (
                <div className="text-base font-medium text-muted-foreground">
                  Relationship: <span className="text-foreground">{carer.relationship}</span>
                </div>
              )}
              {carer.phone ? (
                <a
                  href={telHref ?? "#"}
                  className="mt-2 flex items-center justify-center gap-2 rounded-md bg-destructive px-4 py-3 text-2xl font-bold tracking-wide text-destructive-foreground transition hover:brightness-110"
                >
                  <Phone className="h-6 w-6" />
                  {carer.phone}
                </a>
              ) : (
                <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                  No phone number on file for this carer.
                </div>
              )}
              {carer.streetAddress && (
                <div className="text-xs text-muted-foreground">📍 {carer.streetAddress}</div>
              )}
            </div>
          ) : (
            <div className="mt-2 flex items-start gap-2 rounded-md bg-background/60 p-3 text-sm">
              <UserX className="mt-0.5 h-4 w-4 text-destructive" />
              <div>
                <div className="font-semibold text-destructive">
                  No primary carer recorded for {participantName}.
                </div>
                <div className="text-xs text-muted-foreground">
                  Open the participant profile and complete the “Primary Carer &amp; Emergency
                  Network” section so this overlay can dispatch a contact next time.
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close overlay
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
