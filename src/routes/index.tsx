import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Users, Truck, RefreshCw, AlertTriangle, Plus, ArrowRight, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useParticipants, useSyncLogs } from "@/hooks/use-supabase-data";
import { useSyncQueue } from "@/hooks/use-sync-queue";
import { MedicationAdminModal } from "@/components/medication/medication-admin-modal";
import type { TransportPayload } from "@/lib/data-store";
import { formatDate, formatTime } from "@/lib/utils";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Dashboard — Yada Connect" },
      { name: "description", content: "Service coordination overview: participants, transport runs, and sync status." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { data: participants = [] } = useParticipants();
  const { data: logs = [] } = useSyncLogs();
  const queue = useSyncQueue();
  const [medOpen, setMedOpen] = useState(false);

  const today = new Date().toDateString();
  const todaysTransport = logs
    .filter((l) => l.actionType === "transport_log")
    .map((l) => ({ l, t: l.payload as Partial<TransportPayload> }))
    .filter(({ t }) => typeof t.timestamp === "string" && new Date(t.timestamp).toDateString() === today);

  const iddsiAlerts = participants.filter(
    (p) => p.iddsi.liquids >= 3 || p.iddsi.foods <= 4,
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground tabular-nums">
            {formatDate(new Date())}
          </p>
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Good day, coordinator</h2>
          <p className="text-sm text-muted-foreground">
            Here's where things stand across Yada Connect right now.
          </p>
        </div>
        <Button onClick={() => setMedOpen(true)} className="gap-1.5">
          <ShieldCheck className="h-4 w-4" />
          Record medication admin
        </Button>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={Users}   label="Participants"  value={participants.length} to="/participants" />
        <StatCard icon={Truck}   label="Runs today"    value={todaysTransport.length} to="/transport" />
        <StatCard icon={RefreshCw} label="In sync queue" value={queue.length}        to="/sync" />
        <StatCard
          icon={AlertTriangle}
          label="IDDSI alerts"
          value={iddsiAlerts.length}
          to="/participants"
          tone="warning"
        />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card className="space-y-3 p-5 md:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">Recent transport activity</h3>
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link to="/transport">View all <ArrowRight className="h-3.5 w-3.5" /></Link>
            </Button>
          </div>
          {todaysTransport.length === 0 ? (
            <p className="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
              No runs logged yet today.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {todaysTransport.slice(0, 5).map(({ l, t }) => {
                const p = participants.find((x) => x.id === t.participant_id);
                const km = (t.dropoff_odometer ?? 0) - (t.pickup_odometer ?? 0);
                return (
                  <li key={l.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{p?.fullName ?? "—"}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {formatTime(t.timestamp!)} · {km} km
                      </div>
                    </div>
                    <Badge variant={t.status === "Arrived" ? "default" : t.status === "No-show" ? "destructive" : "outline"}>
                      {t.status}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="space-y-3 p-5">
          <h3 className="text-base font-semibold">Quick actions</h3>
          <div className="flex flex-col gap-2">
            <Button asChild className="h-12 justify-start gap-2">
              <Link to="/transport"><Plus className="h-4 w-4" /> Log transport run</Link>
            </Button>
            <Button asChild variant="outline" className="h-12 justify-start gap-2">
              <Link to="/participants"><Users className="h-4 w-4" /> Open directory</Link>
            </Button>
            <Button asChild variant="outline" className="h-12 justify-start gap-2">
              <Link to="/sync"><RefreshCw className="h-4 w-4" /> Review sync queue</Link>
            </Button>
          </div>
        </Card>
      </section>

      {iddsiAlerts.length > 0 && (
        <Card className="space-y-3 p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <h3 className="text-base font-semibold">Participants needing extra care</h3>
          </div>
          <ul className="divide-y divide-border">
            {iddsiAlerts.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{p.fullName}</div>
                  <div className="text-xs text-muted-foreground">
                    Liq L{p.iddsi.liquids} · Food L{p.iddsi.foods}
                  </div>
                </div>
                <Button asChild size="sm" variant="ghost">
                  <Link to="/participants">Open</Link>
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <MedicationAdminModal open={medOpen} onOpenChange={setMedOpen} />
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  to,
  tone,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  to: "/" | "/participants" | "/transport" | "/sync";
  tone?: "warning";
}) {
  return (
    <Link
      to={to}
      className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-accent/40"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className={`h-4 w-4 ${tone === "warning" ? "text-warning" : "text-muted-foreground"}`} />
      </div>
      <div className="mt-2 text-3xl font-bold tabular-nums">{value}</div>
    </Link>
  );
}
