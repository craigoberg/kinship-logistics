/**
 * First bus of the day on Event Deliver — who is driving.
 * The leader stays on Programme. The walkaround is the Manifest checklist.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bus, Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { IssueAccumulatorPanel } from "@/components/manifest/issue-accumulator-panel";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import { FieldActionButton } from "@/components/ui/field-action-button";
import { CharacterCountedInput } from "@/components/ui/character-counted-input";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { writeToLedger } from "@/lib/api/ledger";
import { withAuditActorMeta } from "@/lib/api/office-change-log";
import {
  getActiveUserProfile,
  type AssetDailyClearance,
  type TransportAsset,
} from "@/lib/data-store";
import {
  resolveClearanceForAsset,
  resolveClearancesForDate,
  resolveTransportAssets,
} from "@/lib/deliver-offline/fleet-cache";
import {
  loadBusDayClearance,
  saveBusDayClearance,
  type BusDayClearance,
  type BusDayDraft,
} from "@/lib/deliver-offline/bus-day-clearance";

type Who = "leader" | "yada" | "hired";

interface Props {
  eventId: string;
  sessionDate: string;
  fromLabel: string;
  toLabel: string;
  children: ReactNode;
}

function passed(row: AssetDailyClearance | null | undefined): boolean {
  return !!row && (row.status === "passed" || row.status === "authorized_override");
}

function clearanceSummary(row: BusDayClearance): string {
  if (row.kind === "hired") {
    return `Hired bus ${row.rego}. Driver ${row.driverName}, ${row.company}.`;
  }
  if (row.source === "offline_go") {
    return `Left without the driver's clearance on this tablet. ${row.assetName} (${row.rego}).`;
  }
  if (row.source === "leader_walkaround") {
    return `Leader signed the walkaround for ${row.assetName} (${row.rego}).`;
  }
  if (row.source === "driver_seen") {
    return `Driver clearance for ${row.assetName} (${row.rego}) is on this tablet.`;
  }
  return `${row.assetName} (${row.rego}) was already cleared today.`;
}

async function remember(row: BusDayDraft): Promise<BusDayClearance> {
  const summary = clearanceSummary({
    ...row,
    key: "",
    savedAt: "",
    ledgerPending: true,
    summary: "",
  });
  return saveBusDayClearance({
    ...row,
    summary,
    ledgerPending: true,
  });
}

export function BusDayClearance({
  eventId,
  sessionDate,
  fromLabel,
  toLabel,
  children,
}: Props) {
  const qc = useQueryClient();
  const online = useOnlineStatus();
  const [who, setWho] = useState<Who | null>(null);
  const [asset, setAsset] = useState<TransportAsset | null>(null);
  const [walkaround, setWalkaround] = useState(false);
  const [block, setBlock] = useState<string | null>(null);
  const [released, setReleased] = useState(false);
  const [askAnyway, setAskAnyway] = useState(false);
  const [loggingIssue, setLoggingIssue] = useState(false);
  const [driverName, setDriverName] = useState("");
  const [company, setCompany] = useState("");
  const [rego, setRego] = useState("");
  const [savingHired, setSavingHired] = useState(false);

  const decisionQ = useQuery({
    queryKey: ["bus-day-clearance", eventId, sessionDate],
    queryFn: async () => {
      const existing = await loadBusDayClearance(eventId, sessionDate);
      if (existing) return existing;
      const staffId = getActiveUserProfile()?.staffId;
      if (!staffId) return null;
      const [assets, clearances] = await Promise.all([
        resolveTransportAssets(),
        resolveClearancesForDate(sessionDate),
      ]);
      const mine = clearances.filter(
        (row) => passed(row) && row.driverStaffId === staffId,
      );
      const latest = mine[mine.length - 1];
      if (!latest) return null;
      const bus = assets.find((item) => item.id === latest.assetId);
      return remember({
        kind: "own_bus",
        eventId,
        sessionDate,
        assetId: latest.assetId,
        assetName: bus?.name ?? "Bus",
        rego: bus?.regoPlate ?? "",
        source: "already_cleared",
      });
    },
    staleTime: Infinity,
    networkMode: "always",
  });

  const assetsQ = useQuery({
    queryKey: ["transport-assets", "bus-day"],
    queryFn: () => resolveTransportAssets(),
    enabled: who === "leader" || who === "yada" || loggingIssue,
    staleTime: 60_000,
    networkMode: "always",
  });

  const waitingQ = useQuery({
    queryKey: ["asset-clearance", asset?.id ?? "", sessionDate],
    queryFn: () => getClearanceForAssetOnDate(asset!.id, sessionDate.slice(0, 10)),
    enabled: !!asset && who === "yada" && !walkaround && !block && !decisionQ.data,
    refetchInterval: online ? 10_000 : false,
  });

  const decision = decisionQ.data ?? null;

  useEffect(() => {
    if (who !== "yada" || !asset || !passed(waitingQ.data) || released) return;
    void accept({
      kind: "own_bus",
      eventId,
      sessionDate,
      assetId: asset.id,
      assetName: asset.name,
      rego: asset.regoPlate,
      source: "driver_seen",
    });
    // accept is recreated each render; the clearance row is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingQ.data, who, asset, released, eventId, sessionDate]);

  useEffect(() => {
    if (!decision?.ledgerPending || !online) return;
    let cancelled = false;
    void (async () => {
      const profile = getActiveUserProfile();
      await writeToLedger({
        staff_id: profile?.staffId ?? "",
        category: "VEHICLE",
        severity: decision.kind === "own_bus" && decision.source === "offline_go" ? "INFO" : "GREEN",
        action_type: "EVENT_BUS_DAY_CLEARANCE",
        gps_lat: null,
        gps_lng: null,
        metadata: await withAuditActorMeta({
          summary: decision.summary,
          event_id: eventId,
          session_date: sessionDate,
          location: `${fromLabel} → ${toLabel}`,
          bus_day_kind: decision.kind,
          bus_day_source: decision.kind === "own_bus" ? decision.source : "hired",
        }),
      });
      if (cancelled) return;
      const next = await saveBusDayClearance({ ...decision, ledgerPending: false });
      qc.setQueryData(["bus-day-clearance", eventId, sessionDate], next);
    })();
    return () => {
      cancelled = true;
    };
  }, [decision, online, eventId, sessionDate, fromLabel, toLabel, qc]);

  const accept = async (row: BusDayDraft) => {
    const saved = await remember(row);
    qc.setQueryData(["bus-day-clearance", eventId, sessionDate], saved);
    setReleased(true);
  };

  const chooseBus = async (bus: TransportAsset) => {
    setAsset(bus);
    setBlock(null);
    setWalkaround(false);
    const row = await resolveClearanceForAsset(bus.id, sessionDate);
    if (row?.status === "failed") {
      setBlock(`${bus.name} failed today's walkaround. Pick another bus.`);
      return;
    }
    if (row?.status === "awaiting_manager_review") {
      setBlock(`${bus.name} is waiting for a manager. It cannot be taken yet.`);
      return;
    }
    if (passed(row)) {
      await accept({
        kind: "own_bus",
        eventId,
        sessionDate,
        assetId: bus.id,
        assetName: bus.name,
        rego: bus.regoPlate,
        source: who === "yada" ? "driver_seen" : "already_cleared",
      });
      return;
    }
    if (who === "leader") {
      setWalkaround(true);
      return;
    }
    if (!online) return;
  };

  if (decisionQ.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking today's bus…
      </div>
    );
  }

  if (released || (decision && released)) {
    return <>{children}</>;
  }

  if (decision && !released && !askAnyway) {
    const ownBus = decision.kind === "own_bus" && decision.source !== "offline_go";
    if (loggingIssue && decision.kind === "own_bus" && decision.source !== "offline_go") {
      const bus = (assetsQ.data ?? []).find((item) => item.id === decision.assetId);
      if (!bus && !assetsQ.isFetched) {
        return (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Opening the walkaround…
          </div>
        );
      }
      if (!bus) {
        return (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">This bus is not on the tablet.</p>
            <button
              type="button"
              className="h-10 w-full text-sm font-semibold text-muted-foreground"
              onClick={() => setLoggingIssue(false)}
            >
              Back
            </button>
          </div>
        );
      }
      const profile = getActiveUserProfile();
      return (
        <IssueAccumulatorPanel
          asset={bus}
          dateStr={sessionDate.slice(0, 10)}
          checkpoints={[]}
          driverName={profile?.fullName ?? "Trip leader"}
          alreadyCleared
          askOdometer={false}
          pinLength={6}
          onBack={() => setLoggingIssue(false)}
          onCleared={() => setLoggingIssue(false)}
        />
      );
    }
    return (
      <div className="space-y-3">
        <p className="text-sm text-foreground">{decision.summary}</p>
        <p className="text-xs text-muted-foreground">
          Same bus as the first leave today. Confirm, then mark who is on it.
        </p>
        <FieldActionButton variant="success" onClick={() => setReleased(true)}>
          <Bus className="h-4 w-4" />
          Confirm — this bus
        </FieldActionButton>
        {ownBus ? (
          <FieldActionButton variant="primary" onClick={() => setLoggingIssue(true)}>
            Log an issue
          </FieldActionButton>
        ) : null}
        <button
          type="button"
          className="h-10 w-full text-sm font-semibold text-muted-foreground"
          onClick={() => setAskAnyway(true)}
        >
          Not this bus
        </button>
      </div>
    );
  }

  if (walkaround && asset) {
    const profile = getActiveUserProfile();
    return (
      <IssueAccumulatorPanel
        asset={asset}
        dateStr={sessionDate.slice(0, 10)}
        checkpoints={[]}
        driverName={profile?.fullName ?? "Trip leader"}
        askOdometer={false}
        pinLength={6}
        onBack={() => setWalkaround(false)}
        onCleared={() => {
          void accept({
            kind: "own_bus",
            eventId,
            sessionDate,
            assetId: asset.id,
            assetName: asset.name,
            rego: asset.regoPlate,
            source: "leader_walkaround",
          });
        }}
      />
    );
  }

  if (who === "hired") {
    const missing: string[] = [];
    if (driverName.trim().length < 2) missing.push("driver name");
    if (company.trim().length < 2) missing.push("company");
    if (rego.trim().length < 2) missing.push("bus registration");
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold">Hired driver</p>
        <p className="text-xs text-muted-foreground">
          Record who is driving and which bus. This is our clearance. The YADA walkaround stays closed.
        </p>
        <CharacterCountedInput
          label="Driver name"
          value={driverName}
          onValueChange={setDriverName}
          minChars={2}
          maxChars={80}
        />
        <CharacterCountedInput
          label="Company"
          value={company}
          onValueChange={setCompany}
          minChars={2}
          maxChars={80}
        />
        <CharacterCountedInput
          label="Bus registration"
          value={rego}
          onValueChange={setRego}
          minChars={2}
          maxChars={20}
        />
        {missing.length > 0 ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Still needed: {missing.join(" · ")}
          </div>
        ) : null}
        <FieldActionButton
          variant="success"
          disabled={missing.length > 0 || savingHired}
          onClick={() => {
            setSavingHired(true);
            void accept({
              kind: "hired",
              eventId,
              sessionDate,
              driverName: driverName.trim(),
              company: company.trim(),
              rego: rego.trim(),
            })
              .catch((err: Error) => toast.error(err.message))
              .finally(() => setSavingHired(false));
          }}
        >
          {savingHired ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRound className="h-4 w-4" />}
          Accept this bus
        </FieldActionButton>
        <button
          type="button"
          className="h-10 w-full text-sm font-semibold text-muted-foreground"
          onClick={() => setWho(null)}
        >
          Back
        </button>
      </div>
    );
  }

  if (who === "leader" || who === "yada") {
    const buses = (assetsQ.data ?? []).filter((item) => item.isActive);
    const showGo = who === "yada" && !!asset && !block && !passed(waitingQ.data) && !online;
    const showWait = who === "yada" && !!asset && !block && !passed(waitingQ.data) && online && !walkaround;
    return (
      <div className="space-y-2">
        <p className="text-sm font-semibold">
          {who === "leader" ? "Which bus are you driving?" : "Which bus is the driver taking?"}
        </p>
        {assetsQ.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading buses…
          </div>
        ) : (
          buses.map((bus) => (
            <MobileFieldButton
              key={bus.id}
              title={bus.name}
              subtitle={bus.regoPlate}
              icon={<Bus className="h-5 w-5" />}
              tone={asset?.id === bus.id ? "success" : "neutral"}
              active={asset?.id === bus.id}
              onClick={() => void chooseBus(bus)}
            />
          ))
        )}
        {block ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {block}
          </p>
        ) : null}
        {showWait ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            Waiting for the driver's checkout of {asset?.name}. It is not on this tablet yet.
          </p>
        ) : null}
        {showGo ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              This tablet is offline, so the driver's checkout cannot arrive. Go does not mark the bus passed.
            </p>
            <FieldActionButton
              variant="caution"
              onClick={() => {
                if (!asset) return;
                void accept({
                  kind: "own_bus",
                  eventId,
                  sessionDate,
                  assetId: asset.id,
                  assetName: asset.name,
                  rego: asset.regoPlate,
                  source: "offline_go",
                });
              }}
            >
              Go — driver's check is on their tablet
            </FieldActionButton>
          </div>
        ) : null}
        {!assetsQ.isLoading && buses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {online
              ? "No active bus is on the fleet list."
              : "The buses were not saved with this trip. Open the trip once while the link is up, then this list stays on the tablet."}
          </p>
        ) : null}
        <button
          type="button"
          className="h-10 w-full text-sm font-semibold text-muted-foreground"
          onClick={() => {
            setWho(null);
            setAsset(null);
            setBlock(null);
          }}
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Who is driving this bus?</p>
      <p className="text-xs text-muted-foreground">
        First bus leave today, {fromLabel} to {toLabel}. Later bus legs today only confirm.
      </p>
      <MobileFieldButton
        title="I am driving"
        subtitle="The walkaround opens here. You sign the bus out."
        icon={<Bus className="h-5 w-5" />}
        tone="success"
        onClick={() => setWho("leader")}
      />
      <MobileFieldButton
        title="A YADA driver is driving"
        subtitle="Their checkout is used when it is on this tablet. Offline, you can go without signing it."
        icon={<UserRound className="h-5 w-5" />}
        onClick={() => setWho("yada")}
      />
      <MobileFieldButton
        title="Hired driver"
        subtitle="Name the driver, the company, and the bus. No YADA walkaround."
        icon={<Bus className="h-5 w-5" />}
        onClick={() => setWho("hired")}
      />
    </div>
  );
}
