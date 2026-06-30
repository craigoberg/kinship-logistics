import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MapPin, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  canManageSystemParameters,
  updateSystemParameter,
} from "@/lib/api/system-parameters";
import {
  SYSTEM_PARAMETERS_QUERY_KEY,
  useSystemParameter,
} from "@/hooks/use-system-parameters";
import { getActiveUserProfile } from "@/lib/data-store";

function isManagerRole(staffRole: string | null | undefined): boolean {
  return (staffRole ?? "").toLowerCase().includes("manager");
}

/**
 * Depot + Day Centre default addresses — shown at the top of the
 * Day Centre Bus Runs admin tab. Stored in system_parameters.
 */
export function TransportSiteAddressesPanel() {
  const qc = useQueryClient();
  const profile = useMemo(() => getActiveUserProfile(), []);
  const permissionQ = useQuery({
    queryKey: ["system-parameters", "can-manage", profile?.staffId ?? "auth-user"],
    queryFn: () => canManageSystemParameters(profile?.staffId),
    staleTime: 60_000,
  });
  const canEdit = isManagerRole(profile?.staffRole) || permissionQ.data === true;

  const savedDepot = useSystemParameter<string>("depot_address", "");
  const savedCentre = useSystemParameter<string>("day_centre_address", "");

  const [depotAddress, setDepotAddress] = useState("");
  const [centreAddress, setCentreAddress] = useState("");
  const [justification, setJustification] = useState("");

  useEffect(() => {
    setDepotAddress(savedDepot);
  }, [savedDepot]);

  useEffect(() => {
    setCentreAddress(savedCentre);
  }, [savedCentre]);

  const save = useMutation({
    mutationFn: async () => {
      const reason =
        justification.trim().length >= 10
          ? justification.trim()
          : "Updated transport site addresses from Admin Day Centre Bus Runs tab.";
      const updates: Array<{ key: string; value: string }> = [];
      if (depotAddress.trim() !== savedDepot.trim()) {
        updates.push({ key: "depot_address", value: depotAddress.trim() });
      }
      if (centreAddress.trim() !== savedCentre.trim()) {
        updates.push({ key: "day_centre_address", value: centreAddress.trim() });
      }
      for (const u of updates) {
        await updateSystemParameter({
          key: u.key,
          newValue: u.value,
          justification: reason,
        });
      }
      return updates.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: SYSTEM_PARAMETERS_QUERY_KEY });
      setJustification("");
      toast.success(
        count === 0 ? "No changes to save" : "Transport site addresses saved",
        {
          description:
            count === 0
              ? "Both addresses match the saved values."
              : "Drivers will see these as defaults when starting runs.",
        },
      );
    },
    onError: (e: Error) =>
      toast.error("Could not save addresses", { description: e.message }),
  });

  const dirty =
    depotAddress.trim() !== savedDepot.trim() ||
    centreAddress.trim() !== savedCentre.trim();

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-semibold">
            <MapPin className="h-4 w-4 text-primary" />
            Transport site addresses
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Default locations for morning pickups (Depot), morning drop-off and
            afternoon home runs (Day Centre). Drivers can override the starting
            point when opening a run.
          </p>
        </div>
        {!canEdit && <Badge variant="secondary">Read-only · Managers can edit</Badge>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="admin-depot-address">Depot address</Label>
          <Input
            id="admin-depot-address"
            value={depotAddress}
            onChange={(e) => setDepotAddress(e.target.value)}
            placeholder="e.g. 12 Smith Street, Suburb NSW 2000"
            disabled={!canEdit}
          />
          <p className="text-[11px] text-muted-foreground">
            Morning pickup starting point · afternoon home-run destination
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="admin-centre-address">Day Centre address</Label>
          <Input
            id="admin-centre-address"
            value={centreAddress}
            onChange={(e) => setCentreAddress(e.target.value)}
            placeholder="e.g. 45 Centre Road, Suburb NSW 2000"
            disabled={!canEdit}
          />
          <p className="text-[11px] text-muted-foreground">
            Morning run destination · afternoon home-run starting point
          </p>
        </div>
      </div>

      {canEdit && dirty && (
        <div className="space-y-1.5">
          <Label htmlFor="address-justification" className="text-xs">
            Change reason (optional — auto-filled if left blank)
          </Label>
          <Input
            id="address-justification"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="e.g. Depot moved to new council yard"
          />
        </div>
      )}

      {canEdit && (
        <Button
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          className="gap-1.5"
        >
          <Save className="h-4 w-4" />
          {save.isPending ? "Saving…" : "Save site addresses"}
        </Button>
      )}
    </div>
  );
}
