/**
 * Office print of the blank leader pack. One day starts on a new page.
 * The pack opens in its own window so Event Manage stays open and unlocked.
 */
import { useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { buildLeaderPack, type LeaderPack } from "@/lib/api/leader-pack";
import { formatDateWithWeekday } from "@/lib/utils";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const BOX =
  '<span style="display:inline-block;width:14px;height:14px;border:1.5px solid #000;margin-right:8px;vertical-align:middle"></span>';
const BLANK =
  '<span style="display:inline-block;min-width:7rem;border-bottom:1px solid #000">&nbsp;</span>';

function leaderPackDocument(pack: LeaderPack): string {
  const days = pack.days
    .map((day, index) => {
      const names =
        day.participants.length === 0
          ? "<p>No confirmed participants.</p>"
          : `<ul style="list-style:none;padding:0;margin:8px 0">${day.participants
              .map(
                (name) =>
                  `<li style="display:flex;align-items:flex-end;gap:8px;margin:4px 0">${BOX}<span style="flex:1">${esc(name)}</span><span>Time ${BLANK}</span></li>`,
              )
              .join("")}</ul>`;
      const rows = day.rows
        .map((row) => {
          const times =
            row.kind === "place"
              ? `<div>Opened ${BLANK} Closed ${BLANK}</div>`
              : `<div>Time ${BLANK}</div>`;
          const same = row.sameBus
            ? `<div style="margin-top:4px">${BOX}Same bus — confirm</div>`
            : "";
          return `<li style="margin:10px 0">${BOX}<span style="font-weight:600">${esc(row.name)}</span><div style="margin-left:22px;font-size:12px">${esc(row.travel)}</div><div style="margin-left:22px">${times}${same}</div></li>`;
        })
        .join("");
      const end = day.showEveningRoll
        ? `<h2 style="font-size:14px;margin:16px 0 4px">Evening roll</h2><p>${BOX}Accounted</p><p>Time ${BLANK}</p>`
        : `<h2 style="font-size:14px;margin:16px 0 4px">End of trip</h2><p>Check-out on the final day. Time ${BLANK}</p>`;
      const breakStyle = index === 0 ? "" : "page-break-before:always;break-before:page;";
      return `<article style="${breakStyle}margin:0 0 24px">
        <p style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;margin:0">Leader pack</p>
        <h1 style="font-size:22px;margin:4px 0">${esc(pack.eventTitle)}</h1>
        <p style="margin:2px 0">Day ${day.dayNumber} · ${esc(formatDateWithWeekday(day.date))}</p>
        <p style="margin:2px 0">Leader: ${esc(day.leader)}</p>
        <p style="margin:2px 0">Wake / start: ${esc(day.wake)}</p>
        <p style="font-size:12px">Blank times were not done. Write the clock you used.</p>
        <h2 style="font-size:14px;margin:16px 0 4px">${esc(day.rollLabel)}</h2>
        ${names}
        <p>Finished ${BLANK}</p>
        <h2 style="font-size:14px;margin:16px 0 4px">First bus</h2>
        <p>Bus ${BLANK} Rego ${BLANK}</p>
        <p>Driver ${BLANK}</p>
        <p>${BOX}Walkaround done</p>
        <p>Issues ${BLANK}</p>
        <h2 style="font-size:14px;margin:16px 0 4px">Places</h2>
        <ul style="list-style:none;padding:0;margin:0">${rows}</ul>
        ${end}
      </article>`;
    })
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(pack.eventTitle)} — Leader pack</title>
    <style>
      @page { size: A4 portrait; margin: 12mm; }
      body { font-family: "Segoe UI", sans-serif; color: #111; margin: 12mm; }
      @media print { .noprint { display: none; } }
    </style></head><body>
    <p class="noprint">Print preview. If the print window does not open, press Ctrl+P. You can close this window when you are done.</p>
    ${days}
    <script>setTimeout(function () { window.print(); }, 300);</script>
    </body></html>`;
}

export function LeaderPackButton({
  eventId,
  eventTitle,
}: {
  eventId: string;
  eventTitle: string;
}) {
  const [busy, setBusy] = useState(false);

  const open = () => {
    const preview = window.open("about:blank", "_blank");
    if (!preview) {
      toast.error("Print preview was blocked. Allow pop-ups for this site, then press Leader pack again.");
      return;
    }
    preview.document.open();
    preview.document.write(
      "<!DOCTYPE html><title>Leader pack</title><p style=\"font-family:Segoe UI,sans-serif\">Preparing the leader pack…</p>",
    );
    preview.document.close();
    setBusy(true);
    void (async () => {
      try {
        const pack = await buildLeaderPack(eventId, eventTitle);
        if (preview.closed) return;
        preview.document.open();
        preview.document.write(leaderPackDocument(pack));
        preview.document.close();
        preview.focus();
      } catch (err) {
        if (!preview.closed) preview.close();
        toast.error(err instanceof Error ? err.message : "Could not build the leader pack.");
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <Button type="button" variant="outline" className="h-11" onClick={open} disabled={busy}>
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
      Leader pack
    </Button>
  );
}
