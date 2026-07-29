import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { parseIsoDateLocal, toIsoDateString } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useInsertFleetAsset,
  useUpdateFleetAsset,
} from "@/hooks/use-supabase-data";
import type { TransportAsset } from "@/lib/data-store";
import { correctFleetOdometer, FLEET_VEHICLE_CATEGORIES } from "@/lib/api/fleet";
import { invalidateFleetCaches } from "@/lib/query/invalidation";
import { MIN_TIMELINE_NOTE } from "@/lib/governance/constants";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: TransportAsset | null;
}

export function FleetAssetFormSheet({ open, onOpenChange, asset }: Props) {
  const isEdit = !!asset;
  const [name, setName] = useState("");
  const [makeModel, setMakeModel] = useState("");
  const [regoPlate, setRegoPlate] = useState("");
  const [passengerCapacity, setPassengerCapacity] = useState("12");
  const [vehicleCategory, setVehicleCategory] = useState("bus");
  const [vin, setVin] = useState("");
  const [registrationExpiry, setRegistrationExpiry] = useState("");
  const [serviceIntervalKm, setServiceIntervalKm] = useState("");
  const [lastServiceOdo, setLastServiceOdo] = useState("");
  const [lastServiceDate, setLastServiceDate] = useState("");
  const [hasWheelchairHoist, setHasWheelchairHoist] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [correctOdo, setCorrectOdo] = useState("");
  const [correctJustification, setCorrectJustification] = useState("");
  const [correctBusy, setCorrectBusy] = useState(false);

  const qc = useQueryClient();
  const insert = useInsertFleetAsset();
  const update = useUpdateFleetAsset();
  const busy = insert.isPending || update.isPending || correctBusy;

  useEffect(() => {
    if (!open) return;
    setName(asset?.name ?? "");
    setMakeModel(asset?.makeModel ?? "");
    setRegoPlate(asset?.regoPlate ?? "");
    setPassengerCapacity(String(asset?.passengerCapacity ?? 12));
    setVehicleCategory(asset?.vehicleCategory ?? "bus");
    setVin(asset?.vin ?? "");
    setRegistrationExpiry(asset?.registrationExpiry ?? "");
    setServiceIntervalKm(
      asset?.serviceIntervalKm == null ? "" : String(asset.serviceIntervalKm),
    );
    setLastServiceOdo(asset?.lastServiceOdo == null ? "" : String(asset.lastServiceOdo));
    setLastServiceDate(asset?.lastServiceDate ?? "");
    setHasWheelchairHoist(asset?.hasWheelchairHoist ?? false);
    setIsActive(asset?.isActive ?? true);
    setCorrectOdo(
      asset?.currentOdometerKm == null ? "" : String(Math.round(asset.currentOdometerKm)),
    );
    setCorrectJustification("");
  }, [open, asset]);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Vehicle name is required");
      return;
    }
    if (!regoPlate.trim()) {
      toast.error("Registration plate is required");
      return;
    }
    const capacity = Number(passengerCapacity);
    if (!Number.isFinite(capacity) || capacity < 0) {
      toast.error("Passenger capacity must be a valid number");
      return;
    }

    const serviceKm = serviceIntervalKm.trim() ? Number(serviceIntervalKm) : null;
    const serviceOdo = lastServiceOdo.trim() ? Number(lastServiceOdo) : null;

    try {
      if (isEdit && asset) {
        await update.mutateAsync({
          id: asset.id,
          patch: {
            name: name.trim(),
            makeModel: makeModel.trim() || null,
            regoPlate: regoPlate.trim(),
            passengerCapacity: capacity,
            vehicleCategory,
            vin: vin.trim() || null,
            registrationExpiry: registrationExpiry || null,
            serviceIntervalKm: serviceKm,
            lastServiceOdo: serviceOdo,
            lastServiceDate: lastServiceDate || null,
            hasWheelchairHoist,
            isActive,
          },
        });
        toast.success("Vehicle updated");
      } else {
        await insert.mutateAsync({
          name: name.trim(),
          makeModel: makeModel.trim() || null,
          regoPlate: regoPlate.trim(),
          passengerCapacity: capacity,
          vehicleCategory,
          vin: vin.trim() || null,
          registrationExpiry: registrationExpiry || null,
          serviceIntervalKm: serviceKm,
          lastServiceOdo: serviceOdo,
          lastServiceDate: lastServiceDate || null,
          hasWheelchairHoist,
          isActive,
        });
        toast.success("Vehicle added to fleet");
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(isEdit ? "Could not update vehicle" : "Could not add vehicle", {
        description: (err as Error).message,
      });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{isEdit ? "Edit vehicle" : "Add vehicle"}</SheetTitle>
          <SheetDescription>
            Fleet identity and compliance fields. Rego and service rows sync to the Governance Hub
            automatically.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Identity
            </h3>
            <div className="grid gap-2">
              <Label htmlFor="fleet-name">Name</Label>
              <Input
                id="fleet-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="HiAce Bus 1"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="fleet-make">Make / model</Label>
              <Input
                id="fleet-make"
                value={makeModel}
                onChange={(e) => setMakeModel(e.target.value)}
                placeholder="Toyota HiAce Commuter"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="fleet-rego">Rego plate</Label>
                <Input
                  id="fleet-rego"
                  value={regoPlate}
                  onChange={(e) => setRegoPlate(e.target.value)}
                  placeholder="YDA-001"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="fleet-vin">VIN (optional)</Label>
                <Input id="fleet-vin" value={vin} onChange={(e) => setVin(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Vehicle category</Label>
              <Select value={vehicleCategory} onValueChange={setVehicleCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FLEET_VEHICLE_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Drives the daily walkaround checkpoint library for this vehicle type.
              </p>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Capacity &amp; access
            </h3>
            <div className="grid gap-2">
              <Label htmlFor="fleet-seats">Passenger capacity</Label>
              <Input
                id="fleet-seats"
                type="number"
                min={0}
                value={passengerCapacity}
                onChange={(e) => setPassengerCapacity(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border px-4 py-3">
              <div>
                <div className="text-sm font-medium">Wheelchair hoist equipped</div>
                <div className="text-xs text-muted-foreground">
                  Used when matching hoist-dependent passengers to vehicles.
                </div>
              </div>
              <Switch checked={hasWheelchairHoist} onCheckedChange={setHasWheelchairHoist} />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Compliance schedule
            </h3>
            <div className="grid gap-2">
              <Label htmlFor="fleet-rego-exp">Registration expiry</Label>
              <DatePicker
                value={parseIsoDateLocal(registrationExpiry)}
                onChange={(d) => setRegistrationExpiry(d ? toIsoDateString(d) : "")}
                dateFormat="dd-MMM-yy"
                className="h-9 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="fleet-svc-date">Last service date</Label>
                <DatePicker
                  value={parseIsoDateLocal(lastServiceDate)}
                  onChange={(d) => setLastServiceDate(d ? toIsoDateString(d) : "")}
                  disabledDates={(d) => d > new Date()}
                  dateFormat="dd-MMM-yy"
                  className="h-9 text-sm"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="fleet-svc-odo">Last service odometer</Label>
                <Input
                  id="fleet-svc-odo"
                  type="number"
                  value={lastServiceOdo}
                  onChange={(e) => setLastServiceOdo(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="fleet-svc-km">Service interval (km)</Label>
              <Input
                id="fleet-svc-km"
                type="number"
                value={serviceIntervalKm}
                onChange={(e) => setServiceIntervalKm(e.target.value)}
                placeholder="10000"
              />
            </div>
          </section>

          {isEdit && asset && (
            <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Current odometer (est.)
              </h3>
              <p className="text-xs text-muted-foreground">
                Updated when a Manifest run closes. Correct fat-fingers here with a reason — used for
                service scheduling and the next Manifest start prompt.
              </p>
              <div className="grid gap-2">
                <Label htmlFor="fleet-current-odo">Odometer (km)</Label>
                <Input
                  id="fleet-current-odo"
                  type="number"
                  min={0}
                  value={correctOdo}
                  onChange={(e) => setCorrectOdo(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="fleet-odo-just">Justification</Label>
                <Textarea
                  id="fleet-odo-just"
                  rows={2}
                  value={correctJustification}
                  onChange={(e) => setCorrectJustification(e.target.value)}
                  placeholder="Why this reading is being corrected…"
                  className="text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  Min {MIN_TIMELINE_NOTE} characters. Appended to the operational ledger.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={
                  correctBusy ||
                  !correctOdo.trim() ||
                  correctJustification.trim().length < MIN_TIMELINE_NOTE ||
                  (asset.currentOdometerKm != null &&
                    Number(correctOdo) === Math.round(asset.currentOdometerKm))
                }
                onClick={async () => {
                  const km = Number(correctOdo);
                  if (!Number.isFinite(km)) {
                    toast.error("Enter a valid odometer reading.");
                    return;
                  }
                  setCorrectBusy(true);
                  try {
                    await correctFleetOdometer({
                      assetId: asset.id,
                      newKm: km,
                      justification: correctJustification,
                    });
                    invalidateFleetCaches(qc);
                    toast.success("Odometer corrected", {
                      description: `Current estimate is now ${Math.round(km).toLocaleString()} km.`,
                    });
                    setCorrectJustification("");
                  } catch (err) {
                    toast.error("Could not correct odometer", {
                      description: (err as Error).message,
                    });
                  } finally {
                    setCorrectBusy(false);
                  }
                }}
              >
                {correctBusy ? "Saving…" : "Correct odometer"}
              </Button>
            </section>
          )}

          <section className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <div className="text-sm font-medium">Active in fleet</div>
              <div className="text-xs text-muted-foreground">
                Inactive vehicles are hidden from the manifest picker.
              </div>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </section>
        </div>

        <SheetFooter className="mt-8 gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={save} disabled={busy} className="gap-2">
            <Save className="h-4 w-4" />
            {busy ? "Saving…" : isEdit ? "Save changes" : "Add vehicle"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
