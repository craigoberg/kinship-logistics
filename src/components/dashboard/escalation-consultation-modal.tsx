import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  resolveStaffIdWithFallback,
  type OperationalEscalation,
} from "@/lib/data-store";
import { supabase } from "@/integrations/supabase/client";
import { prettyGateLabel } from "@/lib/operational-forms";

interface Props {
  escalation: OperationalEscalation | null;
  onClose: () => void;
}

export function EscalationConsultationModal({ escalation, onClose }: Props) {
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState<
    null | "resolved_approved" | "resolved_denied"
  >(null);

  useEffect(() => {
    if (!escalation) setNotes("");
  }, [escalation]);

  const resolve = async (status: "resolved_approved" | "resolved_denied") => {
    if (!escalation || submitting) return;
    if (!notes.trim()) {
      toast.error("Add a workaround note for the driver before resolving.");
      return;
    }
    setSubmitting(status);
    try {
      const staffId = getStaffId() || DEFAULT_STAFF_UUID;
      const { error } = await supabase
        .from("operational_escalations")
        .update({
          status,
          resolution_notes: notes.trim(),
          resolved_by: staffId,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", escalation.id);
      if (error) throw error;
      toast.success(
        status === "resolved_approved"
          ? "Workaround sent — driver cleared to roll."
          : "Escalation denied — driver instructed to hold.",
      );
      onClose();
    } catch (err) {
      toast.error("Could not resolve escalation", {
        description: (err as Error).message,
      });
    } finally {
      setSubmitting(null);
    }
  };

  const open = !!escalation;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !submitting) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            Sev 1 Consultation — Workaround Decision
          </DialogTitle>
          <DialogDescription>
            Communicate a clear instruction back to the driver. Their tablet is
            paused on the handshake screen.
          </DialogDescription>
        </DialogHeader>

        {escalation && (
          <div className="space-y-4">
            <div className="grid gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
              <Row label="Driver" value={escalation.driverName} />
              <Row label="Vehicle" value={escalation.vehicleInfo} />
              <Row
                label="Failed Gate"
                value={prettyGateLabel(escalation.gateId)}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="esc-notes" className="text-xs uppercase tracking-wide text-muted-foreground">
                Workaround instructions to driver
              </Label>
              <Textarea
                id="esc-notes"
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Proceed without missing passenger — confirmed with coordinator at 0830. Log absence on return."
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                disabled={!!submitting}
                onClick={() => resolve("resolved_approved")}
                className={cn(
                  "h-14 w-full bg-emerald-600 text-base font-bold text-white hover:bg-emerald-700",
                )}
              >
                {submitting === "resolved_approved" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <ShieldCheck className="mr-1.5 h-5 w-5" /> Approve &amp; Send Workaround
                  </>
                )}
              </Button>
              <Button
                type="button"
                disabled={!!submitting}
                onClick={() => resolve("resolved_denied")}
                className="h-14 w-full bg-rose-600 text-base font-bold text-white hover:bg-rose-700"
              >
                {submitting === "resolved_denied" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>🛑 Deny — Do Not Roll</>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-24 shrink-0 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}
