/**
 * Day Centre End of Day Report — read model for one calendar day.
 *
 * Aggregates attendance (who / how / when), meal dispositions, checkout
 * (who went home and how), visitors, and RYGE issues. Date is a YYYY-MM-DD
 * operational calendar day (SIM-aware caller).
 */
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import {
  arrivalMethodBadgeLabel,
  listAttendanceRoll,
  type AttendanceStatus,
  type ClientAttendanceRow,
  type DepartureVector,
} from "@/lib/api/client-attendance";
import {
  getSessionByDate,
  type SiteDaySession,
  type SiteSessionPhase,
} from "@/lib/api/site-day-sessions";
import {
  listSiteDayActivities,
  MEAL_SLOT_LABELS,
  type MealSlot,
  type SiteDayActivity,
} from "@/lib/api/site-day-activities";
import {
  type MealServiceStatus,
} from "@/lib/api/site-day-meal-service";
import {
  listSiteDayVisitors,
  visitorKindLabel,
  type SiteDayVisitor,
} from "@/lib/api/site-day-visitors";
import { listSupportAttendanceRoll } from "@/lib/api/support-attendance";
import { supportPersonKindLabel } from "@/lib/support-person";
import {
  listIssues,
  sortByRygeOldestFirst,
  type SiteIssue,
} from "@/lib/api/site-issues";
import {
  listLookupParameters,
  listParticipants,
  LOOKUP_CATEGORIES,
  primeStaffDisplayNames,
  resolveStaffDisplayName,
  type Participant,
} from "@/lib/data-store";
import { eventBusRunOptions } from "@/lib/event-bus-runs";
import { MEAL_SOURCE_LABELS } from "@/lib/meal-open";
import { operationalNowIso } from "@/lib/operational-clock";
import {
  sortByParticipantSurname,
  surnameMapFromParticipants,
} from "@/lib/ui/sort-participants";

type MealRollSnapshot = {
  activityId: string;
  participantId: string;
  status: MealServiceStatus;
  notes: string | null;
  updatedAt: string | null;
};

export const MEAL_STATUS_LABELS: Record<MealServiceStatus, string> = {
  expected: "Not yet served",
  served: "Served",
  modified: "Modified",
  own_order: "Own order",
  declined: "Declined",
  na: "N/A",
};

export const MEAL_STATUS_ORDER: MealServiceStatus[] = [
  "served",
  "modified",
  "own_order",
  "declined",
  "na",
  "expected",
];

export const DEPARTURE_VECTOR_LABELS: Record<DepartureVector, string> = {
  bus: "Bus",
  family: "Family / carer",
  independent: "Independent",
};

export const SESSION_PHASE_LABELS: Record<SiteSessionPhase, string> = {
  open_pending: "Start of Day",
  active_day: "Active",
  escalated_lock: "Escalated lock",
  closed_orderly: "Closed orderly",
  closed_no_go: "Closed — NO-GO",
};

export type EndOfDayAttendanceRow = {
  participantId: string;
  name: string;
  status: AttendanceStatus;
  arrivalHow: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  departureHow: string | null;
  notes: string | null;
};

export type EndOfDayMealPerson = {
  participantId: string;
  name: string;
  status: MealServiceStatus;
  statusLabel: string;
  notes: string | null;
  updatedAt: string | null;
};

export type EndOfDayMealVariation = {
  status: MealServiceStatus;
  label: string;
  count: number;
  people: EndOfDayMealPerson[];
};

export type EndOfDayMealBlock = {
  activityId: string;
  title: string;
  slotLabel: string;
  sourceLabel: string | null;
  menuNotes: string | null;
  phase: string;
  openedAt: string | null;
  closedAt: string | null;
  variations: EndOfDayMealVariation[];
  total: number;
};

export type EndOfDayVisitorRow = {
  id: string;
  displayName: string;
  kindLabel: string;
  arrivedAt: string;
  leftAt: string | null;
};

export type EndOfDaySupportRow = {
  id: string;
  displayName: string;
  roleLabel: string;
  status: string;
  arrivalHow: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
};

export type DayCentreEndOfDayReport = {
  sessionDate: string;
  generatedAt: string;
  session: SiteDaySession | null;
  openedByName: string | null;
  closedByName: string | null;
  arrived: EndOfDayAttendanceRow[];
  absent: EndOfDayAttendanceRow[];
  stillExpected: EndOfDayAttendanceRow[];
  checkedOut: EndOfDayAttendanceRow[];
  stillOnSite: EndOfDayAttendanceRow[];
  meals: EndOfDayMealBlock[];
  visitors: EndOfDayVisitorRow[];
  support: EndOfDaySupportRow[];
  issues: SiteIssue[];
  counts: {
    expected: number;
    arrived: number;
    absent: number;
    stillExpected: number;
    checkedOut: number;
    stillOnSite: number;
    visitors: number;
    visitorsStillPresent: number;
    supportPresent: number;
    issuesRed: number;
    issuesYellow: number;
    issuesGreen: number;
  };
};

function arrivalHowLabel(
  row: ClientAttendanceRow,
  busDisplayByCode: Map<string, string>,
): string {
  if (row.arrivalMethod === "bus") {
    const run =
      (row.arrivalBusRunCode &&
        busDisplayByCode.get(row.arrivalBusRunCode)) ||
      null;
    return run ?? "Bus";
  }
  return arrivalMethodBadgeLabel(row.arrivalMethod);
}

async function listMealRollsForActivities(
  activityIds: string[],
): Promise<
  Array<{
    activityId: string;
    participantId: string;
    status: MealServiceStatus;
    notes: string | null;
    updatedAt: string | null;
  }>
> {
  if (activityIds.length === 0) return [];
  const { data, error } = await supabase
    .from("site_day_meal_service_rolls")
    .select("activity_id, participant_id, status, notes, updated_at")
    .in("activity_id", activityIds);
  if (error) {
    if (isSchemaMismatchError(error)) return [];
    throw error;
  }
  return (data ?? []).map((r) => {
    const row = r as {
      activity_id: string;
      participant_id: string;
      status: string;
      notes: string | null;
      updated_at?: string | null;
    };
    return {
      activityId: row.activity_id,
      participantId: row.participant_id,
      status: row.status as MealServiceStatus,
      notes: row.notes,
      updatedAt: row.updated_at ?? null,
    };
  });
}

async function loadCheckoutVectors(
  sessionId: string,
): Promise<Map<string, DepartureVector>> {
  const map = new Map<string, DepartureVector>();
  const { data, error } = await supabase
    .from("operational_ledger")
    .select("created_at, metadata")
    .eq("action_type", "ATTENDANCE_CHECKOUT")
    .filter("metadata->>session_id", "eq", sessionId)
    .order("created_at", { ascending: true });
  if (error) {
    if (isSchemaMismatchError(error)) return map;
    throw error;
  }
  for (const raw of data ?? []) {
    const meta = (raw as { metadata?: Record<string, unknown> | null }).metadata;
    const pid = String(meta?.participant_id ?? "");
    const vector = meta?.departure_vector;
    if (!pid) continue;
    if (vector === "bus" || vector === "family" || vector === "independent") {
      map.set(pid, vector);
    }
  }
  return map;
}

function toAttendanceRow(
  row: ClientAttendanceRow,
  name: string,
  arrivalHow: string,
  departureHow: string | null,
): EndOfDayAttendanceRow {
  return {
    participantId: row.participantId,
    name,
    status: row.status,
    arrivalHow,
    checkedInAt: row.checkedInAt,
    checkedOutAt: row.checkedOutAt,
    departureHow,
    notes: row.notes,
  };
}

export async function buildDayCentreEndOfDayReport(
  sessionDate: string,
): Promise<DayCentreEndOfDayReport> {
  const session = await getSessionByDate(sessionDate);
  const generatedAt = operationalNowIso();

  const emptyCounts = {
    expected: 0,
    arrived: 0,
    absent: 0,
    stillExpected: 0,
    checkedOut: 0,
    stillOnSite: 0,
    visitors: 0,
    visitorsStillPresent: 0,
    supportPresent: 0,
    issuesRed: 0,
    issuesYellow: 0,
    issuesGreen: 0,
  };

  if (!session) {
    return {
      sessionDate,
      generatedAt,
      session: null,
      openedByName: null,
      closedByName: null,
      arrived: [],
      absent: [],
      stillExpected: [],
      checkedOut: [],
      stillOnSite: [],
      meals: [],
      visitors: [],
      support: [],
      issues: [],
      counts: emptyCounts,
    };
  }

  const [roll, visitors, activities, issues, participants, busLookups, supportRoll] =
    await Promise.all([
      listAttendanceRoll(session.id),
      listSiteDayVisitors(session.id),
      listSiteDayActivities(session.id),
      listIssues(session.id),
      listParticipants(),
      listLookupParameters(LOOKUP_CATEGORIES.busRun),
      listSupportAttendanceRoll(session.id),
      primeStaffDisplayNames(),
    ]);

  const checkoutVectors = await loadCheckoutVectors(session.id);
  const mealActs = activities.filter((a) => a.activityKind === "meal");
  const mealRows = await listMealRollsForActivities(
    mealActs.map((a) => a.id),
  );

  const nameById = new Map<string, string>();
  const surnameMap = surnameMapFromParticipants(participants as Participant[]);
  for (const p of participants) {
    nameById.set(p.id, p.fullName || `${p.firstName} ${p.lastName}`.trim());
  }

  const busOpts = eventBusRunOptions(busLookups);
  const busDisplayByCode = new Map(
    busOpts.map((o) => [o.code, o.displayName] as const),
  );

  const sortedRoll = sortByParticipantSurname(
    roll,
    (r) => r.participantId,
    surnameMap,
  );

  const mapped = sortedRoll.map((r) =>
    toAttendanceRow(
      r,
      nameById.get(r.participantId) ?? r.participantId,
      arrivalHowLabel(r, busDisplayByCode),
      r.status === "checked_out" || r.checkedOutAt
        ? checkoutVectors.has(r.participantId)
          ? DEPARTURE_VECTOR_LABELS[checkoutVectors.get(r.participantId)!]
          : null
        : null,
    ),
  );

  const arrived = mapped.filter(
    (r) =>
      r.status === "checked_in" ||
      r.status === "checked_out" ||
      r.status === "accounted" ||
      !!r.checkedInAt,
  );
  const absent = mapped.filter((r) => r.status === "absent");
  const stillExpected = mapped.filter(
    (r) => r.status === "expected" && !r.checkedInAt,
  );
  const checkedOut = mapped.filter(
    (r) => r.status === "checked_out" || !!r.checkedOutAt,
  );
  const stillOnSite = mapped.filter((r) => r.status === "checked_in");

  const mealRowsByActivity = new Map<string, MealRollSnapshot[]>();
  for (const row of mealRows) {
    const list = mealRowsByActivity.get(row.activityId) ?? [];
    list.push(row);
    mealRowsByActivity.set(row.activityId, list);
  }

  const meals: EndOfDayMealBlock[] = mealActs.map((act) =>
    buildMealBlock(act, mealRowsByActivity.get(act.id) ?? [], nameById, surnameMap),
  );

  const supportRows: EndOfDaySupportRow[] = supportRoll.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    roleLabel: supportPersonKindLabel(r.personKind),
    status: r.status,
    arrivalHow:
      r.arrivalMethod === "bus"
        ? (r.arrivalBusRunCode && busDisplayByCode.get(r.arrivalBusRunCode)) || "Bus"
        : arrivalMethodBadgeLabel(r.arrivalMethod),
    checkedInAt: r.checkedInAt,
    checkedOutAt: r.checkedOutAt,
  }));

  const visitorRows: EndOfDayVisitorRow[] = visitors.map((v: SiteDayVisitor) => ({
    id: v.id,
    displayName: v.displayName,
    kindLabel: visitorKindLabel(v.kind),
    arrivedAt: v.arrivedAt,
    leftAt: v.leftAt,
  }));

  const sortedIssues = sortByRygeOldestFirst(issues);

  return {
    sessionDate,
    generatedAt,
    session,
    openedByName: session.openedById
      ? resolveStaffDisplayName(session.openedById)
      : null,
    closedByName: session.closedById
      ? resolveStaffDisplayName(session.closedById)
      : null,
    arrived,
    absent,
    stillExpected,
    checkedOut,
    stillOnSite,
    meals,
    visitors: visitorRows,
    support: supportRows,
    issues: sortedIssues,
    counts: {
      expected: mapped.length,
      arrived: arrived.length,
      absent: absent.length,
      stillExpected: stillExpected.length,
      checkedOut: checkedOut.length,
      stillOnSite: stillOnSite.length,
      visitors: visitorRows.length,
      visitorsStillPresent: visitorRows.filter((v) => !v.leftAt).length,
      supportPresent: supportRows.filter((s) => s.status === "checked_in" || s.status === "checked_out").length,
      issuesRed: sortedIssues.filter((i) => i.severity === "red").length,
      issuesYellow: sortedIssues.filter((i) => i.severity === "yellow").length,
      issuesGreen: sortedIssues.filter((i) => i.severity === "green").length,
    },
  };
}

function buildMealBlock(
  act: SiteDayActivity,
  rows: MealRollSnapshot[],
  nameById: Map<string, string>,
  surnameMap: ReturnType<typeof surnameMapFromParticipants>,
): EndOfDayMealBlock {
  const people: EndOfDayMealPerson[] = sortByParticipantSurname(
    rows,
    (r) => r.participantId,
    surnameMap,
  ).map((r) => ({
    participantId: r.participantId,
    name: nameById.get(r.participantId) ?? r.participantId,
    status: r.status,
    statusLabel: MEAL_STATUS_LABELS[r.status] ?? r.status,
    notes: r.notes,
    updatedAt: r.updatedAt,
  }));

  const variations: EndOfDayMealVariation[] = MEAL_STATUS_ORDER.map((status) => {
    const group = people.filter((p) => p.status === status);
    return {
      status,
      label: MEAL_STATUS_LABELS[status],
      count: group.length,
      people: group,
    };
  }).filter((v) => v.count > 0);

  const slot = act.mealSlot as MealSlot | null;
  return {
    activityId: act.id,
    title: act.title,
    slotLabel: slot ? MEAL_SLOT_LABELS[slot] : act.title,
    sourceLabel: act.mealSource ? MEAL_SOURCE_LABELS[act.mealSource] : null,
    menuNotes: act.menuNotes,
    phase: act.phase,
    openedAt: act.openedAt,
    closedAt: act.closedAt,
    variations,
    total: people.length,
  };
}
