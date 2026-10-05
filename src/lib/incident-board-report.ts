/**
 * Board incident report — YADA Incident Report (Version 1, 23.07.2024).
 * Number + office block live on operational_incidents. Print is a view of that row.
 */
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { recordOfficeChangeBestEffort } from "@/lib/api/office-change-log";
import { hubReporterDisplay } from "@/lib/governance/hub-reporter-display";
import { formatDate, todayLocalIso } from "@/lib/utils";

export type BoardLane = "human" | "asset" | "health_safety";
export type BoardHubSource = "incident" | "maintenance" | "day_centre" | "event";

export type BoardActionRequired = "investigation" | "continuous_improvement";
export type NdisReportType = "5_day" | "24_hour";

export interface BoardOffice {
  injuryReport: boolean | null;
  injuredName: string;
  location: string;
  witnessName: string;
  witnessPhone: string;
  witnessEmail: string;
  witnessAccount: string;
  injuriesImpact: string;
  actionsTaken: string;
  receivedBy: string;
  receivedOn: string;
  actionRequired: BoardActionRequired | null;
  investigationOutcome: string;
  reportable: boolean | null;
  reportableOn: string;
  ndisAdvised: boolean | null;
  ndisAdvisedOn: string;
  ndisReportType: NdisReportType | null;
  escalatedTo: string;
  escalatedOn: string;
  other: string;
  otherWhom: string;
}

export interface IncidentBoardFacts {
  incidentId: string;
  incidentNumber: string;
  participantOn: boolean;
  participantLine: string;
  workerOn: boolean;
  workerLine: string;
  otherOn: boolean;
  reporterName: string;
  reporterPhone: string;
  reporterEmail: string;
  incidentDate: string;
  reportDate: string;
  description: string;
  actionsSeed: string;
  locationSeed: string;
  /** Pre-filled "Other (state whom)" until office saves that key. */
  otherSeed: string;
}

export interface IncidentBoardPrintModel {
  incidentNumber: string;
  participantOn: boolean;
  participantLine: string;
  workerOn: boolean;
  workerLine: string;
  otherOn: boolean;
  otherLine: string;
  incidentDate: string;
  injuryYes: boolean;
  injuryNo: boolean;
  injuredName: string;
  location: string;
  reporterName: string;
  reporterPhone: string;
  reporterEmail: string;
  reportDate: string;
  description: string;
  witnessName: string;
  witnessPhone: string;
  witnessEmail: string;
  witnessAccount: string;
  injuriesImpact: string;
  actionsTaken: string;
  receivedBy: string;
  receivedDate: string;
  actionInvestigation: boolean;
  actionCi: boolean;
  investigationOutcome: string;
  reportableYes: boolean;
  reportableNo: boolean;
  reportableDate: string;
  ndisYes: boolean;
  ndisNo: boolean;
  ndisDate: string;
  report5Day: boolean;
  report24Hour: boolean;
  escalatedTo: string;
  escalatedDate: string;
  other: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function emptyBoardOffice(): BoardOffice {
  return {
    injuryReport: null,
    injuredName: "",
    location: "",
    witnessName: "",
    witnessPhone: "",
    witnessEmail: "",
    witnessAccount: "",
    injuriesImpact: "",
    actionsTaken: "",
    receivedBy: "",
    receivedOn: "",
    actionRequired: null,
    investigationOutcome: "",
    reportable: null,
    reportableOn: "",
    ndisAdvised: null,
    ndisAdvisedOn: "",
    ndisReportType: null,
    escalatedTo: "",
    escalatedOn: "",
    other: "",
    otherWhom: "",
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function boolOrNull(v: unknown): boolean | null {
  if (v === true || v === false) return v;
  return null;
}

export function parseBoardOffice(raw: unknown): BoardOffice {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const action = str(o.actionRequired);
  const reportType = str(o.ndisReportType);
  return {
    ...emptyBoardOffice(),
    injuryReport: boolOrNull(o.injuryReport),
    injuredName: str(o.injuredName),
    location: str(o.location),
    witnessName: str(o.witnessName),
    witnessPhone: str(o.witnessPhone),
    witnessEmail: str(o.witnessEmail),
    witnessAccount: str(o.witnessAccount),
    injuriesImpact: str(o.injuriesImpact),
    actionsTaken: str(o.actionsTaken),
    receivedBy: str(o.receivedBy),
    receivedOn: str(o.receivedOn),
    actionRequired:
      action === "investigation" || action === "continuous_improvement" ? action : null,
    investigationOutcome: str(o.investigationOutcome),
    reportable: boolOrNull(o.reportable),
    reportableOn: str(o.reportableOn),
    ndisAdvised: boolOrNull(o.ndisAdvised),
    ndisAdvisedOn: str(o.ndisAdvisedOn),
    ndisReportType: reportType === "5_day" || reportType === "24_hour" ? reportType : null,
    escalatedTo: str(o.escalatedTo),
    escalatedOn: str(o.escalatedOn),
    other: str(o.other),
    otherWhom: str(o.otherWhom),
  };
}

export function boardOfficeSqlHint(error: { code?: string | null; message?: string | null } | null): boolean {
  return isSchemaMismatchError(error);
}

/** Floor account vs the verbal-consultation sentence, without Hub suffixes. */
export function splitIncidentNarrative(description: string): {
  account: string;
  actionsSeed: string;
  clientsLabel: string | null;
  staffLabel: string | null;
} {
  let text = description.trim();
  let clientsLabel: string | null = null;
  let staffLabel: string | null = null;

  const who = text.match(
    /\[Occurred clients:\s*([^·\]]*?)\s*·\s*Assisted\/involved:\s*([^\]]*)\]/i,
  );
  if (who) {
    clientsLabel = who[1].trim() || null;
    staffLabel = who[2].trim() || null;
    text = text.replace(who[0], " ").trim();
  }

  text = text
    .replace(/\s*\[(?:Event:\s*[^·\]]+\s*·\s*)?Filed from:\s*[^\]]+\]\s*$/i, "")
    .trim();

  let actionsSeed = "";
  const consult = text.match(/\s[—–-]\sConsulted:\s*([\s\S]+)$/);
  if (consult) {
    actionsSeed = `Consulted: ${consult[1].trim()}`;
    text = text.slice(0, consult.index).trim();
  }

  text = text.replace(/^\[VERBAL WORKAROUND\]\s*/i, "").trim();
  return { account: text, actionsSeed, clientsLabel, staffLabel };
}

function usableLabel(label: string | null): string {
  const t = (label ?? "").trim();
  if (!t || t === "—" || /^no client involved$/i.test(t)) return "";
  return t;
}

function formatDisplayDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const shown = formatDate(trimmed);
  return shown === "—" ? "" : shown;
}

export function toBoardPrintModel(
  facts: IncidentBoardFacts,
  office: BoardOffice,
): IncidentBoardPrintModel {
  return {
    incidentNumber: facts.incidentNumber,
    participantOn: facts.participantOn,
    participantLine: facts.participantLine,
    workerOn: facts.workerOn,
    workerLine: facts.workerLine,
    otherOn: facts.otherOn || !!office.otherWhom.trim(),
    otherLine: office.otherWhom.trim(),
    incidentDate: facts.incidentDate,
    injuryYes: office.injuryReport === true,
    injuryNo: office.injuryReport === false,
    injuredName: office.injuredName.trim(),
    location: office.location.trim() || facts.locationSeed,
    reporterName: facts.reporterName,
    reporterPhone: facts.reporterPhone,
    reporterEmail: facts.reporterEmail,
    reportDate: facts.reportDate,
    description: facts.description,
    witnessName: office.witnessName.trim(),
    witnessPhone: office.witnessPhone.trim(),
    witnessEmail: office.witnessEmail.trim(),
    witnessAccount: office.witnessAccount.trim(),
    injuriesImpact: office.injuriesImpact.trim(),
    actionsTaken: office.actionsTaken.trim(),
    receivedBy: office.receivedBy.trim(),
    receivedDate: formatDisplayDate(office.receivedOn),
    actionInvestigation: office.actionRequired === "investigation",
    actionCi: office.actionRequired === "continuous_improvement",
    investigationOutcome: office.investigationOutcome.trim(),
    reportableYes: office.reportable === true,
    reportableNo: office.reportable === false,
    reportableDate: formatDisplayDate(office.reportableOn),
    ndisYes: office.ndisAdvised === true,
    ndisNo: office.ndisAdvised === false,
    ndisDate: formatDisplayDate(office.ndisAdvisedOn),
    report5Day: office.ndisReportType === "5_day",
    report24Hour: office.ndisReportType === "24_hour",
    escalatedTo: office.escalatedTo.trim(),
    escalatedDate: formatDisplayDate(office.escalatedOn),
    other: office.other.trim(),
  };
}

/** Fill location and actions only until office has saved those keys. */
export function seedBoardOffice(
  stored: unknown,
  office: BoardOffice,
  facts: IncidentBoardFacts,
): BoardOffice {
  const raw = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const has = (key: string) => Object.prototype.hasOwnProperty.call(raw, key);
  return {
    ...office,
    location: has("location") ? office.location : office.location || facts.locationSeed,
    actionsTaken: has("actionsTaken") ? office.actionsTaken : office.actionsTaken || facts.actionsSeed,
    otherWhom: has("otherWhom") ? office.otherWhom : office.otherWhom || facts.otherSeed,
  };
}

const HUB_TABLE: Record<BoardHubSource, string> = {
  incident: "operational_incidents",
  maintenance: "maintenance_items",
  day_centre: "site_issues_register",
  event: "site_issues_register",
};

export function siteIssueHubSource(
  eventId?: string | null,
  eventDaySessionId?: string | null,
): "day_centre" | "event" {
  return eventId || eventDaySessionId ? "event" : "day_centre";
}

async function allocateIncidentNumber(): Promise<string> {
  const year = Number(todayLocalIso().slice(0, 4));
  const { data, error } = await supabase.rpc("allocate_incident_number", { p_year: year });
  if (error) throw error;
  const num = String(data ?? "").trim();
  if (!/^IR-\d{4}-\d{3,}$/.test(num)) {
    throw new Error("Incident number was not allocated.");
  }
  return num;
}

async function createBoardReport(input: {
  lane: BoardLane;
  hubSource: BoardHubSource;
  hubRowId: string;
}): Promise<string> {
  const incidentNumber = await allocateIncidentNumber();
  const { error: insErr } = await supabase.from("incident_board_reports").insert({
    incident_number: incidentNumber,
    lane: input.lane,
    hub_source: input.hubSource,
    hub_row_id: input.hubRowId,
    board_office: {},
  });
  if (insErr) throw insErr;
  const { error: stampErr } = await supabase
    .from(HUB_TABLE[input.hubSource])
    .update({ incident_number: incidentNumber })
    .eq("id", input.hubRowId);
  if (stampErr) console.warn("[incident-board] number stamp failed", stampErr);
  return incidentNumber;
}

/**
 * One board paper per Red Button filing (Human, Equipment, or Health & Safety).
 * Returns null when the SQL is not loaded yet — the floor action still stands.
 */
export async function fileBoardReport(input: {
  lane: BoardLane;
  hubSource: BoardHubSource;
  hubRowId: string;
}): Promise<string | null> {
  try {
    return await createBoardReport(input);
  } catch (err) {
    console.warn("[incident-board] file failed", err);
    return null;
  }
}

async function staffContact(reportedBy: string): Promise<{
  phone: string;
  email: string;
}> {
  const key = reportedBy.trim();
  if (!key) return { phone: "", email: "" };

  if (UUID_RE.test(key)) {
    const { data } = await supabase
      .from("staff_registry")
      .select("phone, email")
      .eq("id", key)
      .maybeSingle();
    const row = data as { phone?: string | null; email?: string | null } | null;
    return {
      phone: String(row?.phone ?? "").trim(),
      email: String(row?.email ?? "").trim(),
    };
  }

  const { data } = await supabase
    .from("staff_registry")
    .select("phone, email, full_name")
    .ilike("full_name", key)
    .limit(1);
  const row = (data?.[0] ?? null) as { phone?: string | null; email?: string | null } | null;
  return {
    phone: String(row?.phone ?? "").trim(),
    email: String(row?.email ?? "").trim(),
  };
}

async function participantLines(ids: string[]): Promise<string> {
  if (ids.length === 0) return "";
  const { data } = await supabase
    .from("participants")
    .select("id, first_name, last_name, ndis_number")
    .in("id", ids);
  const people = new Map<string, string>();
  for (const p of (data ?? []) as Array<Record<string, unknown>>) {
    const name = `${String(p.first_name ?? "")} ${String(p.last_name ?? "")}`.trim();
    const ndis = String(p.ndis_number ?? "").trim();
    people.set(String(p.id), ndis ? `${name} (NDIS ${ndis})` : name);
  }
  return ids
    .map((id) => people.get(id))
    .filter((n): n is string => !!n)
    .join("; ");
}

async function staffLines(ids: string[]): Promise<string> {
  if (ids.length === 0) return "";
  const { data } = await supabase.from("staff_registry").select("id, full_name").in("id", ids);
  const names = new Map<string, string>();
  for (const s of (data ?? []) as Array<Record<string, unknown>>) {
    names.set(String(s.id), String(s.full_name ?? "").trim());
  }
  return ids
    .map((id) => names.get(id))
    .filter((n): n is string => !!n)
    .join("; ");
}

function healthSafetyKind(description: string): string {
  if (/INFECTIOUS EXCLUSION/i.test(description)) return "Health & safety — infectious exclusion";
  if (/LIVE EMERGENCY/i.test(description)) return "Health & safety — live emergency";
  if (/DRILL EMERGENCY/i.test(description)) return "Health & safety — drill";
  if (/DO-NOT-OPEN/i.test(description)) return "Health & safety — do not open centre";
  if (/LOCKDOWN/i.test(description)) return "Health & safety — lockdown / early close";
  if (/PROGRAMME SUSPENDED/i.test(description)) return "Health & safety — programme suspended";
  return "Health & safety";
}

async function factsFromHuman(row: Record<string, unknown>, incidentNumber: string): Promise<IncidentBoardFacts> {
  const description = String(row.description ?? "");
  const narrative = splitIncidentNarrative(description);
  const participantIds = Array.isArray(row.affected_participant_ids)
    ? (row.affected_participant_ids as string[])
    : [];
  const staffIds = Array.isArray(row.assisting_staff_ids)
    ? (row.assisting_staff_ids as string[])
    : row.assisting_staff_id
      ? [String(row.assisting_staff_id)]
      : [];
  const [participantLineRaw, workerLineRaw, contact] = await Promise.all([
    participantLines(participantIds),
    staffLines(staffIds),
    staffContact(String(row.reported_by ?? "")),
  ]);
  const participantLine = participantLineRaw || usableLabel(narrative.clientsLabel);
  const workerLine = workerLineRaw || usableLabel(narrative.staffLabel);
  const createdAt = String(row.created_at ?? "");
  const occurredAt = String(row.occurred_at ?? createdAt);
  const eventMatch = description.match(/\[Event:\s*([^·\]]+)/);
  const filedMatch = description.match(/Filed from:\s*([^\]]+)/);
  const locationSeed = eventMatch?.[1]?.trim()
    ? `Event: ${eventMatch[1].trim()}`
    : (filedMatch?.[1]?.trim() ?? "");
  return {
    incidentId: String(row.id),
    incidentNumber,
    participantOn: !!participantLine,
    participantLine,
    workerOn: !!workerLine,
    workerLine,
    otherOn: !participantLine && !workerLine,
    reporterName: hubReporterDisplay(String(row.reported_by ?? ""), description) || "Unknown staff",
    reporterPhone: contact.phone,
    reporterEmail: contact.email,
    incidentDate: formatDisplayDate(occurredAt),
    reportDate: formatDisplayDate(createdAt),
    description: narrative.account,
    actionsSeed: narrative.actionsSeed,
    locationSeed,
    otherSeed: "",
  };
}

async function factsFromAsset(row: Record<string, unknown>, incidentNumber: string): Promise<IncidentBoardFacts> {
  const description = String(row.description ?? "");
  const title = String(row.title ?? "").trim();
  const contact = await staffContact(String(row.reported_by ?? ""));
  const createdAt = String(row.created_at ?? "");
  const occurredAt = String(row.occurred_at ?? createdAt);
  return {
    incidentId: String(row.id),
    incidentNumber,
    participantOn: false,
    participantLine: "",
    workerOn: false,
    workerLine: "",
    otherOn: true,
    reporterName: hubReporterDisplay(String(row.reported_by ?? ""), description) || "Unknown staff",
    reporterPhone: contact.phone,
    reporterEmail: contact.email,
    incidentDate: formatDisplayDate(occurredAt),
    reportDate: formatDisplayDate(createdAt),
    description: title && !description.startsWith(title) ? `${title}\n${description}` : description,
    actionsSeed: "",
    locationSeed: String(row.location_label ?? "").trim(),
    otherSeed: title ? `Equipment / asset fault — ${title}` : "Equipment / asset fault",
  };
}

async function factsFromSiteIssue(row: Record<string, unknown>, incidentNumber: string): Promise<IncidentBoardFacts> {
  const description = String(row.issue_description ?? "");
  const narrative = splitIncidentNarrative(description);
  const contact = await staffContact(String(row.reported_by ?? ""));
  const createdAt = String(row.created_at ?? "");
  const occurredAt = String(row.occurred_at ?? createdAt);
  let participantLine = "";
  if (/INFECTIOUS EXCLUSION/i.test(description)) {
    const { data } = await supabase
      .from("infectious_exclusions")
      .select("participant_id")
      .eq("hub_issue_id", String(row.id))
      .limit(1);
    const pid = String((data?.[0] as { participant_id?: string } | undefined)?.participant_id ?? "");
    if (pid) participantLine = await participantLines([pid]);
  }
  const eventId = String(row.event_id ?? "").trim();
  let locationSeed = eventId ? "Trip" : "Day Centre";
  if (eventId) {
    const { data } = await supabase.from("event_manifest").select("title").eq("id", eventId).maybeSingle();
    const title = String((data as { title?: string } | null)?.title ?? "").trim();
    if (title) locationSeed = `Trip · ${title}`;
  }
  const workaround = String(row.workaround_plan ?? "").trim();
  return {
    incidentId: String(row.id),
    incidentNumber,
    participantOn: !!participantLine,
    participantLine,
    workerOn: false,
    workerLine: "",
    otherOn: !participantLine,
    reporterName: hubReporterDisplay(String(row.reported_by ?? ""), description) || "Unknown staff",
    reporterPhone: contact.phone,
    reporterEmail: contact.email,
    incidentDate: formatDisplayDate(occurredAt),
    reportDate: formatDisplayDate(createdAt),
    description: narrative.account || description,
    actionsSeed: workaround,
    locationSeed,
    otherSeed: participantLine ? "" : healthSafetyKind(description),
  };
}

async function ensureBoardReport(
  hubSource: BoardHubSource,
  hubRowId: string,
): Promise<{ incidentNumber: string; lane: BoardLane; boardOffice: unknown }> {
  const { data, error } = await supabase
    .from("incident_board_reports")
    .select("incident_number, lane, board_office")
    .eq("hub_source", hubSource)
    .eq("hub_row_id", hubRowId)
    .maybeSingle();
  if (error) throw error;
  const existing = data as { incident_number?: string; lane?: string; board_office?: unknown } | null;
  if (existing?.incident_number) {
    const lane = existing.lane;
    return {
      incidentNumber: String(existing.incident_number),
      lane: lane === "asset" || lane === "health_safety" ? lane : "human",
      boardOffice: existing.board_office,
    };
  }
  const lane: BoardLane =
    hubSource === "maintenance" ? "asset" : hubSource === "incident" ? "human" : "health_safety";
  const incidentNumber = await createBoardReport({ lane, hubSource, hubRowId });
  return { incidentNumber, lane, boardOffice: {} };
}

export async function loadIncidentBoard(ref: {
  hubSource: BoardHubSource;
  hubRowId: string;
}): Promise<{ facts: IncidentBoardFacts; office: BoardOffice }> {
  const report = await ensureBoardReport(ref.hubSource, ref.hubRowId);
  const { data, error } = await supabase
    .from(HUB_TABLE[ref.hubSource])
    .select("*")
    .eq("id", ref.hubRowId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Incident not found.");
  const row = data as Record<string, unknown>;
  const facts =
    ref.hubSource === "maintenance"
      ? await factsFromAsset(row, report.incidentNumber)
      : ref.hubSource === "incident"
        ? await factsFromHuman(row, report.incidentNumber)
        : await factsFromSiteIssue(row, report.incidentNumber);
  return {
    facts,
    office: seedBoardOffice(report.boardOffice, parseBoardOffice(report.boardOffice), facts),
  };
}

export async function saveIncidentBoardOffice(
  hubRowId: string,
  incidentNumber: string,
  before: BoardOffice,
  after: BoardOffice,
): Promise<void> {
  const { error } = await supabase
    .from("incident_board_reports")
    .update({ board_office: after })
    .eq("hub_row_id", hubRowId);
  if (error) throw error;
  void recordOfficeChangeBestEffort({
    action: "updated",
    entity: "incident",
    recordId: hubRowId,
    recordName: incidentNumber,
    summary: `Updated board incident report ${incidentNumber}`,
    before: { ...before },
    after: { ...after },
  });
}
