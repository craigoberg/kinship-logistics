import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { listBillingReadyRows, buildCsv as buildMyobCsv } from "@/lib/api/myob-export";
import { listOperationalLedgerInRange } from "@/lib/api/ledger";
import { rowsToCsv } from "./csv";
import { auditDate, auditDateTime } from "./format";
import {
  createAuditPdf,
  pdfAddHeading,
  pdfAddKeyValues,
  pdfAddLines,
  pdfToBytes,
} from "./pdf";
import {
  loadHubNotesForRefs,
  notesToCsv,
  summarizeResolutions,
} from "./issue-trail";
import { assembleDayCentreManifest } from "./manifest";
import { auditIdentity } from "./identity";
import { resolveParticipantNames, resolveStaffNames } from "./staff-names";
import type { AuditDateRange, AuditPackFile } from "./types";

export async function assembleDayCentreSection(
  range: AuditDateRange,
): Promise<{ files: AuditPackFile[]; sessionCount: number }> {
  const { data: sessions, error: sessErr } = await supabase
    .from("site_day_sessions")
    .select("*")
    .gte("session_date", range.from)
    .lte("session_date", range.to)
    .order("session_date", { ascending: true });

  if (sessErr && !isSchemaMismatchError(sessErr)) throw sessErr;
  const sessionRows = (sessions ?? []) as Array<Record<string, unknown>>;

  const staffIds = sessionRows.flatMap((s) => [
    (s.opened_by_id as string | null) ?? null,
    (s.closed_by_id as string | null) ?? null,
    (s.manager_staff_id as string | null) ?? null,
  ]);
  const names = await resolveStaffNames(staffIds);

  const sessionsCsv = rowsToCsv(
    [
      "sessionDate",
      "phase",
      "openedBy",
      "openDeclaredAt",
      "closedBy",
      "closeDeclaredAt",
      "manager",
      "notes",
    ],
    sessionRows.map((s) => ({
      sessionDate: auditDate(String(s.session_date ?? "")),
      phase: s.phase,
      openedBy: names.get(String(s.opened_by_id ?? "")) ?? "",
      openDeclaredAt: auditDateTime(s.open_declared_at as string | null),
      closedBy: names.get(String(s.closed_by_id ?? "")) ?? "",
      closeDeclaredAt: auditDateTime(s.close_declared_at as string | null),
      manager: names.get(String(s.manager_staff_id ?? "")) ?? "",
      notes: s.close_notes ?? s.notes ?? "",
    })),
  );

  let billingCsv =
    "Date,Participant ID,Participant Name,Service Code,Hours,Rate,Total,NDIS Cancellation Reason\r\n";
  try {
    const billing = await listBillingReadyRows(range.from, range.to);
    const book = auditIdentity();
    if (book.isDeid) {
      const nameMap = await resolveParticipantNames(
        billing.map((b) => b.participantId),
      );
      billingCsv = buildMyobCsv(
        billing.map((b) => ({
          ...b,
          participantId: book.participantKey(b.participantId),
          participantName:
            nameMap.get(b.participantId) ?? book.participantKey(b.participantId),
        })),
      );
    } else {
      billingCsv = buildMyobCsv(billing);
    }
  } catch (err) {
    console.warn("[audit-pack] billing rows failed", err);
  }

  const ledger = await listOperationalLedgerInRange(range.from, range.to);
  const centreLedger = ledger.filter(
    (r) => r.category === "CENTRE" || r.category === "CLIENT",
  );
  const ledgerStaff = await resolveStaffNames(centreLedger.map((r) => r.staff_id));
  const ledgerCsv = rowsToCsv(
    ["createdAt", "staff", "category", "severity", "actionType", "metadata"],
    centreLedger.map((r) => ({
      createdAt: auditDateTime(r.created_at),
      staff:
        ledgerStaff.get(r.staff_id) ?? auditIdentity().staffKey(r.staff_id),
      category: r.category,
      severity: r.severity,
      actionType: r.action_type,
      metadata: JSON.stringify(r.metadata ?? {}),
    })),
  );

  // Day Centre–scoped site issues in range (no event_id) + Hub notes.
  const fromTs = `${range.from}T00:00:00.000Z`;
  const toTs = `${range.to}T23:59:59.999Z`;
  const { data: issueData, error: issueErr } = await supabase
    .from("site_issues_register")
    .select("*")
    .is("event_id", null)
    .gte("created_at", fromTs)
    .lte("created_at", toTs)
    .order("created_at", { ascending: true });
  if (issueErr && !isSchemaMismatchError(issueErr)) {
    console.warn("[audit-pack] day centre issues", issueErr);
  }
  const issueRows = (issueData ?? []) as Array<Record<string, unknown>>;
  const issueNotes = await loadHubNotesForRefs(
    issueRows.map((r) => ({
      source: "day_centre" as const,
      sourceRowId: String(r.id),
    })),
  );
  const issueSummaries = summarizeResolutions(issueNotes);
  const issueReporters = await resolveStaffNames(
    issueRows.map((r) => (r.reported_by as string | null) ?? null),
  );
  const issuesCsv = rowsToCsv(
    [
      "id",
      "createdAt",
      "severity",
      "status",
      "description",
      "workaround",
      "reporterName",
      "sessionId",
      "deferredUntil",
      "resolvedAt",
      "resolvedByName",
      "resolutionNote",
      "noteCount",
      "lastNoteAt",
      "lastNoteByName",
      "updateLog",
    ],
    issueRows.map((r) => {
      const id = String(r.id);
      const sum = issueSummaries.get(`day_centre:${id}`);
      const reporterId = (r.reported_by as string | null) ?? null;
      const resolvedRaw = String(r.resolved_at ?? sum?.resolvedAt ?? "");
      return {
        id,
        createdAt: auditDateTime(String(r.created_at ?? "")),
        severity: String(r.severity ?? ""),
        status: String(r.status ?? ""),
        description: String(r.issue_description ?? ""),
        workaround: String(r.workaround_plan ?? ""),
        reporterName: reporterId
          ? issueReporters.get(reporterId) ?? reporterId
          : "",
        sessionId: String(r.session_id ?? ""),
        deferredUntil: auditDateTime(String(r.deferred_until ?? "")),
        resolvedAt: auditDateTime(resolvedRaw),
        resolvedByName: sum?.resolvedByName ?? "",
        resolutionNote: sum?.resolutionNote ?? "",
        noteCount: sum?.noteCount ?? 0,
        lastNoteAt: auditDateTime(sum?.lastNoteAt ?? ""),
        lastNoteByName: sum?.lastNoteByName ?? "",
        updateLog: String(r.update_log ?? ""),
      };
    }),
  );

  const manifest = await assembleDayCentreManifest(range);

  const doc = createAuditPdf("02 — Day Centre evidence");
  let y = 32;
  y = pdfAddKeyValues(
    doc,
    [
      ["Date range", `${auditDate(range.from)} → ${auditDate(range.to)}`],
      ["Sessions", String(sessionRows.length)],
      ["Day Centre issues", String(issueRows.length)],
      ["Hub notes on those issues", String(issueNotes.length)],
      ["Manifest trips (non-event)", String(manifest.tripCount)],
      ["Manifest legs", String(manifest.legCount)],
      ["CENTRE/CLIENT ledger rows", String(centreLedger.length)],
    ],
    y,
  );
  y = pdfAddHeading(doc, "Sessions", y + 2);
  const sessionLines = sessionRows.slice(0, 60).map((s) => {
    const date = auditDate(String(s.session_date ?? ""));
    const phase = String(s.phase ?? "");
    const closed = s.close_declared_at ? "closed" : "open";
    return `${date} · ${phase} · ${closed}`;
  });
  y = pdfAddLines(
    doc,
    sessionLines.length ? sessionLines : ["No Day Centre sessions in range."],
    y,
  );
  y = pdfAddHeading(doc, "Issues with resolution (sample)", y + 2);
  const issueSample = issueRows.slice(0, 15).map((r) => {
    const id = String(r.id);
    const sum = issueSummaries.get(`day_centre:${id}`);
    const res = sum?.resolutionNote
      ? `RESOLVED by ${sum.resolvedByName || "—"}: ${sum.resolutionNote.slice(0, 80)}`
      : `notes=${sum?.noteCount ?? 0}`;
    return `${auditDateTime(String(r.created_at))} · ${r.severity} · ${r.status} · ${(String(r.issue_description) || "").slice(0, 60)} · ${res}`;
  });
  pdfAddLines(
    doc,
    issueSample.length ? issueSample : ["No Day Centre issues in range."],
    y,
  );

  return {
    sessionCount: sessionRows.length,
    files: [
      { path: "02_Day_Centre/sessions.csv", content: sessionsCsv },
      { path: "02_Day_Centre/attendance_billing.csv", content: billingCsv },
      { path: "02_Day_Centre/ledger_slice.csv", content: ledgerCsv },
      { path: "02_Day_Centre/issues.csv", content: issuesCsv },
      {
        path: "02_Day_Centre/issue_notes_timeline.csv",
        content: notesToCsv(issueNotes),
      },
      ...manifest.files,
      {
        path: "02_Day_Centre/day_centre_summary.pdf",
        content: pdfToBytes(doc),
      },
    ],
  };
}
