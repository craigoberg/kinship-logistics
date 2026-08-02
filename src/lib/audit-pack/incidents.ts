import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
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
  formatTrailPreview,
  hubSourceForSiteIssue,
  loadHubNotesForRefs,
  notesToCsv,
  summarizeResolutions,
  type AuditTrailRef,
} from "./issue-trail";
import { auditIdentity } from "./identity";
import { resolveStaffNames } from "./staff-names";
import type { AuditDateRange, AuditPackFile } from "./types";

export interface AuditIncidentRow {
  source: "operational_incident" | "site_issue";
  hubSource: string;
  id: string;
  createdAt: string;
  occurredAt: string;
  severity: string;
  status: string;
  description: string;
  workaround: string | null;
  reporterId: string | null;
  reporterName: string;
  eventId: string | null;
  sessionId: string | null;
  deferredUntil: string;
  updateLog: string;
  resolvedAt: string;
  resolvedByName: string;
  resolutionNote: string;
  noteCount: number;
  lastNoteAt: string;
  lastNoteByName: string;
}

export async function listAuditIncidents(
  range: AuditDateRange,
): Promise<{
  rows: AuditIncidentRow[];
  notes: Awaited<ReturnType<typeof loadHubNotesForRefs>>;
  notesCsv: string;
  notesCount: number;
}> {
  const fromTs = `${range.from}T00:00:00.000Z`;
  const toTs = `${range.to}T23:59:59.999Z`;

  const [incResult, issueResult] = await Promise.all([
    supabase
      .from("operational_incidents")
      .select("*")
      .gte("created_at", fromTs)
      .lte("created_at", toTs)
      .order("created_at", { ascending: true }),
    supabase
      .from("site_issues_register")
      .select("*")
      .gte("created_at", fromTs)
      .lte("created_at", toTs)
      .order("created_at", { ascending: true }),
  ]);

  if (incResult.error && !isSchemaMismatchError(incResult.error)) {
    throw incResult.error;
  }
  if (issueResult.error && !isSchemaMismatchError(issueResult.error)) {
    throw issueResult.error;
  }

  const incidents = (incResult.data ?? []) as Array<Record<string, unknown>>;
  const issues = (issueResult.data ?? []) as Array<Record<string, unknown>>;

  const refs: AuditTrailRef[] = [
    ...incidents.map((r) => ({
      source: "incident" as const,
      sourceRowId: String(r.id),
    })),
    ...issues.map((r) => ({
      source: hubSourceForSiteIssue({
        eventId: (r.event_id as string | null) ?? null,
        eventDaySessionId: (r.event_day_session_id as string | null) ?? null,
      }),
      sourceRowId: String(r.id),
    })),
  ];

  const notes = await loadHubNotesForRefs(refs);
  const summaries = summarizeResolutions(notes);

  const reporterIds = [
    ...incidents.map((r) => (r.reported_by as string | null) ?? null),
    ...issues.map((r) => (r.reported_by as string | null) ?? null),
  ];
  const names = await resolveStaffNames(reporterIds);

  const rows: AuditIncidentRow[] = [];

  for (const r of incidents) {
    const id = String(r.id);
    const reporterId = (r.reported_by as string | null) ?? null;
    const sum = summaries.get(`incident:${id}`);
    const resolvedAt =
      sum?.resolvedAt ||
      (r.resolved_at as string | null) ||
      "";
    rows.push({
      source: "operational_incident",
      hubSource: "incident",
      id,
      createdAt: String(r.created_at ?? ""),
      occurredAt: String(r.occurred_at ?? r.created_at ?? ""),
      severity: String(r.severity ?? ""),
      status: String(r.status ?? ""),
      description: String(r.description ?? ""),
      workaround: null,
      reporterId,
      reporterName:
        reporterId && names.has(reporterId)
          ? names.get(reporterId)!
          : String(reporterId ?? ""),
      eventId: (r.event_id as string | null) ?? null,
      sessionId: null,
      deferredUntil: "",
      updateLog: "",
      resolvedAt,
      resolvedByName: sum?.resolvedByName ?? "",
      resolutionNote: sum?.resolutionNote ?? "",
      noteCount: sum?.noteCount ?? 0,
      lastNoteAt: sum?.lastNoteAt ?? "",
      lastNoteByName: sum?.lastNoteByName ?? "",
    });
  }

  for (const r of issues) {
    const id = String(r.id);
    const reporterId = (r.reported_by as string | null) ?? null;
    const hubSource = hubSourceForSiteIssue({
      eventId: (r.event_id as string | null) ?? null,
      eventDaySessionId: (r.event_day_session_id as string | null) ?? null,
    });
    const sum = summaries.get(`${hubSource}:${id}`);
    const resolvedAt =
      (r.resolved_at as string | null) || sum?.resolvedAt || "";
    rows.push({
      source: "site_issue",
      hubSource,
      id,
      createdAt: String(r.created_at ?? ""),
      occurredAt: String(r.occurred_at ?? r.created_at ?? ""),
      severity: String(r.severity ?? ""),
      status: String(r.status ?? ""),
      description: String(r.issue_description ?? ""),
      workaround: (r.workaround_plan as string | null) ?? null,
      reporterId,
      reporterName: reporterId ? names.get(reporterId) ?? reporterId : "",
      eventId: (r.event_id as string | null) ?? null,
      sessionId: (r.session_id as string | null) ?? (r.event_day_session_id as string | null) ?? null,
      deferredUntil: (r.deferred_until as string | null) ?? "",
      updateLog: String(r.update_log ?? ""),
      resolvedAt,
      resolvedByName: sum?.resolvedByName ?? "",
      resolutionNote: sum?.resolutionNote ?? "",
      noteCount: sum?.noteCount ?? 0,
      lastNoteAt: sum?.lastNoteAt ?? "",
      lastNoteByName: sum?.lastNoteByName ?? "",
    });
  }

  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    rows,
    notes,
    notesCsv: notesToCsv(notes),
    notesCount: notes.length,
  };
}

export async function assembleIncidentsSection(
  range: AuditDateRange,
): Promise<{ files: AuditPackFile[]; count: number }> {
  const { rows, notes, notesCsv, notesCount } = await listAuditIncidents(range);

  const csv = rowsToCsv(
    [
      "source",
      "hubSource",
      "id",
      "createdAt",
      "occurredAt",
      "severity",
      "status",
      "description",
      "workaround",
      "reporterName",
      "reporterId",
      "eventId",
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
    rows.map((r) => ({
      ...r,
      reporterId: auditIdentity().staffKey(r.reporterId),
      createdAt: auditDateTime(r.createdAt),
      occurredAt: auditDateTime(r.occurredAt),
      deferredUntil: auditDateTime(r.deferredUntil) || auditDate(r.deferredUntil),
      resolvedAt: auditDateTime(r.resolvedAt),
      lastNoteAt: auditDateTime(r.lastNoteAt),
    })),
  );

  // Ledger resolve receipts — NDIS-reportable artefact from Hub resolve.
  let resolutionReceiptsCsv =
    "createdAt,staff,actionType,severity,source,sourceRowId,resolutionNote,title\r\n";
  try {
    const ledger = await listOperationalLedgerInRange(range.from, range.to, [
      "governance.issue_resolved",
    ]);
    const staffNames = await resolveStaffNames(ledger.map((r) => r.staff_id));
    resolutionReceiptsCsv = rowsToCsv(
      [
        "createdAt",
        "staff",
        "actionType",
        "severity",
        "source",
        "sourceRowId",
        "resolutionNote",
        "title",
      ],
      ledger.map((r) => {
        const meta = (r.metadata ?? {}) as Record<string, unknown>;
        return {
          createdAt: auditDateTime(r.created_at),
          staff:
            staffNames.get(r.staff_id) ?? auditIdentity().staffKey(r.staff_id),
          actionType: r.action_type,
          severity: r.severity,
          source: String(meta.source ?? ""),
          sourceRowId: String(meta.source_row_id ?? ""),
          resolutionNote: String(meta.resolution_note ?? ""),
          title: String(meta.title ?? ""),
        };
      }),
    );
  } catch (err) {
    console.warn("[audit-pack] resolution receipts", err);
  }

  const notesByIssue = new Map<string, typeof notes>();
  for (const n of notes) {
    const key = `${n.source}:${n.sourceRowId}`;
    const list = notesByIssue.get(key) ?? [];
    list.push(n);
    notesByIssue.set(key, list);
  }

  const doc = createAuditPdf("01 — Incidents & Complaints");
  let y = 32;
  y = pdfAddKeyValues(
    doc,
    [
      ["Date range", `${auditDate(range.from)} → ${auditDate(range.to)}`],
      ["Total records", String(rows.length)],
      ["Hub timeline notes", String(notesCount)],
      [
        "Resolved (status or [RESOLVED] note)",
        String(
          rows.filter(
            (r) =>
              r.status.toLowerCase() === "resolved" ||
              !!r.resolutionNote ||
              !!r.resolvedAt,
          ).length,
        ),
      ],
      [
        "RED / Sev1",
        String(
          rows.filter(
            (r) =>
              r.severity.toLowerCase() === "red" ||
              r.severity.toLowerCase() === "sev1",
          ).length,
        ),
      ],
    ],
    y,
  );

  y = pdfAddHeading(doc, "Register with resolution trail (sample)", y + 2);
  const sample = rows.slice(0, 25);
  if (sample.length === 0) {
    y = pdfAddLines(doc, ["No incidents or site issues in range."], y);
  } else {
    for (const r of sample) {
      y = pdfAddLines(
        doc,
        [
          `— ${auditDateTime(r.createdAt) || auditDate(r.createdAt)} · ${r.severity} · ${r.status} · logged by ${r.reporterName || "—"}`,
          `  ${(r.description || "").slice(0, 120)}`,
          r.workaround ? `  Workaround: ${r.workaround.slice(0, 100)}` : "",
          r.resolutionNote
            ? `  FINAL RESOLUTION (${auditDateTime(r.resolvedAt) || "—"} by ${r.resolvedByName || "—"}): ${r.resolutionNote.slice(0, 120)}`
            : r.resolvedAt
              ? `  Resolved at ${auditDateTime(r.resolvedAt)} (no Hub resolution note found)`
              : `  Open / no resolution note yet · notes=${r.noteCount}`,
        ].filter(Boolean),
        y,
      );
      const trail = notesByIssue.get(`${r.hubSource}:${r.id}`) ?? [];
      if (trail.length) {
        y = pdfAddLines(doc, formatTrailPreview(trail, 4).map((l) => `    ${l}`), y);
      }
      y += 1;
    }
    if (rows.length > 25) {
      y = pdfAddLines(
        doc,
        [`… and ${rows.length - 25} more — see register.csv + notes_timeline.csv.`],
        y,
      );
    }
  }

  return {
    count: rows.length,
    files: [
      { path: "01_Incidents_Complaints/register.csv", content: csv },
      { path: "01_Incidents_Complaints/notes_timeline.csv", content: notesCsv },
      {
        path: "01_Incidents_Complaints/resolution_ledger.csv",
        content: resolutionReceiptsCsv,
      },
      {
        path: "01_Incidents_Complaints/incidents_summary.pdf",
        content: pdfToBytes(doc),
      },
    ],
  };
}
