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
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

import {
  resolveStaffIdWithFallback,
  supersedeOlderGroundedForVehicle,
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
  const charCount = trimmed.length;
  const tooShort = charCount < MIN_NOTES;
  const progress = Math.min(100, Math.round((charCount / MIN_NOTES) * 100));

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

      // Clean up earlier denials for the same vehicle so the dashboard
      // doesn't keep re-surfacing superseded groundings.
      let supersededCount = 0;
      try {
        supersededCount = await supersedeOlderGroundedForVehicle(
          escalation.vehicleInfo,
          escalation.id,
        );
      } catch (e) {
        console.warn("[unground] supersede older groundings failed", e);
      }

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
          superseded_older_count: supersededCount,
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
      <DialogContent className="sm:max-w-md gap-3 p-5">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Truck className="h-4 w-4 text-emerald-600" />
            Unground Vehicle
          </DialogTitle>
          <DialogDescription className="text-xs">
            Clearance notes are permanently logged to the operational ledger
            for NDIS compliance.
          </DialogDescription>
        </DialogHeader>

        {escalation && (
          <div className="space-y-3">
            <div className="grid gap-1.5 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
              <Row label="Vehicle" value={escalation.vehicleInfo} />
              {escalation.resolutionNotes && (
                <Row label="Reason" value={escalation.resolutionNotes} />
              )}
            </div>

            <div className="grid gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="ug-notes" className="text-sm font-semibold">
                  Safety Clearance Notes
                </Label>
                <span
                  className={cn(
                    "text-[11px] tabular-nums",
                    tooShort ? "text-muted-foreground" : "text-emerald-600",
                  )}
                >
                  {tooShort ? `${MIN_NOTES - charCount} more` : "Ready"}
                </span>
              </div>
              <Textarea
                id="ug-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Inspection performed, defect resolution, who verified roadworthiness…"
                className="resize-none text-sm"
              />
              <Progress
                value={progress}
                className={cn(
                  "h-1",
                  !tooShort && "[&>div]:bg-emerald-600",
                )}
                aria-label={`Clearance notes ${charCount} of ${MIN_NOTES} minimum characters`}
              />
            </div>

            <Button
              type="button"
              disabled={submitting || tooShort}
              onClick={submit}
              className="h-11 w-full bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-700"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <ShieldCheck className="mr-1.5 h-4 w-4" />
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
      <span className="w-16 shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-xs font-medium text-foreground">{value}</span>
    </div>
  );
}
