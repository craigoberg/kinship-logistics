import { createFileRoute, Link } from "@tanstack/react-router";
import { Users, Truck, RefreshCw, AlertTriangle, Plus, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listParticipants, listTransportLogs } from "@/lib/data-store";
import { useSyncQueue } from "@/hooks/use-sync-queue";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Yada Connect" },
      { name: "description", content: "Service coordination overview: participants, transport runs, and sync status." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const participants = listParticipants();
  const logs = listTransportLogs();
  const queue = useSyncQueue();

  const today = new Date().toDateString();
  const todays = logs.filter((l) => new Date(l.timestamp).toDateString() === today);
  const iddsiAlerts = participants.filter(
    (p) => p.iddsi.liquids >= 3 || p.iddsi.foods <= 4 || p.flags.includes("Choking risk"),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
        </p>
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Good day, coordinator</h2>
        <p className="text-sm text-muted-foreground">
          Here's where things stand across Yada Connect right now.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={Users}   label="Participants"  value={participants.length} to="/participants" />
        <StatCard icon={Truck}   label="Runs today"    value={todays.length}       to="/transport" />
        <StatCard icon={RefreshCw} label="In sync queue" value={queue.length}      to="/sync" />
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
          {todays.length === 0 ? (
            <p className="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
              No runs logged yet today.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {todays.slice(0, 5).map((log) => {
                const p = participants.find((x) => x.id === log.participantId);
                const km = log.dropoffOdometer - log.pickupOdometer;
                return (
                  <li key={log.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{p?.fullName ?? "—"}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {km} km
                      </div>
                    </div>
                    <Badge variant={log.status === "Arrived" ? "default" : log.status === "No-show" ? "destructive" : "outline"}>
                      {log.status}
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
                    {p.flags.length > 0 && <> · {p.flags.join(", ")}</>}
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
