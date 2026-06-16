import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { TransportForm } from "@/components/transport/transport-form";
import { TransportList } from "@/components/transport/transport-list";
import { listParticipants, listTransportLogs } from "@/lib/data-store";

export const Route = createFileRoute("/transport")({
  head: () => ({
    meta: [
      { title: "Transport Logs — Yada Connect" },
      { name: "description", content: "Log mileage, passenger entry, and arrival status for transport runs." },
    ],
  }),
  component: TransportPage,
});

function TransportPage() {
  const participants = listParticipants();
  const [logs, setLogs] = useState(() => listTransportLogs());

  const today = new Date().toDateString();
  const todays = logs.filter((l) => new Date(l.timestamp).toDateString() === today);

  return (
    <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="space-y-3">
        <header>
          <h2 className="text-xl font-semibold tracking-tight md:text-2xl">Log a run</h2>
          <p className="text-sm text-muted-foreground">Optimised for one-handed entry from the driver's seat.</p>
        </header>
        <TransportForm participants={participants} onLogged={() => setLogs(listTransportLogs())} />
      </section>

      <section className="space-y-3">
        <header className="flex items-baseline justify-between">
          <h2 className="text-xl font-semibold tracking-tight md:text-2xl">Today's runs</h2>
          <span className="text-xs text-muted-foreground">{todays.length} entries</span>
        </header>
        <TransportList logs={todays} participants={participants} />
      </section>
    </div>
  );
}
