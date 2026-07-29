/**
 * DEV/TEST tools bar — fake Sydney date/time + Simulate offline (BL-082).
 * Single amber row. Gated by IS_TEST_BUILD. Never mounts in production builds.
 */
import { useSyncExternalStore, useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Clock, CloudOff, X } from "lucide-react";
import { toast } from "sonner";
import { getAppLaneBadge, IS_TEST_BUILD } from "@/lib/test-mode";
import {
  clearOperationalClockOverride,
  formatOperationalClockLabel,
  freezeOperationalClockToLive,
  getOperationalClockOverride,
  getOperationalClockSnapshot,
  setOperationalClockOverride,
  shiftOperationalClockDays,
  shiftOperationalClockMinutes,
  subscribeOperationalClock,
} from "@/lib/operational-clock";
import {
  isSimulatedOffline,
  setSimulatedOffline,
  subscribeSimulatedOffline,
} from "@/lib/simulated-offline";
import { DatePicker } from "@/components/ui/date-picker";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn, parseIsoDateLocal, toIsoDateString } from "@/lib/utils";
import { getSydneyIsoDate } from "@/lib/operational-time";

function invalidateOperationalQueries(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries();
}

export function DevOperationalClockBar() {
  if (!IS_TEST_BUILD) return null;
  return <DevOperationalClockBarInner />;
}

function DevOperationalClockBarInner() {
  const qc = useQueryClient();
  // Override is null until markOperationalClockClientReady() (root) — matches SSR.
  const snapshot = useSyncExternalStore(
    subscribeOperationalClock,
    getOperationalClockSnapshot,
    () => "ssr:live",
  );
  const override = useMemo(() => getOperationalClockOverride(), [snapshot]);
  const [sheetOpen, setSheetOpen] = useState(false);

  const liveParts = useMemo(() => {
    const now = new Date();
    const date = getSydneyIsoDate(now);
    const parts = new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Sydney",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
    const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
    return { date, time: `${hh}:${mm}` };
  }, [sheetOpen, snapshot]);

  const [draftDate, setDraftDate] = useState(liveParts.date);
  const [draftTime, setDraftTime] = useState(liveParts.time);

  const openSheet = () => {
    const current = getOperationalClockOverride() ?? liveParts;
    setDraftDate(current.date);
    setDraftTime(current.time);
    setSheetOpen(true);
  };

  const apply = (next: { date: string; time: string }, label: string) => {
    setOperationalClockOverride(next);
    invalidateOperationalQueries(qc);
    toast.message("Operational clock set", { description: label });
  };

  const clear = () => {
    clearOperationalClockOverride();
    invalidateOperationalQueries(qc);
    toast.message("Operational clock cleared", { description: "Back to live wall clock." });
    setSheetOpen(false);
  };

  const simOffline = useSyncExternalStore(
    subscribeSimulatedOffline,
    isSimulatedOffline,
    () => false,
  );

  const toggleSimOffline = (forced: boolean) => {
    setSimulatedOffline(forced);
    // Wake Manifest outbox flush / banners that subscribe via useOnlineStatus.
    void qc.invalidateQueries({ queryKey: ["transport_trips", "active"] });
    toast.message(forced ? "Simulate offline ON" : "Simulate offline OFF", {
      description: forced
        ? "Manifest mid-run writes queue locally. Turn off to sync."
        : "App treats the device as online again (real signal still required for Supabase).",
    });
  };

  const laneBadge = getAppLaneBadge();

  return (
    <>
      <div
        className={cn(
          "sticky top-0 z-[60] grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b px-3 py-1.5",
          override || simOffline
            ? "border-amber-600/60 bg-amber-500 text-amber-950"
            : "border-dashed border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-200",
        )}
      >
        <button
          type="button"
          onClick={openSheet}
          className="flex min-w-0 items-center gap-1.5 text-left text-[11px] font-bold uppercase tracking-wider"
        >
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {override
              ? `SIM TIME · ${formatOperationalClockLabel(override)}`
              : "SIM · live (tap for date/time)"}
            {simOffline ? " · OFFLINE" : ""}
          </span>
        </button>

        <span
          className="pointer-events-none select-none px-1 text-center text-[12px] font-black tracking-[0.2em]"
          aria-label={`App lane ${laneBadge}`}
        >
          {laneBadge}
        </span>

        <div className="flex items-center justify-end gap-2">
          {override ? (
            <button
              type="button"
              className="shrink-0 rounded bg-amber-950/20 px-2 py-0.5 text-[10px] font-bold uppercase"
              onClick={clear}
            >
              Clear
            </button>
          ) : null}

          <label
            className="flex shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
            onClick={(e) => e.stopPropagation()}
          >
            <CloudOff className="h-3.5 w-3.5 shrink-0 opacity-80" />
            <span className="hidden sm:inline">{simOffline ? "Offline" : "Offline?"}</span>
            <Switch
              checked={simOffline}
              onCheckedChange={toggleSimOffline}
              aria-label="Simulate network offline for field testing"
            />
          </label>
        </div>
      </div>

      <BottomSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="DEV operational clock"
        description="Sydney date + time for multi-day and YELLOW/RED testing. Ledger timestamps stay real."
      >
        <div className="space-y-4 pb-4">
          <div className="grid gap-2">
            <Label>Date (Sydney)</Label>
            <DatePicker
              value={parseIsoDateLocal(draftDate)}
              onChange={(d) => {
                if (d) setDraftDate(toIsoDateString(d));
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dev-op-clock-time">Time (Sydney, 24h HH:mm)</Label>
            <Input
              id="dev-op-clock-time"
              type="time"
              step={60}
              value={draftTime}
              onChange={(e) => setDraftTime(e.target.value.slice(0, 5))}
              className="h-12 font-mono text-base"
            />
            <p className="text-[11px] text-muted-foreground">
              Exact minutes matter for curfew YELLOW (−15) / RED (+30) thresholds.
            </p>
          </div>

          <Button
            type="button"
            className="h-12 w-full"
            onClick={() => {
              apply({ date: draftDate, time: draftTime }, formatOperationalClockLabel({ date: draftDate, time: draftTime }));
              setSheetOpen(false);
            }}
          >
            Apply simulated clock
          </Button>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const next = shiftOperationalClockDays(-1);
                invalidateOperationalQueries(qc);
                toast.message("−1 day", { description: formatOperationalClockLabel(next) });
                setDraftDate(next.date);
                setDraftTime(next.time);
              }}
            >
              −1 day
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const next = shiftOperationalClockDays(1);
                invalidateOperationalQueries(qc);
                toast.message("+1 day", { description: formatOperationalClockLabel(next) });
                setDraftDate(next.date);
                setDraftTime(next.time);
              }}
            >
              +1 day
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const next = shiftOperationalClockMinutes(-15);
                invalidateOperationalQueries(qc);
                toast.message("−15 min", { description: formatOperationalClockLabel(next) });
                setDraftDate(next.date);
                setDraftTime(next.time);
              }}
            >
              −15 min
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const next = shiftOperationalClockMinutes(15);
                invalidateOperationalQueries(qc);
                toast.message("+15 min", { description: formatOperationalClockLabel(next) });
                setDraftDate(next.date);
                setDraftTime(next.time);
              }}
            >
              +15 min
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const next = shiftOperationalClockMinutes(30);
                invalidateOperationalQueries(qc);
                toast.message("+30 min", { description: formatOperationalClockLabel(next) });
                setDraftDate(next.date);
                setDraftTime(next.time);
              }}
            >
              +30 min
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const next = shiftOperationalClockMinutes(60);
                invalidateOperationalQueries(qc);
                toast.message("+1 hour", { description: formatOperationalClockLabel(next) });
                setDraftDate(next.date);
                setDraftTime(next.time);
              }}
            >
              +1 hour
            </Button>
          </div>

          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => {
              const next = freezeOperationalClockToLive();
              invalidateOperationalQueries(qc);
              toast.message("Frozen at live now", { description: formatOperationalClockLabel(next) });
              setDraftDate(next.date);
              setDraftTime(next.time);
            }}
          >
            Freeze at live now
          </Button>

          <Button type="button" variant="ghost" className="w-full gap-1 text-destructive" onClick={clear}>
            <X className="h-4 w-4" />
            Clear — use live wall clock
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}
