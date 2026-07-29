import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useParticipants } from "@/hooks/use-supabase-data";
import { TodaysMedicationCard } from "@/components/medication/todays-medication-card";
import { OperationsExceptionHub } from "@/components/dashboard/OperationsExceptionHub";

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

  const iddsiAlerts = participants.filter(
    (p) => p.iddsi.liquids >= 3 || p.iddsi.foods <= 4,
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <OperationsExceptionHub />

      <TodaysMedicationCard />


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

    </div>
  );
}

