import type { BoardPackDay, BoardPackTripDay } from "@/lib/reporting/board-pack";
import { formatDateWithWeekday } from "@/lib/utils";

const HEAD = [
  "Date",
  "Clients",
  "Volunteers",
  "Entries",
  "Incident",
  "Follow ups required",
  "Completed",
  "Follow up",
] as const;

function DayRows({
  day,
  trip,
}: {
  day: BoardPackDay;
  trip?: Pick<BoardPackTripDay, "title" | "phaseLabel">;
}) {
  const lines = day.incidents.length > 0 ? day.incidents : [null];
  const span = lines.length;
  return lines.map((inc, index) => (
    <tr key={`${day.key}-${inc?.number ?? "none"}-${index}`} className="border-b border-border align-top print:border-black">
      {index === 0 ? (
        <>
          <td className="border border-border px-2 py-1.5 print:border-black" rowSpan={span}>
            {trip ? (
              <>
                <div className="font-semibold">{trip.title}</div>
                <div>{formatDateWithWeekday(day.dateIso)}</div>
                <div className="text-xs text-muted-foreground print:text-black">{trip.phaseLabel}</div>
              </>
            ) : (
              formatDateWithWeekday(day.dateIso)
            )}
          </td>
          <td className="border border-border px-2 py-1.5 text-center print:border-black" rowSpan={span}>
            {day.clients}
          </td>
          <td className="border border-border px-2 py-1.5 text-center print:border-black" rowSpan={span}>
            {day.volunteers}
          </td>
          <td className="whitespace-pre-wrap border border-border px-2 py-1.5 print:border-black" rowSpan={span}>
            {day.entries || " "}
          </td>
        </>
      ) : null}
      <td className="border border-border px-2 py-1.5 print:border-black">
        {inc ? (
          <>
            <span className="font-semibold">{inc.number}</span>
            {inc.summary ? ` — ${inc.summary}` : ""}
          </>
        ) : (
          " "
        )}
      </td>
      <td className="border border-border px-2 py-1.5 print:border-black">{inc?.followUpRequired || " "}</td>
      <td className="border border-border px-2 py-1.5 text-center print:border-black">{inc?.completed || " "}</td>
      <td className="whitespace-pre-wrap border border-border px-2 py-1.5 print:border-black">{inc?.followUp || " "}</td>
    </tr>
  ));
}

export function BoardPackTable({
  title,
  days,
  trips,
}: {
  title: string;
  days: BoardPackDay[];
  trips?: boolean;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">{title}</h2>
      {days.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground print:border-black print:text-black">
          {trips ? "No trips in this period." : "No centre days in this period."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse bg-card text-sm text-card-foreground print:bg-white print:text-black">
            <thead>
              <tr className="bg-muted print:bg-white">
                {HEAD.map((h) => (
                  <th key={h} className="border border-border px-2 py-1.5 text-left font-semibold print:border-black">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <DayRows
                  key={day.key}
                  day={day}
                  trip={trips ? (day as BoardPackTripDay) : undefined}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
