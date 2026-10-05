import { createPortal } from "react-dom";
import { IncidentBoardPrintSheet } from "@/components/governance/incident-board-print";
import { TripReportDocument } from "@/components/events/trip-report-tab";
import { BoardPackTable } from "@/components/reporting/board-pack-table";
import {
  centreIncidentsOf,
  tripGroupsOf,
  type BoardPack,
  type BoardPackIncident,
} from "@/lib/reporting/board-pack";
import { formatDate } from "@/lib/utils";

const PRINT_STYLE = `
  @media print {
    @page { size: A4 landscape; margin: 10mm; }
    html, body {
      height: auto !important;
      overflow: visible !important;
      background: white !important;
    }
    body > *:not([data-board-pack-print-root]) {
      display: none !important;
    }
    [data-board-pack-print-root] {
      display: block !important;
      color: black !important;
      background: white !important;
    }
    [data-board-pack-print-root] .pack-break {
      break-before: page;
      page-break-before: always;
    }
    [data-board-pack-print-root] * {
      color: black !important;
      background-color: white !important;
    }
    [data-board-pack-print-root] table,
    [data-board-pack-print-root] td,
    [data-board-pack-print-root] th {
      border-color: black !important;
    }
  }
`;

function IncidentPage({ pack, incident }: { pack: BoardPack; incident: BoardPackIncident }) {
  const model = pack.incidentSheets[incident.hubRowId];
  if (!model) {
    return (
      <article className="bg-white p-4 text-sm text-black">
        <h2 className="text-lg font-bold">{incident.number}</h2>
        <p className="mt-2">{incident.summary}</p>
        <p className="mt-2">The full incident sheet could not be loaded.</p>
      </article>
    );
  }
  return <IncidentBoardPrintSheet model={model} />;
}

export function BoardPackSequence({ pack, cover }: { pack: BoardPack; cover?: boolean }) {
  const centreIncidents = centreIncidentsOf(pack);
  const groups = tripGroupsOf(pack);

  return (
    <div className="space-y-8">
      <section>
        {cover ? (
          <header className="mb-3 text-center text-black">
            <p className="text-sm font-semibold tracking-wide">YADA</p>
            <h1 className="text-lg font-bold">Centre and trips board pack</h1>
            <p className="text-xs">
              {formatDate(pack.fromIso)} to {formatDate(pack.toIso)}
            </p>
          </header>
        ) : null}
        <BoardPackTable title="Day Centre" days={pack.centre} />
      </section>

      {centreIncidents.map((incident) => (
        <section key={incident.hubRowId} className="pack-break">
          <IncidentPage pack={pack} incident={incident} />
        </section>
      ))}

      <section className="pack-break">
        <BoardPackTable title="Trips" days={pack.trips} trips />
      </section>

      {groups.map((group) => {
        const report = group.eventId ? pack.tripReports[group.eventId] : null;
        return (
          <div key={group.eventId || group.title}>
            <section className="pack-break space-y-3">
              <h2 className="text-base font-semibold">Trip report — {group.title}</h2>
              {report ? (
                <TripReportDocument report={report} />
              ) : (
                <p className="text-sm">Trip report could not be loaded.</p>
              )}
            </section>
            {group.incidents.map((incident) => (
              <section key={incident.hubRowId} className="pack-break">
                <IncidentPage pack={pack} incident={incident} />
              </section>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function BoardPackPrintPortal({ pack }: { pack: BoardPack }) {
  return createPortal(
    <div data-board-pack-print-root className="hidden print:block">
      <style>{PRINT_STYLE}</style>
      <BoardPackSequence pack={pack} cover />
    </div>,
    document.body,
  );
}
