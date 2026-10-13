import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { FieldActionButton } from "@/components/ui/field-action-button";
import { NumericEntryTrigger } from "@/components/ui/numeric-entry-dialog";
import { useAssetCurrentOdometer } from "@/hooks/use-supabase-data";
import { useOdoStartVsLastWarnKm } from "@/hooks/use-system-parameters";
import { absDiffExceeds } from "@/lib/manifest-odometer";
import {
  CAUTION_CALLOUT_BODY_CLASS,
  CAUTION_CALLOUT_CLASS,
  CAUTION_CALLOUT_ICON_CLASS,
} from "@/lib/ui/caution-callout";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import { cn } from "@/lib/utils";

/**
 * Dash reading for the start of this run.
 * Shown on vehicle clearance (full walkaround and Fast Pass), after the vehicle is checked out.
 * The last known figure is a suggestion. Continue stays off until the driver confirms the dash.
 */
export function StartingKmConfirm({
  assetId,
  onReading,
}: {
  assetId: string;
  /** Confirmed dash reading, or null until the driver confirms it. */
  onReading: (km: number | null) => void;
}) {
  const startVsLastWarnKm = useOdoStartVsLastWarnKm();
  const { data: assetCurrentOdo = null } = useAssetCurrentOdometer(assetId || null);
  const [odo, setOdo] = useState("");
  const [odoDirty, setOdoDirty] = useState(false);
  const [warnAck, setWarnAck] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const odoNum = odo === "" ? NaN : Number(odo);
  const odoReasonable = Number.isFinite(odoNum) && odoNum > 0 && odoNum < 10_000_000;
  const startDiffersFromLast =
    assetCurrentOdo != null &&
    odoReasonable &&
    absDiffExceeds(odoNum, assetCurrentOdo, startVsLastWarnKm);
  const startBelowLast = assetCurrentOdo != null && odoReasonable && odoNum < assetCurrentOdo;
  const varianceOpen = (startDiffersFromLast || startBelowLast) && !warnAck;
  const ready = odoReasonable && confirmed && !varianceOpen;

  useEffect(() => {
    if (!assetId || assetCurrentOdo == null || odoDirty) return;
    const next = String(Math.round(assetCurrentOdo));
    if (odo === next) return;
    setOdo(next);
    setWarnAck(false);
    setConfirmed(false);
  }, [assetId, assetCurrentOdo, odoDirty, odo]);

  useEffect(() => {
    onReading(ready ? odoNum : null);
  }, [ready, odoNum, onReading]);

  return (
    <div className="grid gap-2">
      <NumericEntryTrigger
        id="start-km"
        label="Starting odometer"
        value={odo}
        onChange={(v) => {
          setOdo(v);
          setOdoDirty(true);
          setWarnAck(false);
          setConfirmed(false);
        }}
        placeholder="Tap to enter the reading"
        title="Starting odometer"
        description={
          assetCurrentOdo != null
            ? `Last known reading for this vehicle: ${Math.round(assetCurrentOdo)}. Enter the number on the odometer now.`
            : "Read the number on the odometer. This is the reading, not the kilometres you will travel."
        }
        step={1}
        allowDecimal={false}
        min={1}
        unit="km"
        className={requiredFieldOutline(!odoReasonable)}
      />
      {!odoReasonable && (
        <p className="text-sm font-medium text-destructive">Enter the odometer reading on the dash.</p>
      )}
      {assetCurrentOdo != null && (
        <p className="text-[11px] text-muted-foreground">
          Vehicle current (est.):{" "}
          <span className="tabular-nums font-medium">{Math.round(assetCurrentOdo)} km</span>
          {!odoDirty && odoNum === Math.round(assetCurrentOdo) && " · pre-filled"}
        </p>
      )}
      {(startDiffersFromLast || startBelowLast) && assetCurrentOdo != null && (
        <div className={cn("space-y-3 p-3 text-sm", CAUTION_CALLOUT_CLASS)}>
          <div className="flex items-start gap-2">
            <AlertTriangle className={cn("mt-0.5 h-4 w-4", CAUTION_CALLOUT_ICON_CLASS)} />
            <p className={CAUTION_CALLOUT_BODY_CLASS}>
              {startBelowLast
                ? `Start (${odoNum} km) is below the last known reading (${Math.round(assetCurrentOdo)} km). Check for a fat-finger — Admin can correct later on Fleet.`
                : `Start differs from last known by ${Math.abs(odoNum - assetCurrentOdo)} km (warn at ${startVsLastWarnKm} km). OK if the bus was driven (e.g. petrol).`}
            </p>
          </div>
          <div className="grid gap-2">
            <FieldActionButton
              variant="primary"
              size="sm"
              onClick={() => {
                setOdo(String(Math.round(assetCurrentOdo)));
                setOdoDirty(false);
                setWarnAck(false);
                setConfirmed(false);
              }}
            >
              Use {Math.round(assetCurrentOdo)} km (suggested)
            </FieldActionButton>
            <FieldActionButton
              variant={warnAck ? "success" : "caution"}
              size="sm"
              pulse={!warnAck}
              onClick={() => {
                setWarnAck(true);
                setConfirmed(true);
              }}
            >
              {warnAck ? "Accepted — continue below" : "Accept this starting reading"}
            </FieldActionButton>
          </div>
        </div>
      )}
      {odoReasonable && !(startDiffersFromLast || startBelowLast) && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Check the dash. The bus may have moved since the last reading (petrol, maintenance, shopping).
          </p>
          <FieldActionButton
            type="button"
            variant={confirmed ? "success" : "caution"}
            pulse={!confirmed}
            onClick={() => setConfirmed(true)}
          >
            {confirmed ? `Starting kilometres confirmed — ${odoNum} km` : `Confirm ${odoNum} km is on the dash`}
          </FieldActionButton>
        </div>
      )}
    </div>
  );
}
