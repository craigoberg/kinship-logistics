import { createFileRoute } from "@tanstack/react-router";
import { Wifi, WifiOff } from "lucide-react";
import { QueueTable } from "@/components/sync/queue-table";
import { useSyncQueue } from "@/hooks/use-sync-queue";
import { useOnlineStatus } from "@/hooks/use-online-status";

export const Route = createFileRoute("/sync")({
  head: () => ({
    meta: [
      { title: "Sync Queue — Yada Connect" },
      { name: "description", content: "Records waiting in the offline pipeline with manual retry controls." },
    ],
  }),
  component: SyncPage,
});

function SyncPage() {
  const items = useSyncQueue();
  const online = useOnlineStatus();
  const pending = items.filter((i) => i.status === "pending").length;
  const retrying = items.filter((i) => i.status === "retrying").length;
  const failed = items.filter((i) => i.status === "failed").length;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight md:text-2xl">Sync queue</h2>
        <p className="text-sm text-muted-foreground">
          Store-and-forward pipeline for offline-captured records.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Connection"
          value={online ? "Online" : "Offline"}
          icon={online ? <Wifi className="h-4 w-4 text-success" /> : <WifiOff className="h-4 w-4 text-warning" />}
        />
        <Stat label="Pending" value={pending} />
        <Stat label="Retrying" value={retrying} />
        <Stat label="Failed" value={failed} tone={failed > 0 ? "danger" : undefined} />
      </div>

      <QueueTable items={items} />
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number | string;
  icon?: React.ReactNode;
  tone?: "danger";
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        {icon}
      </div>
      <div
        className={`mt-2 text-2xl font-bold tabular-nums ${tone === "danger" ? "text-destructive" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
