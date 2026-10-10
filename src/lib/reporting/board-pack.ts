/**
 * Centre journal + trips board pack.
 * Live read of sessions, attendance, opened meals, non-incident notes, and IR papers.
 * The only thing stored is the last printed To date (system_parameters).
 */
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { updateSystemParameter } from "@/lib/api/system-parameters";
import { MEAL_SLOT_LABELS, type MealSlot } from "@/lib/api/site-day-activities";
import { buildTripReport, type TripReport } from "@/lib/api/event-lifecycle";
import {
  loadIncidentBoard,
  splitIncidentNarrative,
  toBoardPrintModel,
  type BoardHubSource,
  type IncidentBoardPrintModel,
} from "@/lib/incident-board-report";
import { getEventDayPhaseDisplay } from "@/lib/event-day-phase-display";
import { dateAtSydneyMidday, getSydneyIsoDate } from "@/lib/operational-time";
import { formatDate } from "@/lib/utils";

export const BOARD_PACK_LAST_TO_KEY = "reporting_board_pack_last_to";

export type BoardPackIncident = {
  number: string;
  summary: string;
  completed: "Yes" | "No";
  followUpRequired: string;
  followUp: string;
  hubSource: BoardHubSource;
  hubRowId: string;
};

export type BoardPackDay = {
  key: string;
  dateIso: string;
  dateLabel: string;
  clients: number;
  volunteers: number;
  entries: string;
  incidents: BoardPackIncident[];
};

export type BoardPackTripDay = BoardPackDay & {
  eventId: string;
  title: string;
  phaseLabel: string;
};

export type BoardPack = {
  fromIso: string;
  toIso: string;
  centre: BoardPackDay[];
  trips: BoardPackTripDay[];
  /** Full YADA incident sheet, keyed by hub row. Null when that sheet could not be loaded. */
  incidentSheets: Record<string, IncidentBoardPrintModel | null>;
  /** Event Manage Trip Report, keyed by event id. */
  tripReports: Record<string, TripReport | null>;
};

export type BoardPackTripGroup = {
  eventId: string;
  title: string;
  incidents: BoardPackIncident[];
};

export function centreIncidentsOf(pack: BoardPack): BoardPackIncident[] {
  const seen = new Set<string>();
  const out: BoardPackIncident[] = [];
  for (const day of pack.centre) {
    for (const inc of day.incidents) {
      if (seen.has(inc.hubRowId)) continue;
      seen.add(inc.hubRowId);
      out.push(inc);
    }
  }
  return out;
}

/** One group per trip, in the same order as the trips summary. */
export function tripGroupsOf(pack: BoardPack): BoardPackTripGroup[] {
  const groups: BoardPackTripGroup[] = [];
  const index = new Map<string, BoardPackTripGroup>();
  for (const day of pack.trips) {
    const key = day.eventId || day.key;
    let group = index.get(key);
    if (!group) {
      group = { eventId: day.eventId, title: day.title, incidents: [] };
      index.set(key, group);
      groups.push(group);
    }
    for (const inc of day.incidents) {
      if (!group.incidents.some((existing) => existing.hubRowId === inc.hubRowId)) {
        group.incidents.push(inc);
      }
    }
  }
  return groups;
}

const CLOSED = new Set(["resolved", "closed", "workaround_accepted", "completed"]);
const PRESENT = new Set(["checked_in", "checked_out"]);

export function addIsoDays(iso: string, days: number): string {
  const d = dateAtSydneyMidday(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return getSydneyIsoDate(d);
}

/** First visit: 1st of this month through today. After a print: the day after that To. */
export function defaultBoardPackRange(
  lastTo: string | null,
  today: string,
): { from: string; to: string } {
  if (lastTo && /^\d{4}-\d{2}-\d{2}$/.test(lastTo)) {
    const next = addIsoDays(lastTo, 1);
    if (next <= today) return { from: next, to: today };
    return { from: today, to: today };
  }
  return { from: `${today.slice(0, 8)}01`, to: today };
}

export async function readBoardPackLastTo(): Promise<string | null> {
  const { data, error } = await supabase
    .from("system_parameters")
    .select("value")
    .eq("key", BOARD_PACK_LAST_TO_KEY)
    .maybeSingle();
  if (error || !data) return null;
  const value = data.value;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export async function rememberBoardPackLastTo(toIso: string): Promise<void> {
  await updateSystemParameter({
    key: BOARD_PACK_LAST_TO_KEY,
    newValue: toIso,
    justification: "Printed the centre and trips board pack.",
  });
}

function clip(text: string, max = 220): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

function sydneyDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return getSydneyIsoDate(d);
}

function displayDay(value: string | null | undefined): string {
  if (!value) return "";
  if (value.includes("T")) {
    const day = sydneyDay(value);
    return day ? formatDate(day) : "";
  }
  return formatDate(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function presentCount(rows: Array<{ status?: string | null }>): number {
  return rows.filter((r) => PRESENT.has(String(r.status ?? ""))).length;
}

async function selectIn(
  table: string,
  columns: string,
  column: string,
  ids: string[],
): Promise<Array<Record<string, unknown>>> {
  if (ids.length === 0) return [];
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < ids.length; i += 80) {
    const slice = ids.slice(i, i + 80);
    const { data, error } = await supabase.from(table).select(columns).in(column, slice);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as Array<Record<string, unknown>>));
  }
  return out;
}

function mealLine(slot: unknown, title: unknown, notes: unknown): string {
  const slotKey = str(slot) as MealSlot;
  const label = MEAL_SLOT_LABELS[slotKey] || str(title) || "Meal";
  const food = str(notes);
  return food ? `${label} — ${food}` : label;
}

function mealWasOpened(row: Record<string, unknown>): boolean {
  if (str(row.opened_at)) return true;
  const phase = str(row.phase);
  return phase === "active" || phase === "completed";
}

function isFormalNote(row: Record<string, unknown>, paperIds: Set<string>): boolean {
  const id = str(row.id);
  if (paperIds.has(id)) return true;
  if (str(row.incident_number)) return true;
  const desc = str(row.issue_description);
  if (/\[INCIDENT\]/i.test(desc)) return true;
  if (/filed from:/i.test(desc)) return true;
  return false;
}

function noteLine(row: Record<string, unknown>): string {
  const sev = str(row.severity);
  const label = sev ? sev.charAt(0).toUpperCase() + sev.slice(1).toLowerCase() : "Note";
  const account = splitIncidentNarrative(str(row.issue_description)).account;
  return `${label} — ${clip(account, 180)}`;
}

function asHubSource(source: string): BoardHubSource | null {
  if (
    source === "incident" ||
    source === "maintenance" ||
    source === "day_centre" ||
    source === "event"
  ) {
    return source;
  }
  return null;
}

type Paper = {
  rowId: string;
  hubSource: BoardHubSource;
  number: string;
  summary: string;
  closed: boolean;
  deferredUntil: string | null;
  deferredReason: string;
  resolution: string;
  workaround: string;
  officeOutcome: string;
  place:
    | { kind: "centre"; date: string }
    | { kind: "trip"; date: string; eventId: string; sessionId: string | null };
};

function followText(
  paper: Paper,
  notes: Map<string, { resolve: string; defer: string; any: string }>,
  rowId: string,
): { followUp: string; followUpRequired: string } {
  const extra = notes.get(rowId);
  const resolve = (extra?.resolve ?? "").replace(/^\[RESOLVED\]\s*/i, "").trim();
  if (paper.closed) {
    return {
      followUp: clip(resolve || paper.resolution || paper.officeOutcome || paper.workaround || "Closed"),
      followUpRequired: "",
    };
  }
  return {
    followUp: clip(
      paper.deferredReason || extra?.defer || paper.workaround || extra?.any || paper.officeOutcome || "Open",
    ),
    followUpRequired: displayDay(paper.deferredUntil),
  };
}

export async function loadBoardPack(fromIso: string, toIso: string): Promise<BoardPack> {
  const [sessionsRes, tripDaysRes, papersRes] = await Promise.all([
    supabase
      .from("site_day_sessions")
      .select("id, session_date, phase")
      .gte("session_date", fromIso)
      .lte("session_date", toIso)
      .order("session_date", { ascending: true }),
    supabase
      .from("event_day_sessions")
      .select("id, event_id, session_date, phase")
      .gte("session_date", fromIso)
      .lte("session_date", toIso)
      .order("session_date", { ascending: true }),
    supabase
      .from("incident_board_reports")
      .select("incident_number, lane, hub_source, hub_row_id, board_office")
      .order("incident_number", { ascending: true })
      .limit(3000),
  ]);

  if (sessionsRes.error) throw new Error(sessionsRes.error.message);
  if (tripDaysRes.error) throw new Error(tripDaysRes.error.message);
  if (papersRes.error) {
    if (isSchemaMismatchError(papersRes.error)) {
      throw new Error("Board pack needs the incident-number SQL loaded first.");
    }
    throw new Error(papersRes.error.message);
  }

  const centreSessions = (sessionsRes.data ?? []) as Array<Record<string, unknown>>;
  const tripDays = (tripDaysRes.data ?? []) as Array<Record<string, unknown>>;
  const paperRows = (papersRes.data ?? []) as Array<Record<string, unknown>>;

  const eventIds = [...new Set(tripDays.map((r) => str(r.event_id)).filter(Boolean))];
  const manifests = await selectIn("event_manifest", "id, title, status", "id", eventIds);
  const openEvents = new Map<string, string>();
  for (const ev of manifests) {
    const status = str(ev.status);
    if (status === "Open" || status === "Closed") {
      openEvents.set(str(ev.id), str(ev.title) || "Trip");
    }
  }
  const liveTripDays = tripDays.filter((d) => openEvents.has(str(d.event_id)));

  const bySource = new Map<string, string[]>();
  for (const p of paperRows) {
    const source = str(p.hub_source);
    const id = str(p.hub_row_id);
    if (!source || !id) continue;
    const list = bySource.get(source) ?? [];
    list.push(id);
    bySource.set(source, list);
  }

  const [incidents, maintenance, siteIssues] = await Promise.all([
    selectIn(
      "operational_incidents",
      "id, description, status, occurred_at, created_at, event_id",
      "id",
      bySource.get("incident") ?? [],
    ),
    selectIn(
      "maintenance_items",
      "id, title, description, status, occurred_at, created_at, event_id, resolution_notes, deferred_until, deferred_reason",
      "id",
      bySource.get("maintenance") ?? [],
    ),
    selectIn(
      "site_issues_register",
      "id, issue_description, status, occurred_at, created_at, session_id, event_id, event_day_session_id, deferred_until, workaround_plan",
      "id",
      [...(bySource.get("day_centre") ?? []), ...(bySource.get("event") ?? [])],
    ),
  ]);

  const incidentById = new Map(incidents.map((r) => [str(r.id), r]));
  const maintenanceById = new Map(maintenance.map((r) => [str(r.id), r]));
  const issueById = new Map(siteIssues.map((r) => [str(r.id), r]));

  const tripSessionById = new Map(liveTripDays.map((r) => [str(r.id), r]));

  const papers: Paper[] = [];
  const extraEventIds = new Set<string>();

  for (const raw of paperRows) {
    const hubSource = asHubSource(str(raw.hub_source));
    const rowId = str(raw.hub_row_id);
    const number = str(raw.incident_number);
    if (!hubSource || !number || !rowId) continue;
    const office = asRecord(raw.board_office);
    let row: Record<string, unknown> | undefined;
    let summary = "";
    let eventId = "";
    let sessionId = "";
    let closed = false;
    let deferredUntil: string | null = null;
    let deferredReason = "";
    let resolution = "";
    let workaround = "";

    const source = hubSource;
    if (source === "incident") {
      row = incidentById.get(rowId);
      if (!row) continue;
      summary = splitIncidentNarrative(str(row.description)).account;
      eventId = str(row.event_id);
      closed = CLOSED.has(str(row.status).toLowerCase());
    } else if (source === "maintenance") {
      row = maintenanceById.get(rowId);
      if (!row) continue;
      const title = str(row.title);
      const desc = splitIncidentNarrative(str(row.description)).account;
      summary = title && desc && !desc.startsWith(title) ? `${title} — ${desc}` : title || desc;
      eventId = str(row.event_id);
      closed = CLOSED.has(str(row.status).toLowerCase());
      deferredUntil = str(row.deferred_until) || null;
      deferredReason = str(row.deferred_reason);
      resolution = str(row.resolution_notes);
    } else {
      row = issueById.get(rowId);
      if (!row) continue;
      summary = splitIncidentNarrative(str(row.issue_description)).account;
      eventId = str(row.event_id);
      sessionId = str(row.event_day_session_id);
      closed = CLOSED.has(str(row.status).toLowerCase());
      deferredUntil = str(row.deferred_until) || null;
      workaround = str(row.workaround_plan);
      if (sessionId && !eventId) {
        eventId = str(tripSessionById.get(sessionId)?.event_id);
      }
    }

    const occurred = sydneyDay(str(row.occurred_at) || str(row.created_at));
    if (!occurred || occurred < fromIso || occurred > toIso) continue;

    const trip = source === "event" || !!eventId;
    if (trip) {
      if (eventId && !openEvents.has(eventId)) extraEventIds.add(eventId);
      papers.push({
        rowId,
        hubSource,
        number,
        summary: clip(summary || "Incident"),
        closed,
        deferredUntil,
        deferredReason,
        resolution,
        workaround,
        officeOutcome: str(office.investigationOutcome),
        place: { kind: "trip", date: occurred, eventId, sessionId: sessionId || null },
      });
    } else {
      papers.push({
        rowId,
        hubSource,
        number,
        summary: clip(summary || "Incident"),
        closed,
        deferredUntil,
        deferredReason,
        resolution,
        workaround,
        officeOutcome: str(office.investigationOutcome),
        place: { kind: "centre", date: occurred },
      });
    }
  }

  if (extraEventIds.size > 0) {
    const more = await selectIn(
      "event_manifest",
      "id, title, status",
      "id",
      [...extraEventIds],
    );
    for (const ev of more) {
      if (!openEvents.has(str(ev.id))) {
        openEvents.set(str(ev.id), str(ev.title) || "Trip");
      }
    }
  }

  const noteIds = papers.map((p) => p.rowId);
  const noteRows = await selectIn(
    "hub_issue_notes",
    "source_row_id, note, kind, stamped_at, metadata",
    "source_row_id",
    noteIds,
  );
  noteRows.sort((a, b) => str(b.stamped_at).localeCompare(str(a.stamped_at)));
  const notes = new Map<string, { resolve: string; defer: string; any: string }>();
  for (const n of noteRows) {
    const id = str(n.source_row_id);
    const slot = notes.get(id) ?? { resolve: "", defer: "", any: "" };
    const text = str(n.note);
    if (!slot.any && text) slot.any = text;
    if (!slot.resolve && str(n.kind) === "resolve") slot.resolve = text;
    if (!slot.defer && str(n.kind) === "defer") slot.defer = text;
    notes.set(id, slot);
    const paper = papers.find((p) => p.rowId === id);
    if (paper && !paper.deferredUntil && str(n.kind) === "defer") {
      const until = str(asRecord(n.metadata).deferred_until);
      if (until) paper.deferredUntil = until;
    }
  }

  const centreSessionIds = centreSessions.map((r) => str(r.id)).filter(Boolean);
  const tripSessionIds = liveTripDays.map((r) => str(r.id)).filter(Boolean);
  const paperIds = new Set(papers.map((p) => p.rowId));

  const [
    clientRows,
    supportRows,
    meals,
    centreNotes,
    eventClients,
    eventSupport,
    tripMeals,
    tripNotes,
  ] = await Promise.all([
    selectIn("client_attendance_log", "session_id, status", "session_id", centreSessionIds),
    selectIn(
      "support_attendance_log",
      "session_id, person_kind, status",
      "session_id",
      centreSessionIds,
    ),
    selectIn(
      "site_day_activities",
      "session_id, activity_kind, meal_slot, title, menu_notes, phase, opened_at",
      "session_id",
      centreSessionIds,
    ),
    selectIn(
      "site_issues_register",
      "id, session_id, severity, issue_description, incident_number",
      "session_id",
      centreSessionIds,
    ),
    selectIn(
      "event_attendance_log",
      "event_day_session_id, status",
      "event_day_session_id",
      tripSessionIds,
    ),
    selectIn(
      "event_support_attendance_log",
      "event_day_session_id, person_kind, status",
      "event_day_session_id",
      tripSessionIds,
    ),
    selectIn(
      "event_venue_stops",
      "event_id, session_date, activity_kind, meal_slot, label_override, menu_notes, phase, opened_at",
      "event_id",
      [...openEvents.keys()],
    ),
    selectIn(
      "site_issues_register",
      "id, event_day_session_id, severity, issue_description, incident_number",
      "event_day_session_id",
      tripSessionIds,
    ),
  ]);

  const packIncident = (p: Paper): BoardPackIncident => {
    const follow = followText(p, notes, p.rowId);
    return {
      number: p.number,
      summary: p.summary,
      completed: p.closed ? "Yes" : "No",
      followUpRequired: follow.followUpRequired,
      followUp: follow.followUp,
      hubSource: p.hubSource,
      hubRowId: p.rowId,
    };
  };

  const centre: BoardPackDay[] = centreSessions.map((session) => {
    const id = str(session.id);
    const date = str(session.session_date);
    const phase = str(session.phase);
    const lines: string[] = [];
    if (phase === "closed_no_go" || phase === "open_pending") lines.push("Centre not opened");
    if (phase === "escalated_lock") lines.push("Day locked");
    for (const meal of meals) {
      if (str(meal.session_id) !== id) continue;
      if (str(meal.activity_kind) !== "meal") continue;
      if (!mealWasOpened(meal)) continue;
      lines.push(mealLine(meal.meal_slot, meal.title, meal.menu_notes));
    }
    for (const note of centreNotes) {
      if (str(note.session_id) !== id) continue;
      if (isFormalNote(note, paperIds)) continue;
      lines.push(noteLine(note));
    }
    const dayPapers = papers.filter((p) => p.place.kind === "centre" && p.place.date === date);
    return {
      key: id || date,
      dateIso: date,
      dateLabel: formatDate(date),
      clients: presentCount(clientRows.filter((r) => str(r.session_id) === id)),
      volunteers: presentCount(
        supportRows.filter(
          (r) => str(r.session_id) === id && str(r.person_kind) === "volunteer",
        ),
      ),
      entries: lines.join("\n"),
      incidents: dayPapers.map(packIncident),
    };
  });

  const shownTripPapers = new Set<string>();
  const trips: BoardPackTripDay[] = liveTripDays.map((day) => {
    const id = str(day.id);
    const eventId = str(day.event_id);
    const date = str(day.session_date);
    const lines: string[] = [];
    for (const meal of tripMeals) {
      if (str(meal.event_id) !== eventId || str(meal.session_date) !== date) continue;
      if (str(meal.activity_kind) !== "meal") continue;
      if (!mealWasOpened(meal)) continue;
      lines.push(mealLine(meal.meal_slot, meal.label_override, meal.menu_notes));
    }
    for (const note of tripNotes) {
      if (str(note.event_day_session_id) !== id) continue;
      if (isFormalNote(note, paperIds)) continue;
      lines.push(noteLine(note));
    }
    const dayPapers = papers.filter((p) => {
      if (shownTripPapers.has(p.rowId)) return false;
      if (p.place.kind !== "trip" || p.place.date !== date) return false;
      if (p.place.eventId && p.place.eventId === eventId) return true;
      return !!p.place.sessionId && p.place.sessionId === id;
    });
    for (const p of dayPapers) shownTripPapers.add(p.rowId);
    const phase = str(day.phase) || "planning";
    return {
      key: id,
      dateIso: date,
      dateLabel: formatDate(date),
      eventId,
      title: openEvents.get(eventId) || "Trip",
      phaseLabel: getEventDayPhaseDisplay(phase).label,
      clients: presentCount(eventClients.filter((r) => str(r.event_day_session_id) === id)),
      volunteers: presentCount(
        eventSupport.filter(
          (r) => str(r.event_day_session_id) === id && str(r.person_kind) === "volunteer",
        ),
      ),
      entries: lines.join("\n"),
      incidents: dayPapers.map(packIncident),
    };
  });

  for (const paper of papers) {
    if (paper.place.kind !== "trip") continue;
    if (shownTripPapers.has(paper.rowId)) continue;
    const place = paper.place;
    const key = `${place.eventId}|${place.sessionId ?? ""}|${place.date}`;
    const siblings = papers.filter((p) => {
      if (p.place.kind !== "trip") return false;
      if (shownTripPapers.has(p.rowId)) return false;
      return p.place.eventId === place.eventId && p.place.date === place.date;
    });
    for (const p of siblings) shownTripPapers.add(p.rowId);
    trips.push({
      key,
      dateIso: place.date,
      dateLabel: formatDate(place.date),
      eventId: place.eventId,
      title: openEvents.get(place.eventId) || "Trip",
      phaseLabel: "Incident",
      clients: 0,
      volunteers: 0,
      entries: "",
      incidents: siblings.map(packIncident),
    });
  }

  trips.sort((a, b) => a.dateIso.localeCompare(b.dateIso) || a.title.localeCompare(b.title));

  const centreDates = new Set(centre.map((d) => d.dateIso));
  for (const paper of papers) {
    if (paper.place.kind !== "centre") continue;
    if (centreDates.has(paper.place.date)) continue;
    centreDates.add(paper.place.date);
    const siblings = papers.filter(
      (p) => p.place.kind === "centre" && p.place.date === paper.place.date,
    );
    centre.push({
      key: `ir-${paper.place.date}`,
      dateIso: paper.place.date,
      dateLabel: formatDate(paper.place.date),
      clients: 0,
      volunteers: 0,
      entries: "",
      incidents: siblings.map(packIncident),
    });
  }
  centre.sort((a, b) => a.dateIso.localeCompare(b.dateIso));
  for (let i = 0; i < centre.length; i += 1) {
    const row = centre[i];
    const next = centre[i + 1];
    if (!next || next.dateIso !== row.dateIso) continue;
    row.clients += next.clients;
    row.volunteers += next.volunteers;
    row.entries = [row.entries, next.entries].filter(Boolean).join("\n");
    for (const inc of next.incidents) {
      if (!row.incidents.some((existing) => existing.number === inc.number)) {
        row.incidents.push(inc);
      }
    }
    centre.splice(i + 1, 1);
    i -= 1;
  }

  const sheetRefs: BoardPackIncident[] = [];
  const seenSheets = new Set<string>();
  for (const day of [...centre, ...trips]) {
    for (const inc of day.incidents) {
      if (seenSheets.has(inc.hubRowId)) continue;
      seenSheets.add(inc.hubRowId);
      sheetRefs.push(inc);
    }
  }
  const incidentSheets: Record<string, IncidentBoardPrintModel | null> = {};
  await Promise.all(
    sheetRefs.map(async (inc) => {
      try {
        const loaded = await loadIncidentBoard({
          hubSource: inc.hubSource,
          hubRowId: inc.hubRowId,
        });
        incidentSheets[inc.hubRowId] = toBoardPrintModel(loaded.facts, loaded.office);
      } catch {
        incidentSheets[inc.hubRowId] = null;
      }
    }),
  );

  const tripReports: Record<string, TripReport | null> = {};
  const tripEventIds = [...new Set(trips.map((day) => day.eventId).filter(Boolean))];
  await Promise.all(
    tripEventIds.map(async (eventId) => {
      try {
        tripReports[eventId] = await buildTripReport(eventId);
      } catch {
        tripReports[eventId] = null;
      }
    }),
  );

  return { fromIso, toIso, centre, trips, incidentSheets, tripReports };
}
