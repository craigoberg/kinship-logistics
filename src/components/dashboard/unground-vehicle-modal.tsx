import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Truck } from "lucide-react";

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

import {
  resolveStaffIdWithFallback,
  type OperationalEscalation,
} from "@/lib/data-store";
import { supabase } from "@/integrations/supabase/client";
import { writeToLedger, tryGetGps } from "@/lib/api/ledger";

const MIN_NOTES = 20;

interface Props {
  escalation: OperationalEscalation | null;
  onClose: () => void;
  onUngrounded?: () => void;
}

export function UngroundVehicleModal({ escalation, onClose, onUngrounded }: Props) {
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!escalation) setNotes("");
  }, [escalation]);

  const trimmed = notes.trim();
  const tooShort = trimmed.length < MIN_NOTES;

  const submit = async () => {
    if (!escalation || submitting) return;
    if (tooShort) {
      toast.error(`Safety Clearance Notes must be at least ${MIN_NOTES} characters.`);
      return;
    }
    setSubmitting(true);
    try {
      const staffId = await resolveStaffIdWithFallback();
      const { error } = await supabase
        .from("operational_escalations")
        .update({
          status: "resolved_approved",
          resolution_notes: trimmed,
          resolved_by: staffId,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", escalation.id);
      if (error) throw error;

      // NDIS compliance log — Who/Where/What/Why. Fire-and-forget.
      const gps = await tryGetGps();
      void writeToLedger({
        staff_id: staffId,
        category: "VEHICLE",
        severity: "GREEN",
        action_type: "VEHICLE_RELEASED",
        gps_lat: gps?.lat ?? null,
        gps_lng: gps?.lng ?? null,
        metadata: {
          escalation_id: escalation.id,
          vehicle_info: escalation.vehicleInfo ?? null,
          driver_name: escalation.driverName ?? null,
          previous_status: "resolved_denied",
          clearance_notes: trimmed,
          source: "unground_vehicle_modal",
        },
      });

      toast.success("Vehicle back in service", {
        description: `${escalation.vehicleInfo} cleared for operations.`,
      });
      onUngrounded?.();
      onClose();
    } catch (err) {
      toast.error("Could not unground vehicle", {
        description: (err as Error).message,
      });
    } finally {
      setSubmitting(false);
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
            <Truck className="h-5 w-5 text-emerald-600" />
            Unground Vehicle — Safety Clearance
          </DialogTitle>
          <DialogDescription>
            Return this vehicle to active service. Your clearance notes are
            permanently logged to the operational ledger for NDIS compliance.
          </DialogDescription>
        </DialogHeader>

        {escalation && (
          <div className="space-y-4">
            <div className="grid gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
              <Row label="Vehicle" value={escalation.vehicleInfo} />
              <Row label="Grounded by" value={escalation.resolvedBy ?? "—"} />
              {escalation.resolutionNotes && (
                <Row label="Reason" value={escalation.resolutionNotes} />
              )}
            </div>

            <div className="grid gap-1.5">
              <Label
                htmlFor="ug-notes"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                Safety Clearance Notes (min {MIN_NOTES} chars)
              </Label>
              <Textarea
                id="ug-notes"
                rows={5}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Describe inspection performed, defect resolution, and who verified roadworthiness."
              />
              <div className="flex justify-end text-[11px] text-muted-foreground tabular-nums">
                {trimmed.length}/{MIN_NOTES}
              </div>
            </div>

            <Button
              type="button"
              disabled={submitting || tooShort}
              onClick={submit}
              className="h-14 w-full bg-emerald-600 text-base font-bold text-white hover:bg-emerald-700"
            >
              {submitting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <ShieldCheck className="mr-1.5 h-5 w-5" />
                  Release Vehicle Back to Service
                </>
              )}
            </Button>
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
