import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { TransportForm } from "@/components/transport/transport-form";
import { TransportList } from "@/components/transport/transport-list";
import { TransportRequestsPanel } from "@/components/transport/transport-requests-panel";
import { useParticipants, useSyncLogs, useTransportRequests } from "@/hooks/use-supabase-data";
import type { TransportPayload } from "@/lib/data-store";
import { todayDateStr, type TransportRequest } from "@/lib/api/transport-requests";

export const Route = createFileRoute("/transport")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Ad-hoc Transport — Yada Connect" },
      {
        name: "description",
        content:
          "Schedule one-off medical and special transport runs, then log mileage and completion.",
      },
    ],
  }),
  component: TransportPage,
});

type TransportTab = "requests" | "log";

function TransportPage() {
  const [tab, setTab] = useState<TransportTab>("requests");
  const [linkedRequestId, setLinkedRequestId] = useState("");

  const { data: participants = [] } = useParticipants();
  const { data: logs = [] } = useSyncLogs();
  const today = todayDateStr();
  const { data: openRequests = [] } = useTransportRequests({
    requestDate: today,
    includeCompleted: false,
  });

  const loggableRequests = openRequests.filter(
    (r) => r.status === "requested" || r.status === "assigned" || r.status === "in_progress",
  );

  const todays = logs.filter((l) => {
    if (l.actionType !== "transport_log") return false;
    const t = l.payload as Partial<TransportPayload>;
    return typeof t.timestamp === "string" && new Date(t.timestamp).toDateString() === new Date().toDateString();
  });

  const handleLogRequest = (request: TransportRequest) => {
    setLinkedRequestId(request.id);
    setTab("log");
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Ad-hoc Transport</h1>
        <p className="text-sm text-muted-foreground">
          One-off runs — doctors, vaccinations, special drop points. Day Centre bus runs and event
          trips use{" "}
          <Link to="/manifest" className="font-medium text-primary underline-offset-2 hover:underline">
            Bus Manifest
          </Link>
          .
        </p>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TransportTab)} className="space-y-4">
        <TabsList>
          <TabsTrigger value="requests">
            Requests
            {loggableRequests.length > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[11px] font-bold text-primary">
                {loggableRequests.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="log">Log run</TabsTrigger>
        </TabsList>

        <TabsContent value="requests">
          <TransportRequestsPanel participants={participants} onLogRequest={handleLogRequest} />
        </TabsContent>

        <TabsContent value="log">
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section className="space-y-3">
              <header>
                <h2 className="text-xl font-semibold tracking-tight md:text-2xl">Log a run</h2>
                <p className="text-sm text-muted-foreground">
                  Optimised for one-handed entry from the driver&apos;s seat.
                </p>
              </header>
              <TransportForm
                participants={participants}
                openRequests={loggableRequests}
                linkedRequestId={linkedRequestId}
                onLinkedRequestChange={setLinkedRequestId}
              />
            </section>

            <section className="space-y-3">
              <header className="flex items-baseline justify-between">
                <h2 className="text-xl font-semibold tracking-tight md:text-2xl">
                  Today&apos;s runs
                </h2>
                <span className="text-xs text-muted-foreground">{todays.length} entries</span>
              </header>
              <TransportList logs={todays} participants={participants} />
            </section>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
