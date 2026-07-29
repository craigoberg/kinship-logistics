import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { listEventDaySessions } from "@/lib/api/event-outing";
import { listEventAttendanceRoll } from "@/lib/api/event-attendance";
import { listBusManifest } from "@/lib/api/event-day-ops";
import { listEventIssues, type SiteIssue } from "@/lib/api/site-issues";
import { buildTripReport } from "@/lib/api/event-lifecycle";
import {
  eventBusRunOptions,
  eventBusRunShortLabel,
  matchesEventBusRun,
} from "@/lib/event-bus-runs";
import { listLookupParameters, LOOKUP_CATEGORIES } from "@/lib/data-store";
import { rowsToCsv } from "./csv";
import { auditClock, auditDate, auditDateTime } from "./format";
import {
  createAuditPdf,
  pdfAddHeading,
  pdfAddKeyValues,
  pdfAddLines,
  pdfToBytes,
} from "./pdf";
import {
  formatTrailPreview,
  loadHubNotesForRefs,
  notesToCsv,
  summarizeResolutions,
} from "./issue-trail";
import { assembleEventManifest } from "./manifest";
import { resolveParticipantNames, resolveStaffNames } from "./staff-names";
import type { AuditDateRange, AuditPackFile } from "./types";
import { slugify } from "./types";
import { assembleVenueSafetyEvidence } from "./venue-safety";
import { auditIdentity } from "./identity";

interface EventRow {
  id: string;
  title: string;
  status: string;
  start_date: string;
  end_date: string | null;
  event_kind: string | null;
}

async function listOutingEventsInRange(range: AuditDateRange): Promise<EventRow[]> {
  const { data, error } = await supabase
    .from("event_manifest")
    .select("id, title, status, start_date, end_date, event_kind")
    .lte("start_date", range.to)
    .or(`end_date.gte.${range.from},end_date.is.null`)
    .order("start_date", { ascending: true });

  if (error) {
    if (isSchemaMismatchError(error)) return [];
    // Fallback without end_date filter if or() fails
    const fallback = await supabase
      .from("event_manifest")
      .select("id, title, status, start_date, end_date, event_kind")
      .gte("start_date", range.from)
      .lte("start_date", range.to)
      .order("start_date", { ascending: true });
    if (fallback.error) throw fallback.error;
    return (fallback.data ?? []) as EventRow[];
  }

  const rows = (data ?? []) as EventRow[];
  return rows.filter((e) => {
    const end = e.end_date ?? e.start_date;
    return end >= range.from && e.start_date <= range.to;
  });
}

async function listAccountabilityTable(
  table: "event_morning_log" | "event_curfew_log",
  sessionId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("event_day_session_id", sessionId);
  if (error) {
    if (isSchemaMismatchError(error)) return [];
    throw error;
  }
  return (data ?? []) as Array<Record<string, unknown>>;
}

type AuditTransportTrip = {
  id: string;
  label: string | null;
  direction: "outbound" | "return" | "hop" | "other";
  busRunCode: string | null;
  tripDate: string | null;
  status: string;
};

async function listTransportTripIds(eventId: string): Promise<AuditTransportTrip[]> {
  const full = await supabase
    .from("transport_trips")
    .select(
      "id, trip_date, status, hop_index, event_day_session_id, trip_return, trip_kind, bus_run_code",
    )
    .eq("event_id", eventId);
  const rows: Array<Record<string, unknown>> = [];
  if (!full.error && full.data) {
    rows.push(...(full.data as Array<Record<string, unknown>>));
  } else {
    const basic = await supabase
      .from("transport_trips")
      .select("id, trip_date, status, trip_return, bus_run_code")
      .eq("event_id", eventId);
    if (basic.error) {
      if (isSchemaMismatchError(basic.error)) return [];
      throw basic.error;
    }
    rows.push(...((basic.data ?? []) as Array<Record<string, unknown>>));
  }
  return rows.map((row) => {
    const kind = String(row.trip_kind ?? "");
    const ret = String(row.trip_return ?? "");
    let direction: AuditTransportTrip["direction"] = "other";
    if (kind === "event_venue_hop" || row.hop_index != null) direction = "hop";
    else if (ret === "none" || ret === "") direction = "outbound";
    else if (ret === "depot" || ret === "day_centre") direction = "return";
    const run = String(row.bus_run_code ?? "").trim() || null;
    const date = row.trip_date ? String(row.trip_date) : null;
    const label =
      direction === "hop" && row.hop_index != null
        ? `Hop ${row.hop_index}`
        : direction === "return"
          ? run
            ? `HOME ${run}`
            : "HOME"
          : direction === "outbound"
            ? run
              ? `IN ${run}`
              : "IN"
            : date;
    return {
      id: String(row.id),
      label,
      direction,
      busRunCode: run,
      tripDate: date,
      status: String(row.status ?? ""),
    };
  });
}

type PlannedReturn = {
  mode: string;
  busRunCode: string | null;
};

async function listPlannedReturnByParticipant(
  eventId: string,
): Promise<Map<string, PlannedReturn>> {
  const withRuns =
    "participant_id, return_transport_mode, return_bus_run_code";
  let result = await supabase
    .from("event_roster_bookings")
    .select(withRuns)
    .eq("event_id", eventId)
    .neq("booking_status", "Cancelled");
  if (result.error && isSchemaMismatchError(result.error)) {
    result = await supabase
      .from("event_roster_bookings")
      .select("participant_id, return_transport_mode")
      .eq("event_id", eventId)
      .neq("booking_status", "Cancelled");
  }
  if (result.error) throw result.error;

  const map = new Map<string, PlannedReturn>();
  for (const row of result.data ?? []) {
    const r = row as {
      participant_id: string;
      return_transport_mode?: string | null;
      return_bus_run_code?: string | null;
    };
    map.set(r.participant_id, {
      mode: (r.return_transport_mode ?? "bus").toLowerCase(),
      busRunCode: (r.return_bus_run_code ?? "").trim() || null,
    });
  }
  return map;
}

/** BL-095 — per-person HOME completion for one attendance row. */
function homeCompletionForRow(opts: {
  status: string;
  returnTransport: string;
  returnBusRunCode: string | null;
  planned: PlannedReturn | null;
  returnTrips: AuditTransportTrip[];
}): {
  homeComplete: "yes" | "no" | "n/a";
  incompleteReason: string;
  returnManifestId: string;
  returnManifestStatus: string;
} {
  const status = opts.status.toLowerCase();
  const ret = opts.returnTransport.toLowerCase();

  if (status === "absent") {
    return {
      homeComplete: "n/a",
      incompleteReason: "left_trip_or_absent",
      returnManifestId: "",
      returnManifestStatus: "",
    };
  }
  if (status === "expected") {
    return {
      homeComplete: "no",
      incompleteReason: "never_arrived",
      returnManifestId: "",
      returnManifestStatus: "",
    };
  }
  if (status === "checked_in") {
    return {
      homeComplete: "no",
      incompleteReason: "still_with_group",
      returnManifestId: "",
      returnManifestStatus: "",
    };
  }
  if (status === "checked_out" && !ret) {
    return {
      homeComplete: "no",
      incompleteReason: "checkout_missing_return_mode",
      returnManifestId: "",
      returnManifestStatus: "",
    };
  }
  if (status === "checked_out" && ret === "self") {
    return {
      homeComplete: "yes",
      incompleteReason: "",
      returnManifestId: "",
      returnManifestStatus: "",
    };
  }

  // checked_out + bus — link matching return trip for that run (legacy null OK).
  if (status === "checked_out" && ret === "bus") {
    const match = opts.returnTrips.find((t) =>
      matchesEventBusRun(opts.returnBusRunCode, t.busRunCode),
    );
    if (opts.returnTrips.length > 0 && !match && opts.returnBusRunCode) {
      return {
        homeComplete: "no",
        incompleteReason: "no_return_trip_for_run",
        returnManifestId: "",
        returnManifestStatus: "",
      };
    }
    return {
      homeComplete: "yes",
      incompleteReason: "",
      returnManifestId: match?.id ?? "",
      returnManifestStatus: match?.status ?? "",
    };
  }

  // Other return modes (e.g. family) — check-out with a mode is enough.
  return {
    homeComplete: status === "checked_out" && Boolean(ret) ? "yes" : "no",
    incompleteReason:
      status === "checked_out" && Boolean(ret) ? "" : "checkout_incomplete",
    returnManifestId: "",
    returnManifestStatus: "",
  };
}

export async function assembleTripEvidence(
  eventId: string,
): Promise<{ files: AuditPackFile[]; folder: string; title: string }> {
  const report = await buildTripReport(eventId);
  const sessions = await listEventDaySessions(eventId);
  const sessionIds = sessions.map((s) => s.id);
  let issues = sessionIds.length
    ? await listEventIssues(eventId, sessionIds)
    : [];
  if (issues.length === 0) {
    const { data: byEvent } = await supabase
      .from("site_issues_register")
      .select("*")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false });
    issues = (byEvent ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      const issue: SiteIssue = {
        id: String(row.id),
        sessionId: (row.session_id as string | null) ?? null,
        eventId: (row.event_id as string | null) ?? null,
        eventDaySessionId: (row.event_day_session_id as string | null) ?? null,
        reportedBy: (row.reported_by as string | null) ?? null,
        severity: (row.severity as SiteIssue["severity"]) ?? "green",
        issueDescription: String(row.issue_description ?? ""),
        workaroundPlan: (row.workaround_plan as string | null) ?? null,
        owner: "internal",
        councilSlaCategory: null,
        councilSlaDeadline: null,
        emailDispatchedToCouncil: false,
        emailDispatchedAt: null,
        status: String(row.status ?? "open"),
        resolvedAt: (row.resolved_at as string | null) ?? null,
        workaroundAcceptedAt: null,
        createdAt: String(row.created_at ?? ""),
      };
      return issue;
    });
  }
  const trips = await listTransportTripIds(eventId);
  const returnTrips = trips.filter((t) => t.direction === "return");
  const plannedReturn = await listPlannedReturnByParticipant(eventId);
  const busRunOpts = eventBusRunOptions(
    await listLookupParameters(LOOKUP_CATEGORIES.busRun),
  );
  const shortRun = (code: string | null | undefined) =>
    code ? eventBusRunShortLabel(code, busRunOpts) : "";

  const attendanceAll: Array<Record<string, unknown>> = [];
  const morningAll: Array<Record<string, unknown>> = [];
  const eveningAll: Array<Record<string, unknown>> = [];
  const boardingAll: Array<Record<string, unknown>> = [];

  for (const s of sessions) {
    const att = await listEventAttendanceRoll(s.id);
    for (const a of att) {
      attendanceAll.push({
        sessionDate: s.session_date,
        participantId: a.participantId,
        status: a.status,
        arrivalMethod: a.arrivalMethod,
        arrivalBusRunCode: a.arrivalBusRunCode ?? "",
        checkedInAt: a.checkedInAt ?? "",
        checkedInBy: a.checkedInBy ?? "",
        checkedOutAt: a.checkedOutAt ?? "",
        checkedOutBy: a.checkedOutBy ?? "",
        returnTransport: a.returnTransport ?? "",
        returnBusRunCode: a.returnBusRunCode ?? "",
        notes: a.notes ?? "",
      });
    }

    const morning = await listAccountabilityTable("event_morning_log", s.id);
    for (const r of morning) {
      morningAll.push({
        sessionDate: s.session_date,
        roll: "morning",
        participantId: r.participant_id,
        status: r.status,
        escalationSeverity: r.escalation_severity ?? "",
        accountedAt: r.accounted_at ?? "",
        accountedBy: r.accounted_by ?? "",
        notes: r.notes ?? "",
      });
    }
    const evening = await listAccountabilityTable("event_curfew_log", s.id);
    for (const r of evening) {
      eveningAll.push({
        sessionDate: s.session_date,
        roll: "evening",
        participantId: r.participant_id,
        status: r.status,
        escalationSeverity: r.escalation_severity ?? "",
        accountedAt: r.accounted_at ?? "",
        accountedBy: r.accounted_by ?? "",
        notes: r.notes ?? "",
      });
    }
  }

  for (const t of trips) {
    const manifest = await listBusManifest(t.id);
    for (const m of manifest) {
      boardingAll.push({
        tripId: t.id,
        tripLabel: t.label ?? "",
        direction: t.direction,
        busRunCode: t.busRunCode ?? "",
        participantId: m.participant_id ?? "",
        participantName: m.participant_name ?? "",
        status: m.status ?? "",
        boardedAt: m.checked_on_at ?? "",
        notes: m.notes ?? "",
      });
    }
  }

  const participantIds = [
    ...attendanceAll.map((r) => r.participantId as string),
    ...morningAll.map((r) => r.participantId as string),
    ...eveningAll.map((r) => r.participantId as string),
    ...boardingAll.map((r) => r.participantId as string),
  ];
  const partNames = await resolveParticipantNames(participantIds);
  const staffIds = [
    ...attendanceAll.flatMap((r) => [
      r.checkedInBy as string,
      r.checkedOutBy as string,
    ]),
    ...issues.map((i) => i.reportedBy),
    ...sessions.flatMap((s) => [s.manager_staff_id, s.closed_by_id, s.opened_by_id]),
  ];
  const staffNames = await resolveStaffNames(staffIds);

  for (const r of attendanceAll) {
    r.participantName = partNames.get(String(r.participantId)) ?? "";
    r.checkedInByName = staffNames.get(String(r.checkedInBy)) ?? "";
    r.checkedOutByName = staffNames.get(String(r.checkedOutBy)) ?? "";
  }
  for (const r of morningAll) {
    r.participantName = partNames.get(String(r.participantId)) ?? "";
    r.accountedByName = staffNames.get(String(r.accountedBy)) ?? "";
  }
  for (const r of eveningAll) {
    r.participantName = partNames.get(String(r.participantId)) ?? "";
    r.accountedByName = staffNames.get(String(r.accountedBy)) ?? "";
  }
  for (const r of boardingAll) {
    const fromManifest = String(r.participantName ?? "").trim();
    r.participantName =
      fromManifest || partNames.get(String(r.participantId)) || "";
  }

  const folder = `03_Trips/${report.startDate}_${slugify(report.title)}`;

  const idBook = auditIdentity();
  const homeMatrixRows: Array<Record<string, unknown>> = attendanceAll.map((r) => {
    const pid = String(r.participantId);
    const planned = plannedReturn.get(pid) ?? null;
    const actualRet = String(r.returnTransport ?? "");
    const actualRun = String(r.returnBusRunCode ?? "").trim() || null;
    const completion = homeCompletionForRow({
      status: String(r.status),
      returnTransport: actualRet,
      returnBusRunCode: actualRun,
      planned,
      returnTrips,
    });
    const plannedMode = planned?.mode ?? "";
    const plannedRun = planned?.busRunCode ?? null;
    return {
      sessionDate: auditDate(String(r.sessionDate ?? "")),
      participantName: r.participantName ?? "",
      participantId: idBook.participantKey(pid),
      floorStatus: r.status,
      plannedReturnMode: plannedMode,
      plannedReturnBusRun: shortRun(plannedRun) || plannedRun || "",
      actualReturnMode: actualRet,
      actualReturnBusRun: shortRun(actualRun) || actualRun || "",
      checkedOutAt: auditDateTime(String(r.checkedOutAt ?? "")),
      checkedOutByName: r.checkedOutByName ?? "",
      homeComplete: completion.homeComplete,
      incompleteReason: completion.incompleteReason,
      returnManifestId: completion.returnManifestId,
      returnManifestStatus: completion.returnManifestStatus,
      modeMismatch:
        plannedMode &&
        actualRet &&
        plannedMode !== actualRet.toLowerCase()
          ? "yes"
          : "",
      runMismatch:
        (plannedRun || actualRun) &&
        !matchesEventBusRun(actualRun, plannedRun) &&
        actualRet.toLowerCase() === "bus" &&
        plannedMode === "bus"
          ? "yes"
          : "",
    };
  });

  const homeIncomplete = homeMatrixRows.filter((r) => r.homeComplete === "no");
  const homeCompleteCount = homeMatrixRows.filter((r) => r.homeComplete === "yes").length;
  const homeNaCount = homeMatrixRows.filter((r) => r.homeComplete === "n/a").length;

  const homeMatrixCsv = rowsToCsv(
    [
      "sessionDate",
      "participantName",
      "participantId",
      "floorStatus",
      "plannedReturnMode",
      "plannedReturnBusRun",
      "actualReturnMode",
      "actualReturnBusRun",
      "checkedOutAt",
      "checkedOutByName",
      "homeComplete",
      "incompleteReason",
      "returnManifestId",
      "returnManifestStatus",
      "modeMismatch",
      "runMismatch",
    ],
    homeMatrixRows,
  );

  const attendanceCsv = rowsToCsv(
    [
      "sessionDate",
      "participantName",
      "participantId",
      "status",
      "arrivalMethod",
      "arrivalBusRun",
      "checkedInAt",
      "checkedInByName",
      "checkedOutAt",
      "checkedOutByName",
      "returnTransport",
      "returnBusRun",
      "notes",
    ],
    attendanceAll.map((r) => ({
      ...r,
      participantId: idBook.participantKey(String(r.participantId ?? "")),
      checkedInBy: idBook.staffKey(String(r.checkedInBy ?? "")),
      checkedOutBy: idBook.staffKey(String(r.checkedOutBy ?? "")),
      sessionDate: auditDate(String(r.sessionDate ?? "")),
      arrivalBusRun:
        shortRun(String(r.arrivalBusRunCode ?? "")) ||
        String(r.arrivalBusRunCode ?? ""),
      returnBusRun:
        shortRun(String(r.returnBusRunCode ?? "")) ||
        String(r.returnBusRunCode ?? ""),
      checkedInAt: auditDateTime(String(r.checkedInAt ?? "")),
      checkedOutAt: auditDateTime(String(r.checkedOutAt ?? "")),
    })),
  );

  const boardingCsv = rowsToCsv(
    [
      "tripId",
      "tripLabel",
      "direction",
      "busRunCode",
      "participantName",
      "participantId",
      "status",
      "boardedAt",
      "notes",
    ],
    boardingAll.map((r) => ({
      ...r,
      participantId: idBook.participantKey(String(r.participantId ?? "")),
      boardedAt: auditDateTime(String(r.boardedAt ?? "")),
    })),
  );

  const rollsCsv = rowsToCsv(
    [
      "sessionDate",
      "roll",
      "participantName",
      "participantId",
      "status",
      "escalationSeverity",
      "accountedAt",
      "accountedByName",
      "notes",
    ],
    [...morningAll, ...eveningAll].map((r) => ({
      ...r,
      participantId: idBook.participantKey(String(r.participantId ?? "")),
      accountedBy: idBook.staffKey(String(r.accountedBy ?? "")),
      sessionDate: auditDate(String(r.sessionDate ?? "")),
      accountedAt: auditDateTime(String(r.accountedAt ?? "")),
    })),
  );

  const issueNotes = await loadHubNotesForRefs(
    issues.map((i) => ({ source: "event" as const, sourceRowId: i.id })),
  );
  const issueSummaries = summarizeResolutions(issueNotes);

  const issuesCsv = rowsToCsv(
    [
      "id",
      "severity",
      "status",
      "description",
      "workaround",
      "reporterName",
      "reporterId",
      "createdAt",
      "resolvedAt",
      "resolvedByName",
      "resolutionNote",
      "noteCount",
      "lastNoteAt",
      "lastNoteByName",
    ],
    issues.map((i) => {
      const sum = issueSummaries.get(`event:${i.id}`);
      const resolvedRaw = i.resolvedAt ?? sum?.resolvedAt ?? "";
      return {
        id: i.id,
        severity: i.severity,
        status: i.status,
        description: i.issueDescription,
        workaround: i.workaroundPlan ?? "",
        reporterName: i.reportedBy
          ? staffNames.get(i.reportedBy) ?? i.reportedBy
          : "",
        reporterId: idBook.staffKey(i.reportedBy ?? ""),
        createdAt: auditDateTime(i.createdAt),
        resolvedAt: auditDateTime(resolvedRaw),
        resolvedByName: sum?.resolvedByName ?? "",
        resolutionNote: sum?.resolutionNote ?? "",
        noteCount: sum?.noteCount ?? 0,
        lastNoteAt: auditDateTime(sum?.lastNoteAt ?? ""),
        lastNoteByName: sum?.lastNoteByName ?? "",
      };
    }),
  );

  const manifest = await assembleEventManifest(eventId, folder);
  const venueSafety = await assembleVenueSafetyEvidence(eventId, folder);

  const dayCloseCsv = rowsToCsv(
    [
      "sessionDate",
      "phase",
      "manager",
      "openedAt",
      "closedAt",
      "closedBy",
      "closeNotes",
      "morningRollTime",
      "eveningRollTime",
    ],
    sessions.map((s) => ({
      sessionDate: auditDate(s.session_date),
      phase: s.phase,
      manager: s.manager_staff_id
        ? staffNames.get(s.manager_staff_id) ??
          idBook.staffKey(s.manager_staff_id)
        : idBook.isDeid
          ? ""
          : (s.manager_name ?? ""),
      openedAt: auditDateTime(s.open_declared_at),
      closedAt: auditDateTime(s.close_declared_at),
      closedBy: staffNames.get(s.closed_by_id ?? "") ?? "",
      closeNotes: s.close_leader_notes ?? "",
      morningRollTime: auditClock(s.morning_roll_time),
      eveningRollTime: auditClock(s.curfew_time),
    })),
  );

  const doc = createAuditPdf(`Trip evidence — ${report.title}`);
  let y = 32;
  y = pdfAddKeyValues(
    doc,
    [
      ["Event", report.title],
      ["Kind", report.eventKind],
      ["Status", report.status],
      [
        "Dates",
        `${auditDate(report.startDate)} → ${auditDate(report.endDate ?? report.startDate)}`,
      ],
      ["Primary venue", report.primaryVenueName ?? "—"],
      ["Roster confirmed", String(report.rosterSummary.confirmed)],
      ["Days closed", report.accountabilitySummary.allSessionsClosed ? "Yes" : "No"],
      ["Issues R/Y/G", `${report.accountabilitySummary.totalRedIssues}/${report.accountabilitySummary.totalYellowIssues}/${report.accountabilitySummary.totalGreenIssues}`],
      ["Attendance rows", String(attendanceAll.length)],
      ["Boarding rows", String(boardingAll.length)],
      ["Morning/evening rows", String(morningAll.length + eveningAll.length)],
      ["Manifest trips / legs", `${manifest.tripCount} / ${manifest.legCount}`],
      ["Issue Hub notes", String(issueNotes.length)],
      [
        "HOME complete / incomplete / N/A",
        `${homeCompleteCount} / ${homeIncomplete.length} / ${homeNaCount}`,
      ],
      [
        "Venue baselines present / missing",
        `${venueSafety.summary.baselinesPresent} / ${venueSafety.summary.baselinesMissing}`,
      ],
      [
        "Open walkthroughs (with ticks)",
        `${venueSafety.summary.walkthroughOpens} (${venueSafety.summary.walkthroughWithChecks})`,
      ],
      ["Venue reconfirmations", String(venueSafety.summary.reconfirmCount)],
      ["Finance net", String(report.finance.netPnl)],
    ],
    y,
  );

  y = pdfAddHeading(doc, "Day-close matrix", y + 2);
  y = pdfAddLines(
    doc,
    sessions.length
      ? sessions.map((s) => {
          const leader = s.manager_staff_id
            ? staffNames.get(s.manager_staff_id) ??
              idBook.staffKey(s.manager_staff_id)
            : idBook.isDeid
              ? "—"
              : (s.manager_name ?? "—");
          return `${auditDate(s.session_date)} · ${s.phase} · leader ${leader} · close ${auditDateTime(s.close_declared_at) || "open"}`;
        })
      : ["No day sessions."],
    y,
  );

  y = pdfAddHeading(doc, "Transport HOME completion (BL-095)", y + 2);
  if (homeMatrixRows.length === 0) {
    y = pdfAddLines(doc, ["No attendance rows for HOME matrix."], y);
  } else {
    y = pdfAddLines(
      doc,
      [
        `Complete ${homeCompleteCount} · Incomplete ${homeIncomplete.length} · N/A (absent) ${homeNaCount}`,
        ...homeIncomplete.slice(0, 30).map(
          (r) =>
            `${r.sessionDate} · ${r.participantName} · ${r.floorStatus} · planned ${r.plannedReturnMode || "—"}${r.plannedReturnBusRun ? `/${r.plannedReturnBusRun}` : ""} · actual ${r.actualReturnMode || "—"}${r.actualReturnBusRun ? `/${r.actualReturnBusRun}` : ""} · ${r.incompleteReason}`,
        ),
        ...(homeIncomplete.length > 30
          ? [`… +${homeIncomplete.length - 30} more incomplete (see home_completion_matrix.csv)`]
          : homeIncomplete.length === 0
            ? ["No incomplete HOME assignments."]
            : []),
      ],
      y,
    );
  }

  y = pdfAddHeading(doc, "Venue safety (BL-094)", y + 2);
  y = pdfAddLines(doc, venueSafety.pdfLines, y);

  y = pdfAddHeading(doc, "Roll breaches (non-accounted / escalated)", y + 2);
  const breaches = [...morningAll, ...eveningAll].filter((r) => {
    const st = String(r.status ?? "").toLowerCase();
    const sev = String(r.escalationSeverity ?? "");
    return st === "absent" || st === "overdue" || !!sev;
  });
  y = pdfAddLines(
    doc,
    breaches.length
      ? breaches.slice(0, 40).map(
          (r) =>
            `${auditDate(String(r.sessionDate))} ${r.roll} · ${r.participantName} · ${r.status} · ${r.escalationSeverity || "—"}`,
        )
      : ["No roll breaches recorded."],
    y,
  );

  y = pdfAddHeading(doc, "Issues (reporter + resolution trail)", y + 2);
  if (issues.length === 0) {
    y = pdfAddLines(doc, ["No issues logged for this trip."], y);
  } else {
    for (const i of issues.slice(0, 20)) {
      const reporter = i.reportedBy
        ? staffNames.get(i.reportedBy) ?? i.reportedBy
        : "—";
      const sum = issueSummaries.get(`event:${i.id}`);
      y = pdfAddLines(
        doc,
        [
          `${i.severity} · ${i.status} · logged by ${reporter} · ${(i.issueDescription || "").slice(0, 80)}`,
          sum?.resolutionNote
            ? `  FINAL (${auditDateTime(sum.resolvedAt) || "—"} by ${sum.resolvedByName || "—"}): ${sum.resolutionNote.slice(0, 100)}`
            : `  No Hub resolution note · notes=${sum?.noteCount ?? 0}`,
        ],
        y,
      );
      const trail = issueNotes.filter((n) => n.sourceRowId === i.id);
      if (trail.length) {
        y = pdfAddLines(
          doc,
          formatTrailPreview(trail, 4).map((l) => `    ${l}`),
          y,
        );
      }
    }
  }

  return {
    folder,
    title: report.title,
    files: [
      { path: `${folder}/trip_evidence.pdf`, content: pdfToBytes(doc) },
      { path: `${folder}/attendance_timeline.csv`, content: attendanceCsv },
      { path: `${folder}/home_completion_matrix.csv`, content: homeMatrixCsv },
      { path: `${folder}/boarding_rolls.csv`, content: boardingCsv },
      { path: `${folder}/morning_evening.csv`, content: rollsCsv },
      { path: `${folder}/issues.csv`, content: issuesCsv },
      {
        path: `${folder}/issue_notes_timeline.csv`,
        content: notesToCsv(issueNotes),
      },
      { path: `${folder}/day_close_matrix.csv`, content: dayCloseCsv },
      ...venueSafety.files,
      ...manifest.files,
    ],
  };
}

export async function assembleTripsSection(
  range: AuditDateRange,
  onProgress?: (msg: string) => void,
): Promise<{ files: AuditPackFile[]; tripCount: number }> {
  const events = await listOutingEventsInRange(range);
  const files: AuditPackFile[] = [];
  const indexRows: Array<Record<string, unknown>> = [];

  let i = 0;
  for (const ev of events) {
    i += 1;
    onProgress?.(`Trips ${i}/${events.length}: ${ev.title}`);
    try {
      const pack = await assembleTripEvidence(ev.id);
      files.push(...pack.files);
      indexRows.push({
        eventId: ev.id,
        title: ev.title,
        status: ev.status,
        startDate: ev.start_date,
        endDate: ev.end_date ?? ev.start_date,
        folder: pack.folder,
      });
    } catch (err) {
      console.warn("[audit-pack] trip evidence failed", ev.id, err);
      indexRows.push({
        eventId: ev.id,
        title: ev.title,
        status: ev.status,
        startDate: ev.start_date,
        endDate: ev.end_date ?? ev.start_date,
        folder: "ERROR",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  files.unshift({
    path: "03_Trips/trips_index.csv",
    content: rowsToCsv(
      ["eventId", "title", "status", "startDate", "endDate", "folder", "error"],
      indexRows,
    ),
  });

  if (events.length === 0) {
    files.push({
      path: "03_Trips/README.txt",
      content:
        "No outing events found in the selected date range.\r\n",
    });
  }

  return { files, tripCount: events.length };
}
