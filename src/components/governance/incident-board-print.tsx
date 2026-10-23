import { createPortal } from "react-dom";
import type { IncidentBoardPrintModel } from "@/lib/incident-board-report";

const PRINT_STYLE = `
  @media print {
    @page { margin: 12mm; }
    html, body {
      height: auto !important;
      overflow: visible !important;
      background: white !important;
    }
    body > *:not([data-incident-board-print-root]) {
      display: none !important;
    }
    [data-incident-board-print-root] {
      display: block !important;
      color: black !important;
      background: white !important;
    }
  }
`;

function Tick({ on }: { on: boolean }) {
  return (
    <span className="mr-1 inline-block h-3.5 w-3.5 border border-black text-center align-middle text-[10px] leading-[12px]">
      {on ? "✓" : ""}
    </span>
  );
}

function Cell({ children }: { children: string }) {
  return <td className="border border-black px-2 py-1 align-top">{children || " "}</td>;
}

export function IncidentBoardPrintSheet({ model }: { model: IncidentBoardPrintModel }) {
  return (
      <article className="mx-auto max-w-3xl bg-white p-4 text-sm text-black print:p-0">
        <h1 className="text-center text-xl font-bold">Incident Report</h1>
        <p className="mt-1 text-center text-xs">
          To be completed within 12 hours of the incident/accident occurring by witnesses or
          people involved in the incident.
        </p>

        <table className="mt-3 w-full border-collapse">
          <tbody>
            <tr>
              <td className="border border-black bg-neutral-100 px-2 py-1 font-semibold" colSpan={2}>
                Details of Incident (Who is this incident referring to)
              </td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1">
                <Tick on={model.participantOn} />
                Participant - (add NDIS number if applicable):
              </td>
              <Cell>{model.participantLine}</Cell>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1">
                <Tick on={model.workerOn} />
                Worker/Volunteer:
              </td>
              <Cell>{model.workerLine}</Cell>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1">
                <Tick on={model.otherOn} />
                Other (state whom):
              </td>
              <Cell>{model.otherLine}</Cell>
            </tr>
          </tbody>
        </table>

        <table className="mt-2 w-full border-collapse">
          <tbody>
            <tr>
              <td className="w-1/2 border border-black px-2 py-1 font-medium">Date of incident</td>
              <Cell>{model.incidentDate}</Cell>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-medium">Is this an Injury report:</td>
              <td className="border border-black px-2 py-1">
                <Tick on={model.injuryYes} /> Yes
                <span className="mx-3" />
                <Tick on={model.injuryNo} /> No
                <span className="ml-2 text-xs">If no, go to Incident Location</span>
              </td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-medium">Injured person&apos;s name:</td>
              <Cell>{model.injuredName}</Cell>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-medium">Incident location:</td>
              <Cell>{model.location}</Cell>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-medium">Name of person reporting the incident:</td>
              <Cell>{model.reporterName}</Cell>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-medium">Phone:</td>
              <Cell>{model.reporterPhone}</Cell>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-medium">Email:</td>
              <Cell>{model.reporterEmail}</Cell>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-medium">Date of report:</td>
              <Cell>{model.reportDate}</Cell>
            </tr>
          </tbody>
        </table>

        <table className="mt-2 w-full border-collapse">
          <tbody>
            <tr>
              <td className="border border-black bg-neutral-100 px-2 py-1 font-semibold">
                Description of the incident (client/worker)
              </td>
            </tr>
            <tr>
              <td className="min-h-[4rem] whitespace-pre-wrap border border-black px-2 py-1">
                {model.description || " "}
              </td>
            </tr>
          </tbody>
        </table>

        <table className="mt-2 w-full border-collapse">
          <tbody>
            <tr>
              <td className="border border-black bg-neutral-100 px-2 py-1 font-semibold" colSpan={2}>
                Witness details
              </td>
            </tr>
            <tr>
              <td className="w-1/2 border border-black px-2 py-1 font-medium">Name of witness:</td>
              <Cell>{model.witnessName}</Cell>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-medium">Phone:</td>
              <Cell>{model.witnessPhone}</Cell>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-medium">Email:</td>
              <Cell>{model.witnessEmail}</Cell>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-medium">Witness description of the incident:</td>
              <td className="whitespace-pre-wrap border border-black px-2 py-1">{model.witnessAccount || " "}</td>
            </tr>
          </tbody>
        </table>

        <table className="mt-2 w-full border-collapse">
          <tbody>
            <tr>
              <td className="border border-black bg-neutral-100 px-2 py-1 font-semibold">
                Description of injuries or impact on person (if applicable)
              </td>
            </tr>
            <tr>
              <td className="whitespace-pre-wrap border border-black px-2 py-1">{model.injuriesImpact || " "}</td>
            </tr>
          </tbody>
        </table>

        <table className="mt-2 w-full border-collapse">
          <tbody>
            <tr>
              <td className="border border-black bg-neutral-100 px-2 py-1 font-semibold">
                Actions taken by our organisation (e.g. first aid, ambulance called, support to person)
              </td>
            </tr>
            <tr>
              <td className="whitespace-pre-wrap border border-black px-2 py-1">{model.actionsTaken || " "}</td>
            </tr>
          </tbody>
        </table>

        <table className="mt-2 w-full border-collapse">
          <tbody>
            <tr>
              <td className="border border-black bg-neutral-100 px-2 py-1 font-semibold" colSpan={2}>
                Office use only:
              </td>
            </tr>
            <tr>
              <td className="w-1/2 border border-black px-2 py-1 font-medium">Incident No#</td>
              <Cell>{model.incidentNumber}</Cell>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-medium">Report received by:</td>
              <Cell>{model.receivedBy}</Cell>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-medium">Date:</td>
              <Cell>{model.receivedDate}</Cell>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-medium">Action required:</td>
              <td className="border border-black px-2 py-1">
                <Tick on={model.actionInvestigation} /> Investigation
                <span className="mx-3" />
                <Tick on={model.actionCi} /> Continuous improvement review
              </td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-medium">Investigation Outcome:</td>
              <td className="whitespace-pre-wrap border border-black px-2 py-1">
                {model.investigationOutcome || " "}
              </td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-medium">Reportable incident?</td>
              <td className="border border-black px-2 py-1">
                <Tick on={model.reportableYes} /> Yes
                <span className="mx-2" />
                <Tick on={model.reportableNo} /> No
                <span className="ml-4">Date advised: {model.reportableDate}</span>
              </td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-medium">NDIS Commission advised?</td>
              <td className="border border-black px-2 py-1">
                <Tick on={model.ndisYes} /> Yes
                <span className="mx-2" />
                <Tick on={model.ndisNo} /> No
                <span className="ml-3">Date advised: {model.ndisDate}</span>
                <div className="mt-1">
                  Report type: <Tick on={model.report5Day} /> 5-day report
                  <span className="mx-2" />
                  <Tick on={model.report24Hour} /> 24-hour report
                </div>
              </td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-medium">Report escalated to:</td>
              <Cell>{model.escalatedTo}</Cell>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-medium">Date report escalated:</td>
              <Cell>{model.escalatedDate}</Cell>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-medium">Other information:</td>
              <td className="whitespace-pre-wrap border border-black px-2 py-1">{model.other || " "}</td>
            </tr>
          </tbody>
        </table>

        <p className="mt-4 text-[10px]">YADA Incident Report Version 1 23.07.2024</p>
      </article>
  );
}

export function IncidentBoardPrintPortal({ model }: { model: IncidentBoardPrintModel }) {
  return createPortal(
    <div data-incident-board-print-root className="hidden">
      <style>{PRINT_STYLE}</style>
      <IncidentBoardPrintSheet model={model} />
    </div>,
    document.body,
  );
}
