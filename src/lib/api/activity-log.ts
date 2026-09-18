/**
 * Read-only Activity log — human view of operational_ledger (GUARDRAILS §1.1)
 * plus meal-serve and medication-dose receipts that live on their own tables.
 * Admin browser + Run Planning slice. Append-only; never update/delete.
 */
import { supabase } from "@/integrations/supabase/client";
import type { LedgerCategory, LedgerEntry, LedgerSeverity } from "@/lib/api/ledger";
import {
  DEFAULT_STAFF_UUID,
  primeStaffDisplayNames,
  resolveStaffDisplayName,
} from "@/lib/data-store";
import { parseIsoDateLocal } from "@/lib/utils";

export const ACTIVITY_LOG_KEY = ["activity-log"] as const;
export const ACTIVITY_LOG_LIMIT = 2000;

export const ACTIVITY_AREAS = [
  { id: "all", label: "All types" },
  { id: "planning", label: "Run planning" },
  { id: "people", label: "People / records" },
  { id: "centre", label: "Day Centre" },
  { id: "transport", label: "Transport / bus" },
  { id: "trip", label: "Trips" },
  { id: "vehicle", label: "Vehicles" },
  { id: "governance", label: "Issues / emergency" },
  { id: "admin", label: "Admin / settings" },
] as const;

export type ActivityAreaId = (typeof ACTIVITY_AREAS)[number]["id"];

export interface ActivityLogRow {
  id: string;
  createdAt: string;
  actorName: string;
  area: Exclude<ActivityAreaId, "all">;
  areaLabel: string;
  actionType: string;
  actionLabel: string;
  summary: string;
  location: string;
  why: string;
  gpsLabel: string;
  category: LedgerCategory;
  severity: LedgerSeverity;
}

type SupportRowHint = {
  personName: string;
  personKind: string | null;
  arrivalMethod: string | null;
  arrivalBusRunCode: string | null;
  departureVector: string | null;
  departureBusRunCode: string | null;
};

type TripHint = {
  busRunCode: string | null;
  tripDate: string | null;
  eventId: string | null;
  tripKind: string | null;
  tripReturn: string | null;
};

type SessionHint = {
  eventId: string | null;
  sessionDate: string | null;
};

export type ActivityLookups = {
  participants: Map<string, string>;
  staff: Map<string, string>;
  carers: Map<string, string>;
  people: Map<string, string>;
  supportRows: Map<string, SupportRowHint>;
  eventSupportRows: Map<string, SupportRowHint>;
  events: Map<string, string>;
  activities: Map<string, string>;
  trips: Map<string, TripHint>;
  sessions: Map<string, SessionHint>;
  tripPassengers: Map<string, string[]>;
};

function emptyLookups(): ActivityLookups {
  return {
    participants: new Map(),
    staff: new Map(),
    carers: new Map(),
    people: new Map(),
    supportRows: new Map(),
    eventSupportRows: new Map(),
    events: new Map(),
    activities: new Map(),
    trips: new Map(),
    sessions: new Map(),
    tripPassengers: new Map(),
  };
}

function localDayBoundIso(dateIso: string, endOfDay: boolean): string {
  const d = parseIsoDateLocal(dateIso);
  if (!d) {
    return endOfDay ? `${dateIso}T23:59:59.999Z` : `${dateIso}T00:00:00.000Z`;
  }
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function metaString(
  meta: Record<string, unknown> | null | undefined,
  ...keys: string[]
): string | null {
  if (!meta) return null;
  for (const key of keys) {
    const v = meta[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function titleAction(action: string): string {
  return action
    .replace(/[._]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const ACTION_LABELS: Record<string, string> = {
  OFFICE_RECORD_CHANGED: "Record change",
  RUN_PLANNING_CHANGED: "Run planning change",
  ATTENDANCE_SCHEDULE_REMOVED: "Attendance schedule removed",
  ATTENDANCE_CHECKIN: "Check-in",
  ATTENDANCE_CHECKIN_UNDO: "Check-in undone",
  ATTENDANCE_CHECKOUT: "Check-out",
  ATTENDANCE_ARRIVAL_METHOD: "Arrival method",
  SUPPORT_CHECKIN: "Support check-in",
  SUPPORT_CHECKOUT: "Support check-out",
  SUPPORT_ABSENT: "Support absent",
  CENTRE_CLOSED: "Centre closed",
  CENTRE_HOURS_UPDATED: "Centre hours updated",
  TRANSPORT_RUN_CLOSED: "Transport run closed",
  TRANSPORT_PICKUP_CANCELLED: "Pickup cancelled",
  RETURN_BOARDING_CONFIRMED: "Return boarding confirmed",
  EVENT_LOCATION_OPENED: "Trip location opened",
  EVENT_LOCATION_CLOSED_ORDERLY: "Trip location closed",
  EVENT_LOCATION_CLOSED_INCIDENT: "Trip location closed (incident)",
  EVENT_RESET_START_OF_DAY: "Trip day reset",
  SYSTEM_PARAMETER_UPDATED: "System parameter updated",
  AUDIT_PACK_EXPORTED: "NDIS Audit Pack exported",
  EVENT_FLOOR_CHECKIN: "Trip check-in",
  EVENT_FLOOR_CHECKIN_UNDO: "Trip check-in undone",
  EVENT_FLOOR_CHECKOUT: "Trip check-out",
  EVENT_FLOOR_ABSENT: "Left trip",
  EVENT_FLOOR_ARRIVAL_METHOD: "Trip arrival method",
  EVENT_SUPPORT_CHECKIN: "Trip support check-in",
  EVENT_SUPPORT_CHECKOUT: "Trip support check-out",
  ACTIVITY_OPEN: "Activity opened",
  ACTIVITY_CLOSE: "Activity closed",
  EVENT_MEAL_OPENED: "Trip meal opened",
  MEAL_SERVED: "Meal service",
  EVENT_MEAL_SERVED: "Trip meal service",
  SITE_DAY_ACTIVITY_OPENED: "Activity opened",
  SITE_DAY_ACTIVITY_COMPLETED: "Activity completed",
  SITE_DAY_VISITOR_ARRIVED: "Visitor arrived",
  SITE_DAY_VISITOR_LEFT: "Visitor left",
  MEDICATION_ADMINISTERED: "Medication given",
  MEDICATION_ADMIN: "Medication given",
  MEDICATION_ADMIN_QUICK: "Medication given",
  MEDICATION_ADMIN_DUAL: "Medication given",
  MEDICATION_ADMIN_SOLE: "Medication given",
  MEDICATION_REFUSED: "Medication refused",
  MEDICATION_MISSED_BYPASS: "Medication missed",
  COMPLIANCE_ASSET_INSERT: "Compliance asset added",
  COMPLIANCE_ASSET_UPDATE: "Compliance asset updated",
  COMPLIANCE_ASSET_DELETE: "Compliance asset removed",
  EMERGENCY_ACTIVATED: "Emergency activated",
  EMERGENCY_STOOD_DOWN: "Emergency stood down",
  "site_day.open": "Centre opened",
  "site_day.initialize": "Centre session started",
  "site_day.issue_logged": "Issue logged",
  "governance.issue_resolved": "Issue closed",
  "governance.issue_deferred": "Issue deferred",
  "governance.issue_noted": "Log Now",
  "governance.council_escalated": "Escalated to Council",
  SUPPORT_ATTENDANCE_YELLOW_RAISED: "Yellow raised",
  SUPPORT_ATTENDANCE_RED_ESCALATED: "Red escalated",
  ATTENDANCE_YELLOW_RAISED: "Yellow raised",
  ATTENDANCE_RED_ESCALATED: "Red escalated",
  ATTENDANCE_DEPARTURE_YELLOW_RAISED: "Yellow raised",
  ATTENDANCE_DEPARTURE_RED_ESCALATED: "Red escalated",
  DUTY_REQUIREMENT_GAP_APPROVED: "Duty gap approved",
  VEHICLE_MAINTENANCE_RESOLVED: "Vehicle update",
  VEHICLE_FORMAL_AUDIT: "Vehicle audit",
  VEHICLE_RELEASED: "Vehicle released",
  SITE_DO_NOT_OPEN: "Centre not opened",
  SITE_LOCKDOWN_DECLARED: "Lockdown declared",
  SITE_LOCKDOWN_CLEARED: "Lockdown cleared",
  PROGRAMME_SUSPENDED: "Programme suspended",
  PROGRAMME_SUSPEND_CLEARED: "Programme resumed",
  "site_day.close": "Centre closed",
  "site_day.centre_reopened": "Centre reopened",
  CURFEW_ACCOUNTED: "Evening roll accounted",
  MORNING_ROLL_ACCOUNTED: "Morning roll accounted",
  CURFEW_UNACCOUNTED: "Evening roll undone",
  MORNING_ROLL_UNACCOUNTED: "Morning roll undone",
  CURFEW_ABSENT_CONFIRMED: "Evening roll absent",
  MORNING_ROLL_ABSENT: "Morning roll absent",
  CURFEW_REINSTATE: "Evening roll reinstated",
  MORNING_ROLL_REINSTATE: "Morning roll reinstated",
  CURFEW_ROLL_RED_DEFERRED: "Evening roll deferred",
  CURFEW_ROLL_YELLOW_DEFERRED: "Evening roll deferred",
  MORNING_ROLL_RED_DEFERRED: "Morning roll deferred",
  MORNING_ROLL_YELLOW_DEFERRED: "Morning roll deferred",
  CURFEW_RED_AUTO_RAISED: "Evening roll Red",
  CURFEW_YELLOW_RAISED: "Evening roll Yellow",
  MORNING_ROLL_RED_AUTO_RAISED: "Morning roll Red",
  MORNING_ROLL_YELLOW_RAISED: "Morning roll Yellow",
  EVENT_HOP_PREPARED: "Hop prepared",
  EVENT_HOP_STARTED: "Hop started",
  ACTIVITY_SKIP: "Activity skip",
  MED_BAG_HANDOVER: "Med bag handover",
  UNEXPECTED_MED_BAG_FLAGGED: "Unexpected med bag",
  "health.infectious_exclusion_declared": "Infectious exclusion",
  "health.infectious_exclusion_cleared": "Infectious exclusion cleared",
  ATTENDANCE_BULK_DEFER: "Arrival deferred",
  ATTENDANCE_YELLOW_AUTO_CLOSED: "Yellow cleared",
  ATTENDANCE_DEPARTURE_YELLOW_AUTO_CLOSED: "Yellow cleared",
  ATTENDANCE_ACCOUNTED: "Accounted",
};

const PEOPLE_ENTITIES = new Set([
  "client",
  "staff",
  "carer",
  "guest",
  "medication",
  "onboarding",
]);

export function classifyActivityArea(
  actionType: string,
  category: LedgerCategory,
  metadata?: Record<string, unknown> | null,
): Exclude<ActivityAreaId, "all"> {
  const a = actionType.toUpperCase();
  if (a === "OFFICE_RECORD_CHANGED") {
    const entity = String(metadata?.entity ?? "").toLowerCase();
    if (entity === "fleet" || entity === "vehicle") return "vehicle";
    if (
      entity === "event" ||
      entity === "booking" ||
      entity === "itinerary" ||
      entity === "trip_expense"
    ) {
      return "trip";
    }
    if (entity === "transport_request") return "transport";
    if (PEOPLE_ENTITIES.has(entity)) return "people";
    return "admin";
  }
  if (a.startsWith("COMPLIANCE_ASSET")) return "admin";
  if (a.includes("MEDICATION") || a.includes("MED_ADMIN")) return "people";
  if (
    a.includes("GUEST_PARTICIPANT") ||
    a.includes("WALK_ON_GUEST") ||
    a.includes("GUEST_BOOKING")
  ) {
    return "people";
  }
  if (a.includes("RUN_PLANNING") || a.includes("ATTENDANCE_SCHEDULE")) return "planning";
  if (
    a.startsWith("TRANSPORT") ||
    a.includes("BOARDING") ||
    a.includes("MED_BAG") ||
    a.includes("PICKUP") ||
    a.includes("ODOMETER")
  ) {
    return "transport";
  }
  if (
    a.startsWith("GOVERNANCE") ||
    a.startsWith("HEALTH") ||
    a.includes("EMERGENCY") ||
    a.includes("LOCKDOWN") ||
    a.includes("DO_NOT_OPEN") ||
    a.includes("PROGRAMME_SUSPEND") ||
    a.includes("RED_") ||
    a.includes("ISSUE_") ||
    a.includes("COUNCIL")
  ) {
    return "governance";
  }
  if (
    a.includes("SYSTEM_PARAMETER") ||
    a.includes("AUDIT_PACK") ||
    a.includes("MYOB") ||
    a.includes("VENUE_") ||
    a.includes("CENTRE_HOURS") ||
    a.includes("CERTIFICATION")
  ) {
    return "admin";
  }
  if (
    category === "VEHICLE" ||
    a.startsWith("VEHICLE_") ||
    a === "DUTY_REQUIREMENT_GAP_APPROVED"
  ) {
    const fn = String(metadata?.function_key ?? "").toLowerCase();
    if (a === "DUTY_REQUIREMENT_GAP_APPROVED" && fn && fn !== "fleet_drive") {
      return "centre";
    }
    return "vehicle";
  }
  if (category === "TRIP" || a.startsWith("EVENT_") || a.startsWith("ACTIVITY_")) return "trip";
  return "centre";
}

function howPhrase(
  method?: string | null,
  runCode?: string | null,
  vector?: string | null,
): string {
  const raw = (vector || method || "").trim().toLowerCase();
  const run = (runCode ?? "").trim();
  if (raw === "bus") return run ? `via Bus (${run})` : "via Bus";
  if (raw === "private" || raw === "self") return "via Self";
  if (raw === "walk_in") return "via Walk-in";
  if (raw === "family") return "via Family / carer";
  if (raw === "independent") return "via Independent";
  if (raw === "other") return "via Other";
  if (raw) return `via ${raw.replace(/_/g, " ")}`;
  return "";
}

function joinParts(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

function personFromMeta(
  meta: Record<string, unknown>,
  lookups: ActivityLookups,
): string | null {
  const named = metaString(
    meta,
    "person_name",
    "displayName",
    "display_name",
    "participant_name",
    "full_name",
    "client_name",
    "support_name",
  );
  if (named) return named;
  const participantId = metaString(meta, "participant_id");
  if (participantId) {
    return (
      lookups.participants.get(participantId) ||
      lookups.people.get(participantId) ||
      null
    );
  }
  const rowId = metaString(meta, "row_id", "attendance_id");
  if (rowId) {
    const support = lookups.supportRows.get(rowId) ?? lookups.eventSupportRows.get(rowId);
    if (support?.personName) return support.personName;
  }
  return null;
}

function locationFromAction(
  actionType: string,
  meta: Record<string, unknown>,
  lookups: ActivityLookups,
  category?: LedgerCategory,
): string {
  const explicit = metaString(meta, "location", "venue_name", "place");
  if (explicit && explicit !== "trip") return explicit;
  const eventId =
    metaString(meta, "event_id") ||
    lookups.sessions.get(metaString(meta, "event_day_session_id", "session_id") ?? "")
      ?.eventId ||
    lookups.trips.get(metaString(meta, "trip_id") ?? "")?.eventId ||
    null;
  const eventName = eventId ? lookups.events.get(eventId) : null;
  const surface = (metaString(meta, "surface") ?? "").toLowerCase();
  if (surface === "trip" || surface === "event") {
    return eventName || "trip";
  }
  if (surface === "centre" || surface === "day_centre") return "Day Centre";
  const a = actionType.toUpperCase();
  const raw = actionType.toLowerCase();
  if (
    raw.startsWith("site_day.") ||
    a.includes("CENTRE_CLOSED") ||
    a.includes("CENTRE_HOURS") ||
    a.includes("LOCKDOWN") ||
    a.includes("DO_NOT_OPEN") ||
    a.startsWith("SUPPORT_") ||
    a.startsWith("ATTENDANCE_") ||
    a.startsWith("SITE_DAY_")
  ) {
    return "Day Centre";
  }
  if (a.includes("PROGRAMME_SUSPEND") || a.includes("CURFEW") || a.includes("MORNING_ROLL")) {
    return eventName || "trip";
  }
  if (a.startsWith("GOVERNANCE") || a.includes("ISSUE_") || a.includes("COUNCIL") || raw === "site_day.issue_logged") {
    const src = (metaString(meta, "source") ?? "").toLowerCase();
    if (src === "event" || src === "trip") return eventName || "trip";
    if (src === "renewal" || src === "vehicle" || src === "escalation") return "vehicle";
    return "Day Centre";
  }
  if (a.includes("EMERGENCY")) {
    return eventName || (category === "TRIP" ? "trip" : "Day Centre");
  }
  if (a.startsWith("EVENT_") || a.startsWith("ACTIVITY_") || a.includes("TRIP") || a.includes("HOP")) {
    return eventName || "trip";
  }
  if (a.includes("MED_BAG")) {
    return eventName || (surface === "transport" || category === "TRIP" ? "trip" : "Day Centre");
  }
  if (raw.startsWith("health.")) {
    return eventName || (category === "TRIP" ? "trip" : "Day Centre");
  }
  if (a === "OFFICE_RECORD_CHANGED" || a.includes("SYSTEM_PARAMETER") || a.includes("AUDIT_PACK")) {
    return "Office";
  }
  if (category === "VEHICLE" || a.startsWith("VEHICLE_")) {
    return (
      metaString(meta, "vehicle_info", "asset_name", "name") ||
      metaString(meta, "rego_plate") ||
      "vehicle"
    );
  }
  if (category === "TRIP") return eventName || "trip";
  if (category === "CENTRE" || category === "CLIENT") return "Day Centre";
  return eventName ?? "";
}

function complianceAssetFromMeta(meta: Record<string, unknown>): {
  name: string | null;
  type: string | null;
  category: string | null;
  subject: string | null;
  createdBy: string | null;
} {
  const after = asRecord(meta.after) ?? asRecord(meta.before) ?? meta;
  const name = metaString(after, "name", "asset_name") ?? metaString(meta, "asset_name", "name");
  const type = metaString(after, "type") ?? metaString(meta, "asset_type", "type");
  const category = metaString(after, "category") ?? metaString(meta, "asset_category", "category");
  const subjectTable =
    metaString(after, "subject_table") ?? metaString(meta, "subject_table");
  const subjectId = metaString(after, "subject_id") ?? metaString(meta, "subject_id");
  const subject = subjectTable
    ? subjectId
      ? `${subjectTable.replace(/_/g, " ")} ${subjectId.slice(0, 8)}`
      : subjectTable.replace(/_/g, " ")
    : null;
  const createdBy =
    metaString(after, "created_by") ?? metaString(meta, "created_by");
  return { name, type, category, subject, createdBy };
}

function composeAttendanceSummary(
  actionType: string,
  actionLabel: string,
  meta: Record<string, unknown>,
  lookups: ActivityLookups,
): string | null {
  const a = actionType.toUpperCase();
  const isCheckIn =
    a.includes("CHECKIN") && !a.includes("UNDO") && !a.includes("CHECKOUT");
  const isCheckOut = a.includes("CHECKOUT");
  const isUndo = a.includes("UNDO");
  const isAbsent = a.includes("ABSENT");
  if (!isCheckIn && !isCheckOut && !isUndo && !isAbsent && !a.includes("ARRIVAL_METHOD")) {
    return null;
  }
  const rowId = metaString(meta, "row_id", "attendance_id");
  const support = rowId
    ? lookups.supportRows.get(rowId) ?? lookups.eventSupportRows.get(rowId)
    : undefined;
  const person =
    personFromMeta(meta, lookups) ||
    (a.startsWith("EVENT_FLOOR") || a.startsWith("ATTENDANCE_") ? "a client" : null);
  if (!person) return null;
  const place = locationFromAction(actionType, meta, lookups) || "Day Centre";
  const how = howPhrase(
    metaString(meta, "arrival_method") ?? support?.arrivalMethod,
    metaString(meta, "arrival_bus_run_code") ?? support?.arrivalBusRunCode,
    metaString(meta, "departure_vector", "return_transport") ?? support?.departureVector,
  );
  const role =
    a.includes("SUPPORT") && support?.personKind
      ? ` (${support.personKind})`
      : a.includes("SUPPORT")
        ? " (support)"
        : "";
  if (isUndo) return joinParts([`Undid check-in for ${person}${role}`, `at ${place}`]);
  if (isAbsent) {
    const reason = metaString(meta, "reason");
    return joinParts([
      `Marked ${person}${role} absent`,
      `from ${place}`,
      reason ? `(${reason})` : null,
    ]);
  }
  if (isCheckOut) {
    const outHow = howPhrase(
      null,
      metaString(meta, "departure_bus_run_code", "return_bus_run_code") ??
        support?.departureBusRunCode,
      metaString(meta, "departure_vector", "return_transport") ?? support?.departureVector,
    );
    return joinParts([`Checked out ${person}${role}`, `from ${place}`, outHow]);
  }
  if (a.includes("ARRIVAL_METHOD")) {
    return joinParts([`Set arrival for ${person}${role}`, `at ${place}`, how]);
  }
  return joinParts([`Checked in ${person}${role}`, `to ${place}`, how]) || actionLabel;
}

function composeComplianceSummary(actionType: string, meta: Record<string, unknown>): string {
  const op = actionType.replace(/^COMPLIANCE_ASSET_/i, "").toUpperCase();
  const verb =
    op === "INSERT" ? "Added" : op === "DELETE" ? "Removed" : "Updated";
  const asset = complianceAssetFromMeta(meta);
  const label = asset.name ? `“${asset.name}”` : "compliance asset";
  const kind = [asset.type, asset.category].filter(Boolean).join(", ");
  const bits = [`${verb} compliance asset ${label}`];
  if (kind) bits.push(`(${kind})`);
  if (asset.subject) bits.push(`— ${asset.subject}`);
  return bits.join(" ");
}

function composeMealOpenSummary(
  actionType: string,
  meta: Record<string, unknown>,
  lookups: ActivityLookups,
): string | null {
  const a = actionType.toUpperCase();
  if (a !== "SITE_DAY_ACTIVITY_OPENED" && a !== "SITE_DAY_ACTIVITY_COMPLETED" && a !== "EVENT_MEAL_OPENED") {
    return null;
  }
  const title =
    metaString(meta, "title", "meal_title") ||
    lookups.activities.get(metaString(meta, "activity_id") ?? "") ||
    "activity";
  const source = metaString(meta, "meal_source");
  const sourceLabel = source ? source.replace(/_/g, " ") : null;
  const place = locationFromAction(actionType, meta, lookups);
  if (a === "SITE_DAY_ACTIVITY_COMPLETED") {
    return joinParts([`Completed ${title}`, place ? `at ${place}` : null]);
  }
  if (a === "EVENT_MEAL_OPENED") {
    return joinParts([
      `Opened trip meal ${title}`,
      sourceLabel ? `(${sourceLabel})` : null,
    ]);
  }
  return joinParts([
    `Opened ${title}`,
    place ? `at ${place}` : null,
    sourceLabel ? `(${sourceLabel})` : null,
  ]);
}

const RUN_KIND_LABEL: Record<string, string> = {
  event_outbound: "trip outbound",
  event_return: "trip return home",
  event_venue_hop: "venue hop",
  day_centre_morning: "Day Centre morning",
  day_centre_afternoon: "Day Centre afternoon",
  event_legacy: "trip",
};

function listNames(names: string[], max = 10): string {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (unique.length === 0) return "";
  if (unique.length <= max) return unique.join(", ");
  return `${unique.slice(0, max).join(", ")} +${unique.length - max} more`;
}

function labelsFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) out.push(item.trim());
    const rec = asRecord(item);
    const label = rec
      ? metaString(rec, "label", "name", "to_label", "person_name", "participant_name", "display_name")
      : null;
    if (label) out.push(label);
  }
  return out;
}

function metaIdList(meta: Record<string, unknown>, ...keys: string[]): string[] {
  const ids: string[] = [];
  for (const key of keys) {
    const v = meta[key];
    if (typeof v === "string" && v.trim()) ids.push(v.trim());
    if (!Array.isArray(v)) continue;
    for (const item of v) {
      if (typeof item === "string" && item.trim()) ids.push(item.trim());
      const rec = asRecord(item);
      const id = rec ? metaString(rec, "id", "participant_id", "staff_id", "carer_id") : null;
      if (id) ids.push(id);
    }
  }
  return uniqueIds(ids);
}

function peopleNames(ids: string[], lookups: ActivityLookups): string[] {
  return ids
    .map(
      (id) =>
        lookups.people.get(id) ||
        lookups.participants.get(id) ||
        lookups.staff.get(id) ||
        lookups.carers.get(id) ||
        "",
    )
    .filter(Boolean);
}

function tripRunPhrase(meta: Record<string, unknown>, lookups: ActivityLookups): string {
  const tripId = metaString(meta, "trip_id");
  const trip = tripId ? lookups.trips.get(tripId) : undefined;
  const code =
    metaString(meta, "bus_run_code") || trip?.busRunCode || null;
  const kind =
    metaString(meta, "run_kind", "trip_kind") || trip?.tripKind || null;
  const kindLabel = kind ? RUN_KIND_LABEL[kind] || kind.replace(/_/g, " ") : null;
  const isAfternoon =
    kind === "day_centre_afternoon" ||
    kind === "event_return" ||
    trip?.tripReturn === "depot" ||
    trip?.tripReturn === "day_centre";
  const isMorning =
    kind === "day_centre_morning" ||
    kind === "event_outbound" ||
    trip?.tripReturn === "none";
  const when = kindLabel
    ? kindLabel
    : isAfternoon
      ? "afternoon"
      : isMorning
        ? "morning"
        : null;
  if (code && when) return `${when} ${code}`;
  if (code) return code;
  if (when) return when;
  return "";
}

function composeTransportSummary(
  actionType: string,
  meta: Record<string, unknown>,
  lookups: ActivityLookups,
): string | null {
  const a = actionType.toUpperCase();
  const tripId = metaString(meta, "trip_id");
  const run = tripRunPhrase(meta, lookups);
  const eventName = locationFromAction(actionType, meta, lookups);
  const fromTrip = tripId ? lookups.tripPassengers.get(tripId) ?? [] : [];
  const fromIds = peopleNames(metaIdList(meta, "passenger_ids", "participant_ids"), lookups);
  const passengers = fromIds.length > 0 ? fromIds : fromTrip;
  const cancelled = labelsFromUnknown(meta.cancelled_pickups);
  const noShows = labelsFromUnknown(meta.no_show_legs);
  const count =
    typeof meta.passenger_count === "number"
      ? meta.passenger_count
      : typeof meta.legs_completed === "number"
        ? meta.legs_completed
        : passengers.length || null;
  const kmText =
    typeof meta.total_km === "number" && Number.isFinite(meta.total_km)
      ? `${Math.round(Number(meta.total_km) * 10) / 10} km`
      : null;

  if (a === "TRANSPORT_RUN_CLOSED") {
    const who =
      passengers.length > 0
        ? isAfternoonRun(meta, lookups)
          ? `dropped off ${listNames(passengers)}`
          : `picked up ${listNames(passengers)}`
        : count
          ? `${count} stop${count === 1 ? "" : "s"} complete`
          : null;
    const extra = [
      cancelled.length ? `not travelling: ${listNames(cancelled, 6)}` : null,
      noShows.length ? `no-show: ${listNames(noShows, 6)}` : null,
      kmText,
    ].filter(Boolean);
    return joinParts([
      `Closed ${run || "transport run"}`,
      eventName && eventName !== "trip" ? `(${eventName})` : null,
      who ? `— ${who}` : null,
      extra.length ? `(${extra.join("; ")})` : null,
    ]);
  }

  if (a === "RETURN_BOARDING_CONFIRMED") {
    const who = passengers.length > 0 ? listNames(passengers) : null;
    return joinParts([
      `Confirmed return boarding`,
      run ? `on ${run}` : null,
      eventName && eventName !== "trip" ? `(${eventName})` : null,
      who
        ? `— ${who} (${passengers.length} people all aboard)`
        : count
          ? `— ${count} people all aboard`
          : null,
    ]);
  }

  if (a.includes("PICKUP") && a.includes("CANCEL")) {
    const person = personFromMeta(meta, lookups) || listNames(cancelled, 4) || "passenger";
    return joinParts([`Cancelled pickup for ${person}`, run ? `on ${run}` : null]);
  }

  if (a === "TRANSPORT_ODOMETER_CORRECTED") {
    return joinParts([
      `Corrected odometer`,
      run ? `on ${run}` : null,
      metaString(meta, "summary", "description"),
    ]);
  }

  return null;
}

function isAfternoonRun(meta: Record<string, unknown>, lookups: ActivityLookups): boolean {
  const kind = metaString(meta, "run_kind", "trip_kind");
  if (kind === "day_centre_afternoon" || kind === "event_return") return true;
  if (kind === "day_centre_morning" || kind === "event_outbound") return false;
  const trip = lookups.trips.get(metaString(meta, "trip_id") ?? "");
  return trip?.tripReturn === "depot" || trip?.tripReturn === "day_centre";
}

function composeEventOpsSummary(
  actionType: string,
  meta: Record<string, unknown>,
  lookups: ActivityLookups,
): string | null {
  const a = actionType.toUpperCase();
  const eventName = locationFromAction(actionType, meta, lookups);
  const date =
    metaString(meta, "session_date") ||
    lookups.sessions.get(metaString(meta, "event_day_session_id", "session_id") ?? "")
      ?.sessionDate ||
    lookups.trips.get(metaString(meta, "trip_id") ?? "")?.tripDate ||
    null;
  const where = eventName && eventName !== "trip" ? eventName : "trip";
  if (a === "EVENT_LOCATION_OPENED") {
    return joinParts([`Opened trip location`, `for ${where}`, date ? `on ${date}` : null]);
  }
  if (a === "EVENT_LOCATION_CLOSED_ORDERLY") {
    return joinParts([`Closed trip location`, `for ${where}`, date ? `on ${date}` : null]);
  }
  if (a === "EVENT_LOCATION_CLOSED_INCIDENT") {
    return joinParts([
      `Closed trip location after incident`,
      `for ${where}`,
      date ? `on ${date}` : null,
    ]);
  }
  if (a === "EVENT_RESET_START_OF_DAY") {
    const trips = meta.trips_deleted;
    const n = typeof trips === "number" ? trips : null;
    return joinParts([
      `Reset start of day`,
      `for ${where}`,
      date ? `on ${date}` : null,
      n != null ? `(cleared ${n} trip${n === 1 ? "" : "s"})` : null,
      meta.test_only === true ? "— test rewind" : null,
    ]);
  }
  if (a.startsWith("EVENT_") || a.startsWith("ACTIVITY_")) {
    return null;
  }
  return null;
}

function quotedTitle(value: string | null | undefined): string | null {
  const t = (value ?? "").trim();
  if (!t) return null;
  const clipped = t.length > 140 ? `${t.slice(0, 137)}…` : t;
  return `“${clipped}”`;
}

function issueTitleFromMeta(meta: Record<string, unknown>): string | null {
  return (
    metaString(meta, "title", "issue_title", "asset_name") ||
    metaString(meta, "description", "issue_description") ||
    metaString(meta, "resolution_summary")
  );
}

function minutesPhrase(meta: Record<string, unknown>): string | null {
  const n = meta.overdue_mins;
  if (typeof n === "number" && Number.isFinite(n)) return `overdue ${Math.round(n)} min`;
  if (typeof n === "string" && n.trim() && Number.isFinite(Number(n))) {
    return `overdue ${Math.round(Number(n))} min`;
  }
  return null;
}

function composeEscalationSummary(
  actionType: string,
  meta: Record<string, unknown>,
  lookups: ActivityLookups,
): string | null {
  const a = actionType.toUpperCase();
  if (!a.includes("YELLOW_RAISED") && !a.includes("RED_ESCALATED")) return null;
  const person = personFromMeta(meta, lookups);
  const kind = metaString(meta, "person_kind");
  const role =
    a.includes("SUPPORT") && kind
      ? ` (${kind})`
      : a.includes("SUPPORT")
        ? " (support)"
        : "";
  const who = person ? `${person}${role}` : a.includes("SUPPORT") ? "Support person" : "Client";
  const late = minutesPhrase(meta);
  const isRed = a.includes("RED_ESCALATED");
  const isDepart = a.includes("DEPARTURE");
  if (isDepart) {
    return joinParts([
      isRed ? `${who} still not checked out of Day Centre` : `${who} not checked out of Day Centre`,
      late,
      isRed ? "— escalated to Red" : "(Yellow)",
    ]);
  }
  return joinParts([
    isRed ? `${who} still not arrived at Day Centre` : `${who} not arrived at Day Centre`,
    late,
    isRed ? "— escalated to Red" : "(Yellow)",
  ]);
}

function composeDutyGapSummary(meta: Record<string, unknown>): string | null {
  const subject = metaString(meta, "subject", "subject_label");
  const staff = metaString(meta, "acting_staff_name", "staff_name");
  const gap = metaString(meta, "gap", "missing_summary");
  const note = metaString(meta, "note");
  if (!subject && !gap && !staff) return null;
  return joinParts([
    `Manager approved duty gap`,
    subject ? `for ${subject}` : null,
    staff ? `— ${staff}` : null,
    gap ? `missing ${gap}` : null,
    note ? `(${note})` : null,
  ]);
}

function composeVehicleOpsSummary(
  actionType: string,
  meta: Record<string, unknown>,
): string | null {
  const a = actionType.toUpperCase();
  const asset =
    metaString(meta, "vehicle_info") ||
    joinParts([
      metaString(meta, "asset_name", "name"),
      metaString(meta, "rego_plate", "regoPlate")
        ? `(${metaString(meta, "rego_plate", "regoPlate")})`
        : null,
    ]);
  if (a === "DUTY_REQUIREMENT_GAP_APPROVED") return composeDutyGapSummary(meta);
  if (a === "VEHICLE_RELEASED") {
    const driver = metaString(meta, "driver_name");
    const notes = metaString(meta, "clearance_notes", "resolution_notes");
    return joinParts([
      `Released ${asset || "vehicle"} back to service`,
      driver ? `(driver ${driver})` : null,
      notes ? `— ${notes}` : null,
    ]);
  }
  if (a === "VEHICLE_FORMAL_AUDIT") {
    const fail = meta.checklist_any_fail === true;
    return joinParts([
      `Formal audit for ${asset || "vehicle"}`,
      fail ? "— faults recorded" : "— cleared",
    ]);
  }
  if (a !== "VEHICLE_MAINTENANCE_RESOLVED") return null;
  const kind = metaString(meta, "flag_kind") || "rego";
  const type = metaString(meta, "resolution_type");
  const vehicle = asset || "vehicle";
  if (type === "renewed") {
    const expiry = metaString(meta, "new_expiry_date", "new_value");
    return joinParts([`Rego renewed for ${vehicle}`, expiry ? `— expiry now ${expiry}` : null]);
  }
  if (type === "serviced") {
    return joinParts([`Service recorded for ${vehicle}`]);
  }
  if (type === "deferred") {
    const until = metaString(meta, "deferred_until");
    return joinParts([`Deferred ${kind} for ${vehicle}`, until ? `until ${until}` : null]);
  }
  if (type === "decommissioned") {
    return `Decommissioned ${vehicle}`;
  }
  return joinParts([`Vehicle update for ${vehicle}`, type]);
}

function composeGovernanceSummary(
  actionType: string,
  meta: Record<string, unknown>,
): string | null {
  const a = actionType.toLowerCase();
  if (!a.includes("issue") && !a.includes("council") && a !== "site_day.issue_logged") {
    return null;
  }
  const title = quotedTitle(issueTitleFromMeta(meta));
  const note = metaString(meta, "resolution_note", "note", "workaround");
  if (a === "governance.issue_resolved" || a.endsWith("issue_resolved")) {
    return joinParts([`Closed ${title ?? "issue"}`, note ? `— ${note}` : null]);
  }
  if (a === "governance.issue_deferred" || a.endsWith("issue_deferred")) {
    const until = metaString(meta, "deferred_until");
    return joinParts([
      `Deferred ${title ?? "issue"}`,
      until ? `until ${until}` : null,
      note ? `— ${note}` : null,
    ]);
  }
  if (a === "governance.issue_noted" || a.endsWith("issue_noted")) {
    return joinParts([`Log Now on ${title ?? "issue"}`, note ? `— ${note}` : null]);
  }
  if (a === "governance.council_escalated" || a.includes("council")) {
    const sev = metaString(meta, "council_severity");
    return joinParts([
      `Escalated ${title ?? "issue"} to Council`,
      sev,
      note ? `— ${note}` : null,
    ]);
  }
  if (a === "site_day.issue_logged") {
    const desc = metaString(meta, "description", "issue_description");
    const sev = metaString(meta, "severity");
    return joinParts([
      `Logged ${sev ? `${sev} ` : ""}issue`,
      title ?? (desc ? quotedTitle(desc) : null),
    ]);
  }
  return null;
}

function gpsLabelFromEntry(entry: Pick<LedgerEntry, "gps_lat" | "gps_lng">): string {
  if (entry.gps_lat == null || entry.gps_lng == null) return "";
  const lat = Number(entry.gps_lat);
  const lng = Number(entry.gps_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function whyFromMeta(meta: Record<string, unknown>): string {
  return (
    metaString(
      meta,
      "why",
      "justification",
      "situation",
      "debrief",
      "debrief_text",
      "reason",
      "resolution_note",
      "clearance_note",
      "notes",
      "note",
      "workaround",
    ) ?? ""
  );
}

function unaccountedPhrase(meta: Record<string, unknown>): string | null {
  const names = labelsFromUnknown(meta.unaccounted);
  const n =
    typeof meta.unaccounted_count === "number" && Number.isFinite(meta.unaccounted_count)
      ? meta.unaccounted_count
      : names.length;
  if (names.length > 0) return `unaccounted: ${listNames(names)}`;
  if (n > 0) return `${n} unaccounted`;
  return null;
}

function namedPeopleFromMeta(meta: Record<string, unknown>, lookups: ActivityLookups): string[] {
  const fromIds = peopleNames(
    metaIdList(meta, "passenger_ids", "participant_ids", "affected_participant_ids"),
    lookups,
  );
  const stored = labelsFromUnknown(meta.person_names);
  return [...new Set([...stored, ...fromIds])];
}

function composeHighRiskSummary(
  actionType: string,
  meta: Record<string, unknown>,
  lookups: ActivityLookups,
  category: LedgerCategory,
): string | null {
  const a = actionType.toUpperCase();
  const raw = actionType.toLowerCase();
  const place = locationFromAction(actionType, meta, lookups, category) || "Day Centre";
  const situation = metaString(meta, "situation");
  const debrief = metaString(meta, "debrief", "debrief_text");
  const reason = metaString(meta, "reason", "justification", "notes");
  const mode = (metaString(meta, "mode") ?? "").toLowerCase();
  const modeLabel = mode === "drill" ? "drill" : mode === "live" ? "live" : null;

  if (a === "EMERGENCY_ACTIVATED") {
    return joinParts([
      `Activated${modeLabel ? ` ${modeLabel}` : ""} emergency at ${place}`,
      situation ? `— ${situation}` : null,
    ]);
  }
  if (a === "EMERGENCY_STOOD_DOWN") {
    return joinParts([
      `Stood down${modeLabel ? ` ${modeLabel}` : ""} emergency at ${place}`,
      debrief ? `— ${debrief}` : null,
    ]);
  }
  if (a === "SITE_DO_NOT_OPEN") {
    return joinParts([`Did not open Day Centre`, reason ? `— ${reason}` : null]);
  }
  if (a === "SITE_LOCKDOWN_DECLARED") {
    return joinParts([`Declared lockdown at Day Centre`, reason ? `— ${reason}` : null]);
  }
  if (a === "SITE_LOCKDOWN_CLEARED") {
    return "Cleared Day Centre lockdown";
  }
  if (a === "PROGRAMME_SUSPENDED") {
    return joinParts([`Suspended programme at ${place}`, reason ? `— ${reason}` : null]);
  }
  if (a === "PROGRAMME_SUSPEND_CLEARED") {
    return `Resumed programme at ${place}`;
  }
  if (a === "CENTRE_CLOSED" || raw === "site_day.close") {
    return joinParts([
      `Closed Day Centre`,
      unaccountedPhrase(meta),
      reason ? `— ${reason}` : null,
    ]);
  }
  if (raw === "site_day.initialize") {
    const date = metaString(meta, "session_date");
    return joinParts([`Started Day Centre session`, date ? `for ${date}` : null]);
  }
  if (raw === "site_day.open") {
    return joinParts([`Opened Day Centre`, reason ? `— ${reason}` : null]);
  }
  if (raw === "site_day.centre_reopened") {
    return joinParts([`Reopened Day Centre`, reason ? `— ${reason}` : null]);
  }
  return null;
}

function composeTripFloorSummary(
  actionType: string,
  meta: Record<string, unknown>,
  lookups: ActivityLookups,
  category: LedgerCategory,
): string | null {
  const a = actionType.toUpperCase();
  const raw = actionType.toLowerCase();
  const place = locationFromAction(actionType, meta, lookups, category);
  const person = personFromMeta(meta, lookups);
  const reason = metaString(meta, "reason", "notes", "justification");
  const names = namedPeopleFromMeta(meta, lookups);

  if (a === "CURFEW_ACCOUNTED" || a === "MORNING_ROLL_ACCOUNTED") {
    const roll = a.startsWith("CURFEW") ? "evening roll" : "morning roll";
    return joinParts([
      `Accounted ${person || "client"} on ${roll}`,
      place ? `at ${place}` : null,
      reason ? `— ${reason}` : null,
    ]);
  }
  if (a === "CURFEW_UNACCOUNTED" || a === "MORNING_ROLL_UNACCOUNTED") {
    const roll = a.startsWith("CURFEW") ? "evening roll" : "morning roll";
    return joinParts([
      `Returned ${person || "client"} to awaiting ${roll}`,
      place ? `at ${place}` : null,
    ]);
  }
  if (a === "CURFEW_ABSENT_CONFIRMED" || a === "MORNING_ROLL_ABSENT") {
    const roll = a.startsWith("CURFEW") ? "evening roll" : "morning roll";
    const disposition = metaString(meta, "disposition")?.replace(/_/g, " ");
    const plan = metaString(meta, "safety_plan");
    return joinParts([
      `Marked ${person || "client"} absent from ${roll}`,
      place ? `at ${place}` : null,
      disposition ? `— ${disposition}` : null,
      plan ? `(${plan})` : reason ? `— ${reason}` : null,
    ]);
  }
  if (a === "CURFEW_REINSTATE" || a === "MORNING_ROLL_REINSTATE") {
    const roll = a.startsWith("CURFEW") ? "evening roll" : "morning roll";
    return joinParts([
      `Reinstated ${person || "client"} on ${roll}`,
      place ? `at ${place}` : null,
      reason ? `— ${reason}` : null,
    ]);
  }
  if (a.includes("ROLL") && a.includes("DEFERRED")) {
    const roll = a.includes("CURFEW") ? "evening roll" : "morning roll";
    const minutes = typeof meta.minutes === "number" ? `${meta.minutes} min` : null;
    const who = names.length ? listNames(names) : null;
    const count =
      typeof meta.affected_count === "number" ? `${meta.affected_count} people` : null;
    return joinParts([
      `Deferred ${roll}`,
      place ? `at ${place}` : null,
      minutes ? `by ${minutes}` : null,
      who ? `— ${who}` : count ? `— ${count}` : null,
      reason ? `(${reason})` : null,
    ]);
  }
  if (a === "CURFEW_RED_AUTO_RAISED" || a === "MORNING_ROLL_RED_AUTO_RAISED") {
    const roll = a.startsWith("CURFEW") ? "evening roll" : "morning roll";
    return joinParts([
      `${person || "Client"} still unaccounted on ${roll}`,
      place ? `at ${place}` : null,
      "— escalated to Red",
    ]);
  }
  if (a === "CURFEW_YELLOW_RAISED" || a === "MORNING_ROLL_YELLOW_RAISED") {
    const roll = a.startsWith("CURFEW") ? "evening roll" : "morning roll";
    return joinParts([
      `${person || "Client"} not yet accounted on ${roll}`,
      place ? `at ${place}` : null,
      "(Yellow)",
    ]);
  }
  if (a === "EVENT_HOP_PREPARED" || a === "EVENT_HOP_STARTED") {
    const from = metaString(meta, "from_label");
    const to = metaString(meta, "to_label");
    const hop =
      from && to ? `${from} → ${to}` : from ? `from ${from}` : to ? `to ${to}` : "venue hop";
    const verb = a === "EVENT_HOP_STARTED" ? "Started hop" : "Prepared hop";
    return joinParts([verb, hop, place ? `for ${place}` : null]);
  }
  if (a === "ACTIVITY_SKIP") {
    const skipReason = (reason ?? "").replace(/_/g, " ");
    return joinParts([
      `Skipped activity for ${person || "client"}`,
      place ? `at ${place}` : null,
      skipReason ? `— ${skipReason}` : null,
    ]);
  }
  if (raw === "health.infectious_exclusion_declared") {
    const cat = metaString(meta, "category")?.replace(/_/g, " ");
    return joinParts([
      `Declared infectious exclusion for ${person || "client"}`,
      cat ? `(${cat})` : null,
      place ? `at ${place}` : null,
      reason ? `— ${reason}` : null,
    ]);
  }
  if (raw === "health.infectious_exclusion_cleared") {
    const method = metaString(meta, "clearance_method")?.replace(/_/g, " ");
    return joinParts([
      `Cleared infectious exclusion for ${person || "client"}`,
      place ? `at ${place}` : null,
      method ? `— ${method}` : reason ? `— ${reason}` : null,
    ]);
  }
  if (a === "MED_BAG_HANDOVER") {
    const status = metaString(meta, "handover_status")?.replace(/_/g, " ");
    return joinParts([
      `Handed over med bag for ${person || "client"}`,
      place ? `on ${place}` : null,
      status ? `— ${status}` : null,
    ]);
  }
  if (a === "UNEXPECTED_MED_BAG_FLAGGED") {
    const ctx = metaString(meta, "context");
    const just = metaString(meta, "justification", "notes");
    return joinParts([
      `Flagged unexpected med bag for ${person || "client"}`,
      ctx ? `(${ctx})` : null,
      place ? `at ${place}` : null,
      just ? `— ${just}` : null,
    ]);
  }
  if (a === "ATTENDANCE_BULK_DEFER") {
    const minutes = typeof meta.minutes === "number" ? `${meta.minutes} min` : null;
    const method = metaString(meta, "arrival_method");
    const who = names.length ? listNames(names) : null;
    const count =
      typeof meta.affected_count === "number" ? `${meta.affected_count} passenger(s)` : null;
    return joinParts([
      `Deferred expected arrival`,
      who ? `for ${who}` : count,
      `at Day Centre`,
      minutes ? `by ${minutes}` : null,
      method ? `(${method})` : null,
      reason ? `— ${reason}` : null,
    ]);
  }
  if (a === "ATTENDANCE_YELLOW_AUTO_CLOSED" || a === "ATTENDANCE_DEPARTURE_YELLOW_AUTO_CLOSED") {
    const rail = a.includes("DEPARTURE") ? "checkout" : "arrival";
    return joinParts([
      `Cleared Yellow ${rail} for ${person || "client"}`,
      `at Day Centre`,
      reason ? `— ${reason}` : null,
    ]);
  }
  if (a === "ATTENDANCE_ACCOUNTED") {
    return joinParts([
      `Accounted ${person || "client"} at Day Centre`,
      reason ? `— ${reason}` : null,
    ]);
  }
  return null;
}

export function formatActorName(
  entry: LedgerEntry,
  actorFallback: string,
  lookups: ActivityLookups = emptyLookups(),
): string {
  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  if (meta.automated === true) return "System";
  const named = metaString(meta, "actor_name");
  if (named) return named;

  const asset = complianceAssetFromMeta(meta);
  if (asset.createdBy && asset.createdBy !== DEFAULT_STAFF_UUID) {
    const fromLookup = lookups.staff.get(asset.createdBy);
    if (fromLookup) return fromLookup;
    const resolved = resolveStaffDisplayName(asset.createdBy);
    if (resolved && resolved !== "Unknown staff") return resolved;
  }

  const isDefault = !entry.staff_id || entry.staff_id === DEFAULT_STAFF_UUID;
  const isCompliance = entry.action_type.toUpperCase().startsWith("COMPLIANCE_ASSET");
  const source = metaString(meta, "source") ?? "";
  if (
    isCompliance &&
    (isDefault ||
      actorFallback === "Unknown staff" ||
      source.includes("compliance_assets"))
  ) {
    if (!isDefault && actorFallback && actorFallback !== "Unknown staff") {
      return actorFallback;
    }
    return "System";
  }

  if (!isDefault && actorFallback && actorFallback !== "Unknown staff") {
    return actorFallback;
  }
  if (isDefault) return "System";
  return "Unknown operator";
}

export function formatActivitySummary(
  entry: LedgerEntry,
  actorFallback: string,
  lookups: ActivityLookups = emptyLookups(),
): {
  actorName: string;
  summary: string;
  actionLabel: string;
  location: string;
  why: string;
  gpsLabel: string;
} {
  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  const actionLabel = ACTION_LABELS[entry.action_type] ?? titleAction(entry.action_type);
  const actorName = formatActorName(entry, actorFallback, lookups);
  const a = entry.action_type.toUpperCase();
  const location = locationFromAction(entry.action_type, meta, lookups, entry.category);
  const why = whyFromMeta(meta);
  const gpsLabel = gpsLabelFromEntry(entry);

  const pack = (summary: string) => ({
    actorName,
    summary,
    actionLabel,
    location,
    why,
    gpsLabel,
  });

  if (a.startsWith("COMPLIANCE_ASSET")) {
    return pack(composeComplianceSummary(entry.action_type, meta));
  }

  const attendance = composeAttendanceSummary(entry.action_type, actionLabel, meta, lookups);
  if (attendance) return pack(attendance);

  const transport = composeTransportSummary(entry.action_type, meta, lookups);
  if (transport) return pack(transport);

  const highRisk = composeHighRiskSummary(entry.action_type, meta, lookups, entry.category);
  if (highRisk) return pack(highRisk);

  const tripFloor = composeTripFloorSummary(entry.action_type, meta, lookups, entry.category);
  if (tripFloor) return pack(tripFloor);

  const eventOps = composeEventOpsSummary(entry.action_type, meta, lookups);
  if (eventOps) return pack(eventOps);

  const mealOpen = composeMealOpenSummary(entry.action_type, meta, lookups);
  if (mealOpen) return pack(mealOpen);

  const escalation = composeEscalationSummary(entry.action_type, meta, lookups);
  if (escalation) return pack(escalation);

  const vehicleOps = composeVehicleOpsSummary(entry.action_type, meta);
  if (vehicleOps) return pack(vehicleOps);

  const governance = composeGovernanceSummary(entry.action_type, meta);
  if (governance) return pack(governance);

  const stored = metaString(meta, "summary");
  if (stored) return pack(stored);

  const description = metaString(meta, "description", "reason", "notes");
  const person = personFromMeta(meta, lookups);
  if (description) {
    if (person && !description.toLowerCase().includes(person.toLowerCase())) {
      return pack(`${description} — ${person}`);
    }
    return pack(description);
  }

  const extra = person ? ` — ${person}` : "";
  return pack(`${actionLabel}${extra}`);
}

function uniqueIds(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((id): id is string => !!id && id !== DEFAULT_STAFF_UUID))];
}

async function fetchRowsById(
  table: string,
  columns: string,
  ids: string[],
  idColumn = "id",
): Promise<Record<string, unknown>[]> {
  if (ids.length === 0) return [];
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const { data, error } = await supabase.from(table).select(columns).in(idColumn, chunk);
    if (error) {
      console.warn(`[activity-log] ${table} lookup failed`, error.message);
      continue;
    }
    for (const row of data ?? []) out.push(row as Record<string, unknown>);
  }
  return out;
}

function displayNameFromPersonRow(row: Record<string, unknown>): string {
  const full = typeof row.full_name === "string" ? row.full_name.trim() : "";
  if (full) return full;
  const first = typeof row.first_name === "string" ? row.first_name.trim() : "";
  const last = typeof row.last_name === "string" ? row.last_name.trim() : "";
  return `${first} ${last}`.trim();
}

async function loadActivityLookups(entries: LedgerEntry[]): Promise<ActivityLookups> {
  const lookups = emptyLookups();
  const participantIds: string[] = [];
  const staffIds: string[] = [];
  const supportRowIds: string[] = [];
  const eventSupportRowIds: string[] = [];
  const eventIds: string[] = [];
  const activityIds: string[] = [];
  const tripIds: string[] = [];
  const sessionIds: string[] = [];
  const peopleIds: string[] = [];

  for (const entry of entries) {
    const meta = (entry.metadata ?? {}) as Record<string, unknown>;
    const asset = complianceAssetFromMeta(meta);
    participantIds.push(metaString(meta, "participant_id") ?? "");
    staffIds.push(entry.staff_id, asset.createdBy ?? "");
    const a = entry.action_type.toUpperCase();
    const rowId = metaString(meta, "row_id", "attendance_id");
    if (rowId && a.includes("SUPPORT") && a.includes("EVENT")) eventSupportRowIds.push(rowId);
    else if (rowId && a.includes("SUPPORT")) supportRowIds.push(rowId);
    eventIds.push(metaString(meta, "event_id") ?? "");
    activityIds.push(metaString(meta, "activity_id") ?? "");
    tripIds.push(metaString(meta, "trip_id") ?? "");
    sessionIds.push(metaString(meta, "event_day_session_id", "session_id") ?? "");
    peopleIds.push(
      ...metaIdList(
        meta,
        "passenger_ids",
        "participant_ids",
        "affected_participant_ids",
        "unaccounted",
      ),
    );
  }

  const [
    participants,
    staff,
    supportLogs,
    eventSupportLogs,
    events,
    activities,
    trips,
    sessions,
  ] = await Promise.all([
      fetchRowsById("participants", "id, first_name, last_name", uniqueIds([...participantIds, ...peopleIds])),
      fetchRowsById("staff_registry", "id, full_name", uniqueIds([...staffIds, ...peopleIds])),
      fetchRowsById(
        "support_attendance_log",
        "id, person_kind, staff_id, carer_id, arrival_method, arrival_bus_run_code, departure_vector, departure_bus_run_code",
        uniqueIds(supportRowIds),
      ),
      fetchRowsById(
        "event_support_attendance_log",
        "id, person_kind, staff_id, carer_id, arrival_method, arrival_bus_run_code, return_transport, return_bus_run_code",
        uniqueIds(eventSupportRowIds),
      ),
      fetchRowsById("event_manifest", "id, title", uniqueIds(eventIds)),
      fetchRowsById("site_day_activities", "id, title", uniqueIds(activityIds)),
      fetchRowsById(
        "transport_trips",
        "id, bus_run_code, trip_date, event_id, trip_kind, trip_return",
        uniqueIds(tripIds),
      ),
      fetchRowsById(
        "event_day_sessions",
        "id, event_id, session_date",
        uniqueIds(sessionIds),
      ),
    ]);

  for (const row of participants) {
    const id = String(row.id ?? "");
    const name = displayNameFromPersonRow(row);
    if (id && name) lookups.participants.set(id, name);
  }
  for (const row of staff) {
    const id = String(row.id ?? "");
    const name = typeof row.full_name === "string" ? row.full_name.trim() : "";
    if (id && name) lookups.staff.set(id, name);
  }
  for (const row of events) {
    const id = String(row.id ?? "");
    const name = typeof row.title === "string" ? row.title.trim() : "";
    if (id && name) lookups.events.set(id, name);
  }
  for (const row of activities) {
    const id = String(row.id ?? "");
    const title = typeof row.title === "string" ? row.title.trim() : "";
    if (id && title) lookups.activities.set(id, title);
  }
  for (const row of trips) {
    const id = String(row.id ?? "");
    if (!id) continue;
    lookups.trips.set(id, {
      busRunCode: typeof row.bus_run_code === "string" ? row.bus_run_code : null,
      tripDate: typeof row.trip_date === "string" ? row.trip_date : null,
      eventId: typeof row.event_id === "string" ? row.event_id : null,
      tripKind: typeof row.trip_kind === "string" ? row.trip_kind : null,
      tripReturn: typeof row.trip_return === "string" ? row.trip_return : null,
    });
    if (typeof row.event_id === "string") eventIds.push(row.event_id);
  }
  for (const row of sessions) {
    const id = String(row.id ?? "");
    if (!id) continue;
    lookups.sessions.set(id, {
      eventId: typeof row.event_id === "string" ? row.event_id : null,
      sessionDate: typeof row.session_date === "string" ? row.session_date : null,
    });
    if (typeof row.event_id === "string") eventIds.push(row.event_id);
  }
  const missingEventIds = uniqueIds(eventIds).filter((id) => !lookups.events.has(id));
  const extraEvents = await fetchRowsById("event_manifest", "id, title", missingEventIds);
  for (const row of extraEvents) {
    const id = String(row.id ?? "");
    const name = typeof row.title === "string" ? row.title.trim() : "";
    if (id && name) lookups.events.set(id, name);
  }
  const legs = await fetchRowsById(
    "trip_legs",
    "trip_id, to_label, to_participant_id, to_staff_id, to_carer_id",
    uniqueIds(tripIds),
    "trip_id",
  );
  for (const leg of legs) {
    const tripId = String(leg.trip_id ?? "");
    const personId =
      (typeof leg.to_participant_id === "string" && leg.to_participant_id) ||
      (typeof leg.to_staff_id === "string" && leg.to_staff_id) ||
      (typeof leg.to_carer_id === "string" && leg.to_carer_id) ||
      "";
    if (!tripId || !personId) continue;
    const name = typeof leg.to_label === "string" ? leg.to_label.trim() : "";
    if (!name) continue;
    const list = lookups.tripPassengers.get(tripId) ?? [];
    list.push(name);
    lookups.tripPassengers.set(tripId, list);
    lookups.people.set(personId, name);
  }

  const extraStaff = uniqueIds([
    ...supportLogs.map((r) => String(r.staff_id ?? "")),
    ...eventSupportLogs.map((r) => String(r.staff_id ?? "")),
  ]);
  const extraCarers = uniqueIds([
    ...supportLogs.map((r) => String(r.carer_id ?? "")),
    ...eventSupportLogs.map((r) => String(r.carer_id ?? "")),
    ...peopleIds,
  ]);
  const [moreStaff, carers] = await Promise.all([
    fetchRowsById("staff_registry", "id, full_name", extraStaff.filter((id) => !lookups.staff.has(id))),
    fetchRowsById("carers_registry", "id, full_name", extraCarers),
  ]);
  for (const row of moreStaff) {
    const id = String(row.id ?? "");
    const name = typeof row.full_name === "string" ? row.full_name.trim() : "";
    if (id && name) lookups.staff.set(id, name);
  }
  for (const row of carers) {
    const id = String(row.id ?? "");
    const name = typeof row.full_name === "string" ? row.full_name.trim() : "";
    if (id && name) lookups.carers.set(id, name);
  }

  const hintFrom = (
    row: Record<string, unknown>,
    departureKey: string,
    departureRunKey: string,
  ): SupportRowHint => {
    const kind = typeof row.person_kind === "string" ? row.person_kind : null;
    const staffId = String(row.staff_id ?? "");
    const carerId = String(row.carer_id ?? "");
    const personName =
      (kind === "carer" ? lookups.carers.get(carerId) : lookups.staff.get(staffId)) ||
      (kind === "carer" ? "Carer" : kind === "volunteer" ? "Volunteer" : "Staff");
    return {
      personName,
      personKind: kind,
      arrivalMethod: typeof row.arrival_method === "string" ? row.arrival_method : null,
      arrivalBusRunCode:
        typeof row.arrival_bus_run_code === "string" ? row.arrival_bus_run_code : null,
      departureVector: typeof row[departureKey] === "string" ? String(row[departureKey]) : null,
      departureBusRunCode:
        typeof row[departureRunKey] === "string" ? String(row[departureRunKey]) : null,
    };
  };
  for (const row of supportLogs) {
    lookups.supportRows.set(String(row.id), hintFrom(row, "departure_vector", "departure_bus_run_code"));
  }
  for (const row of eventSupportLogs) {
    lookups.eventSupportRows.set(
      String(row.id),
      hintFrom(row, "return_transport", "return_bus_run_code"),
    );
  }
  for (const [id, name] of lookups.participants) lookups.people.set(id, name);
  for (const [id, name] of lookups.staff) lookups.people.set(id, name);
  for (const [id, name] of lookups.carers) lookups.people.set(id, name);
  return lookups;
}

function toRow(
  entry: LedgerEntry,
  lookups: ActivityLookups,
  areaFilter: Exclude<ActivityAreaId, "all"> | null,
): ActivityLogRow | null {
  const area = classifyActivityArea(entry.action_type, entry.category, entry.metadata);
  if (areaFilter && area !== areaFilter) return null;
  const staffLabel = lookups.staff.get(entry.staff_id) || resolveStaffDisplayName(entry.staff_id);
  const formatted = formatActivitySummary(entry, staffLabel, lookups);
  const areaLabel = ACTIVITY_AREAS.find((a) => a.id === area)?.label ?? area;
  return {
    id: entry.id,
    createdAt: entry.created_at,
    actorName: formatted.actorName,
    area,
    areaLabel,
    actionType: entry.action_type,
    actionLabel: formatted.actionLabel,
    summary: formatted.summary,
    location: formatted.location,
    why: formatted.why,
    gpsLabel: formatted.gpsLabel,
    category: entry.category,
    severity: entry.severity,
  };
}

const MEAL_STATUS_WORDS: Record<string, string> = {
  served: "Served",
  modified: "Served modified",
  own_order: "Own-order",
  declined: "Declined",
  na: "N/A",
};

function overlayAlreadyCovered(
  ledger: LedgerEntry[],
  key: "compliance_log_id" | "meal_row_id",
  id: string,
): boolean {
  return ledger.some((e) => metaString((e.metadata ?? {}) as Record<string, unknown>, key) === id);
}

async function listMedicationOverlay(
  fromIso: string,
  toIso: string,
  ledger: LedgerEntry[],
  limit: number,
): Promise<ActivityLogRow[]> {
  const { data, error } = await supabase
    .from("compliance_audit_logs")
    .select(
      "id, participant_id, action_performed, witness_1_identity, witness_2_identity, timestamp, metadata",
    )
    .gte("timestamp", fromIso)
    .lte("timestamp", toIso)
    .order("timestamp", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("[activity-log] medication overlay failed", error.message);
    return [];
  }
  const rows = data ?? [];
  const names = new Map<string, string>();
  const participantIds = uniqueIds(rows.map((r) => String((r as { participant_id?: string }).participant_id ?? "")));
  const people = await fetchRowsById(
    "participants",
    "id, first_name, last_name",
    participantIds,
  );
  for (const p of people) {
    const id = String(p.id ?? "");
    const name = displayNameFromPersonRow(p);
    if (id && name) names.set(id, name);
  }

  const out: ActivityLogRow[] = [];
  for (const raw of rows) {
    const r = raw as {
      id: string;
      participant_id: string;
      action_performed: string;
      witness_1_identity: string | null;
      witness_2_identity: string | null;
      timestamp: string;
      metadata: Record<string, unknown> | null;
    };
    if (overlayAlreadyCovered(ledger, "compliance_log_id", r.id)) continue;
    const meta = r.metadata ?? {};
    const person = names.get(r.participant_id) ?? "client";
    const med = metaString(meta, "medication_name") ?? "medication";
    const dose = metaString(meta, "dosage");
    const status = metaString(meta, "status");
    const source = metaString(meta, "source");
    const place = source?.includes("trip") ? "on trip" : "at Day Centre";
    const location = source?.includes("trip") ? "trip" : "Day Centre";
    const medLabel = dose ? `${dose} ${med}` : med;
    const action = (r.action_performed ?? "").toUpperCase();
    const why =
      action.includes("REFUSED") || status === "Refused"
        ? "Client refused"
        : action.includes("MISSED") || status === "Missed"
          ? metaString(meta, "reason", "notes") || "Dose missed"
          : "";
    let summary: string;
    if (action.includes("REFUSED") || status === "Refused") {
      summary = `${person} refused ${medLabel} ${place}`;
    } else if (action.includes("MISSED") || status === "Missed") {
      summary = `Missed ${medLabel} for ${person} ${place}`;
    } else if (action.includes("SOLE")) {
      summary = `Gave ${medLabel} to ${person} ${place} (sole carer: ${r.witness_1_identity ?? "staff"})`;
    } else if (action.includes("DUAL")) {
      const w2 = r.witness_2_identity ? ` and ${r.witness_2_identity}` : "";
      summary = `Gave ${medLabel} to ${person} ${place} (dual witness: ${r.witness_1_identity ?? "staff"}${w2})`;
    } else {
      summary = `Gave ${medLabel} to ${person} ${place}`;
    }
    const actorName = (r.witness_1_identity ?? "").trim() || "Unknown operator";
    out.push({
      id: `overlay:med:${r.id}`,
      createdAt: r.timestamp,
      actorName,
      area: "people",
      areaLabel: "People / records",
      actionType: r.action_performed,
      actionLabel: ACTION_LABELS[r.action_performed] ?? "Medication given",
      summary,
      location,
      why,
      gpsLabel: "",
      category: "CLIENT",
      severity: "INFO",
    });
  }
  return out;
}

async function listMealOverlay(
  table: "site_day_meal_service_rolls" | "event_meal_service_rolls",
  fromIso: string,
  toIso: string,
  ledger: LedgerEntry[],
  limit: number,
): Promise<ActivityLogRow[]> {
  const activityCol = table === "site_day_meal_service_rolls" ? "activity_id" : "venue_stop_id";
  const { data, error } = await supabase
    .from(table)
    .select(`id, ${activityCol}, participant_id, status, notes, updated_at, updated_by_id`)
    .neq("status", "expected")
    .gte("updated_at", fromIso)
    .lte("updated_at", toIso)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn(`[activity-log] meal overlay ${table} failed`, error.message);
    return [];
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const participantIds = uniqueIds(rows.map((r) => String(r.participant_id ?? "")));
  const staffIds = uniqueIds(rows.map((r) => String(r.updated_by_id ?? "")));
  const activityIds = uniqueIds(rows.map((r) => String(r[activityCol] ?? "")));
  const titleTable =
    table === "site_day_meal_service_rolls" ? "site_day_activities" : "event_venue_stops";
  const titleCols =
    table === "site_day_meal_service_rolls" ? "id, title, meal_slot" : "id, venue_name, meal_slot";
  const [people, staff, titles] = await Promise.all([
    fetchRowsById("participants", "id, first_name, last_name", participantIds),
    fetchRowsById("staff_registry", "id, full_name", staffIds),
    fetchRowsById(titleTable, titleCols, activityIds),
  ]);
  const names = new Map<string, string>();
  for (const p of people) {
    const id = String(p.id ?? "");
    const name = displayNameFromPersonRow(p);
    if (id && name) names.set(id, name);
  }
  const staffNames = new Map<string, string>();
  for (const s of staff) {
    const id = String(s.id ?? "");
    const name = typeof s.full_name === "string" ? s.full_name.trim() : "";
    if (id && name) staffNames.set(id, name);
  }
  const titleMap = new Map<string, string>();
  for (const t of titles) {
    const id = String(t.id ?? "");
    const title =
      (typeof t.title === "string" && t.title.trim()) ||
      (typeof t.venue_name === "string" && t.venue_name.trim()) ||
      (typeof t.meal_slot === "string" && t.meal_slot.replace(/_/g, " ")) ||
      "meal";
    if (id) titleMap.set(id, title);
  }

  const trip = table === "event_meal_service_rolls";
  const out: ActivityLogRow[] = [];
  for (const r of rows) {
    const id = String(r.id ?? "");
    if (!id || overlayAlreadyCovered(ledger, "meal_row_id", id)) continue;
    const status = String(r.status ?? "");
    const verb = MEAL_STATUS_WORDS[status] ?? status;
    const person = names.get(String(r.participant_id ?? "")) ?? "client";
    const meal = titleMap.get(String(r[activityCol] ?? "")) ?? "meal";
    const place = trip ? "on trip" : "at Day Centre";
    const location = trip ? "trip" : "Day Centre";
    const notes = typeof r.notes === "string" && r.notes.trim() ? ` — ${r.notes.trim()}` : "";
    const why =
      status === "declined" || status === "na"
        ? (typeof r.notes === "string" ? r.notes.trim() : "") ||
          (status === "declined" ? "Declined" : "Not applicable")
        : typeof r.notes === "string"
          ? r.notes.trim()
          : "";
    const staffId = String(r.updated_by_id ?? "");
    const actorName =
      staffNames.get(staffId) ||
      (staffId && staffId !== DEFAULT_STAFF_UUID
        ? resolveStaffDisplayName(staffId)
        : "Unknown operator");
    const summary =
      status === "declined" || status === "na"
        ? `${verb} ${meal} for ${person} ${place}${notes}`
        : `${verb} ${meal} to ${person} ${place}${notes}`;
    out.push({
      id: `overlay:meal:${id}`,
      createdAt: String(r.updated_at ?? ""),
      actorName: actorName === "Unknown staff" ? "Unknown operator" : actorName,
      area: trip ? "trip" : "centre",
      areaLabel: trip ? "Trips" : "Day Centre",
      actionType: trip ? "EVENT_MEAL_SERVED" : "MEAL_SERVED",
      actionLabel: trip ? "Trip meal service" : "Meal service",
      summary,
      location,
      why,
      gpsLabel: "",
      category: trip ? "TRIP" : "CENTRE",
      severity: "INFO",
    });
  }
  return out;
}

async function listIssueNoteOverlay(
  fromIso: string,
  toIso: string,
  ledger: LedgerEntry[],
  limit: number,
): Promise<ActivityLogRow[]> {
  const { data, error } = await supabase
    .from("hub_issue_notes")
    .select("id, source, source_row_id, note, kind, stamped_at, staff_id")
    .eq("kind", "append")
    .gte("stamped_at", fromIso)
    .lte("stamped_at", toIso)
    .order("stamped_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("[activity-log] issue note overlay failed", error.message);
    return [];
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const coveredNoteIds = new Set(
    ledger
      .map((e) => metaString((e.metadata ?? {}) as Record<string, unknown>, "hub_note_id"))
      .filter((id): id is string => !!id),
  );
  const staffIds = uniqueIds(rows.map((r) => String(r.staff_id ?? "")));
  const issueIds = uniqueIds(
    rows
      .filter((r) => r.source === "day_centre" || r.source === "event")
      .map((r) => String(r.source_row_id ?? "")),
  );
  const assetIds = uniqueIds(
    rows.filter((r) => r.source === "renewal").map((r) => String(r.source_row_id ?? "")),
  );
  const [staff, issues, assets] = await Promise.all([
    fetchRowsById("staff_registry", "id, full_name", staffIds),
    fetchRowsById("site_issues_register", "id, issue_description", issueIds),
    fetchRowsById("compliance_assets", "id, name", assetIds),
  ]);
  const staffNames = new Map<string, string>();
  for (const s of staff) {
    const id = String(s.id ?? "");
    const name = typeof s.full_name === "string" ? s.full_name.trim() : "";
    if (id && name) staffNames.set(id, name);
  }
  const titles = new Map<string, string>();
  for (const i of issues) {
    const id = String(i.id ?? "");
    const desc = typeof i.issue_description === "string" ? i.issue_description.trim() : "";
    if (id && desc) titles.set(id, desc);
  }
  for (const a of assets) {
    const id = String(a.id ?? "");
    const name = typeof a.name === "string" ? a.name.trim() : "";
    if (id && name) titles.set(id, name);
  }

  const out: ActivityLogRow[] = [];
  for (const r of rows) {
    const id = String(r.id ?? "");
    if (!id || coveredNoteIds.has(id)) continue;
    const note = String(r.note ?? "").trim();
    if (!note) continue;
    const sourceId = String(r.source_row_id ?? "");
    const title = quotedTitle(titles.get(sourceId) ?? null);
    const staffId = String(r.staff_id ?? "");
    const actorName =
      staffNames.get(staffId) ||
      (staffId && staffId !== DEFAULT_STAFF_UUID
        ? resolveStaffDisplayName(staffId)
        : "Unknown operator");
    const source = String(r.source ?? "");
    const area: Exclude<ActivityAreaId, "all"> =
      source === "renewal" || source === "escalation" ? "vehicle" : "governance";
    const location =
      source === "renewal" || source === "escalation"
        ? "vehicle"
        : source === "event"
          ? "trip"
          : "Day Centre";
    out.push({
      id: `overlay:issue-note:${id}`,
      createdAt: String(r.stamped_at ?? ""),
      actorName: actorName === "Unknown staff" ? "Unknown operator" : actorName,
      area,
      areaLabel: area === "vehicle" ? "Vehicles" : "Issues / emergency",
      actionType: "governance.issue_noted",
      actionLabel: "Log Now",
      summary: joinParts([`Log Now on ${title ?? "issue"}`, `— ${note}`]),
      location,
      why: note,
      gpsLabel: "",
      category: area === "vehicle" ? "VEHICLE" : "CENTRE",
      severity: "INFO",
    });
  }
  return out;
}

export async function listActivityLog(input: {
  fromIso: string;
  toIso: string;
  area?: ActivityAreaId;
  actionTypes?: string[];
  limit?: number;
}): Promise<ActivityLogRow[]> {
  const limit = input.limit ?? ACTIVITY_LOG_LIMIT;
  const fromBound = localDayBoundIso(input.fromIso, false);
  const toBound = localDayBoundIso(input.toIso, true);
  const fetchLimit = input.area && input.area !== "all" ? Math.max(limit, 2000) : limit;
  let q = supabase
    .from("operational_ledger")
    .select(
      "id, created_at, staff_id, category, severity, action_type, gps_lat, gps_lng, metadata",
    )
    .gte("created_at", fromBound)
    .lte("created_at", toBound)
    .order("created_at", { ascending: false })
    .limit(fetchLimit);
  if (input.actionTypes?.length) {
    q = q.in("action_type", input.actionTypes);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  await primeStaffDisplayNames();
  const ledger = (data ?? []) as LedgerEntry[];
  const lookups = await loadActivityLookups(ledger);
  const areaFilter = input.area && input.area !== "all" ? input.area : null;
  const rows: ActivityLogRow[] = [];
  for (const entry of ledger) {
    const row = toRow(entry, lookups, areaFilter);
    if (row) rows.push(row);
  }

  if (!input.actionTypes?.length) {
    const overlayLimit = Math.min(200, limit);
    const [meds, centreMeals, tripMeals, issueNotes] = await Promise.all([
      listMedicationOverlay(fromBound, toBound, ledger, overlayLimit),
      listMealOverlay("site_day_meal_service_rolls", fromBound, toBound, ledger, overlayLimit),
      listMealOverlay("event_meal_service_rolls", fromBound, toBound, ledger, overlayLimit),
      listIssueNoteOverlay(fromBound, toBound, ledger, overlayLimit),
    ]);
    for (const extra of [...meds, ...centreMeals, ...tripMeals, ...issueNotes]) {
      if (areaFilter && extra.area !== areaFilter) continue;
      rows.push(extra);
    }
  }

  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return collapseSameSecondDupes(rows).slice(0, limit);
}

function collapseSameSecondDupes(rows: ActivityLogRow[]): ActivityLogRow[] {
  const out: ActivityLogRow[] = [];
  for (const row of rows) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.actionType === row.actionType &&
      prev.summary === row.summary &&
      prev.actorName === row.actorName &&
      Math.abs(Date.parse(prev.createdAt) - Date.parse(row.createdAt)) <= 2000
    ) {
      continue;
    }
    out.push(row);
  }
  return out;
}
