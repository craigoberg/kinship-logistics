import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  listActiveMedicationExceptions,
  listAllActiveSchedules,
  listTodaysComplianceLogs,
  listParticipants,
  listFailedClearancesWithItems,
  getTodayManifestSummary,
  type MedicationExceptionRow,
  type MedicationSchedule,
  type ComplianceLog,
  type Participant,
  type FailedClearanceReport,
  type TodayManifestSummary,
} from "@/lib/data-store";
import { formatDate } from "@/lib/utils";
import {
  listComplianceAssets,
  computeRyge,
  type ComplianceAsset,
  type ComplianceActionModule,
} from "@/lib/api/compliance-assets";
import { supabase } from "@/integrations/supabase/client";
import { getSydneyIsoDate } from "@/lib/operational-time";
import {
  operationalNowMs,
  useOperationalTodayIso,
} from "@/lib/operational-clock";

// Presence-gated medication alerts: dashboard must NOT surface a med
// exception for a participant who isn't physically in our custody. We
// load today's client_attendance_log once and only yield exceptions for
// participants whose attendance status is strictly 'checked_in'.
async function fetchTodaysCheckedInParticipants(): Promise<Set<string>> {
  const date = getSydneyIsoDate();
  const sessionRes = await supabase
    .from("site_day_sessions")
    .select("id")
    .eq("session_date", date)
    .maybeSingle();
  if (sessionRes.error) throw sessionRes.error;
  const sessionId = sessionRes.data?.id as string | undefined;
  if (!sessionId) return new Set();
  const logRes = await supabase
    .from("client_attendance_log")
    .select("participant_id, status")
    .eq("session_id", sessionId);
  if (logRes.error) throw logRes.error;
  const out = new Set<string>();
  for (const r of logRes.data ?? []) {
    const row = r as { participant_id: string | null; status: string | null };
    if (row.status === "checked_in" && row.participant_id) {
      out.add(row.participant_id);
    }
  }
  return out;
}

/**
 * Returns the set of participant IDs who are currently `checked_in` for
 * today's Day Centre session. Empty set when the session hasn't opened or
 * nobody has checked in yet.
 */
export function useTodaysCheckedInIds(): UseQueryResult<Set<string>> {
  const today = useOperationalTodayIso();
  return useQuery<Set<string>>({
    queryKey: ["today-checked-in-ids", today],
    queryFn: fetchTodaysCheckedInParticipants,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export type Severity = "critical" | "warning" | "info";

export type MedicationExceptionFeedRow = MedicationExceptionRow & { severity: Severity };

function severityForMedStatus(status: MedicationExceptionRow["status"]): Severity {
  if (status === "collected_damaged") return "critical";
  if (status === "expected_not_provided") return "warning";
  return "info";
}

export function useMedicationExceptions() {
  return useQuery<MedicationExceptionRow[], Error, MedicationExceptionFeedRow[]>({
    queryKey: ["exceptions", "medication-handover"],
    queryFn: () => listActiveMedicationExceptions(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    select: (rows) => rows.map((r) => ({ ...r, severity: severityForMedStatus(r.status) })),
  });
}

export interface PlaceholderRow {
  title: string;
  detail: string;
  severity: Severity;
}

export interface MedicationScheduleExceptionRow {
  key: string;
  participantId: string;
  participantName: string;
  medicationName: string;
  scheduledTime: string; // "HH:MM"
  title: string;
  detail: string;
  severity: Severity;
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}

function isAdministered(schedule: MedicationSchedule, logs: ComplianceLog[]): boolean {
  const target = schedule.medicationName.trim().toLowerCase();
  return logs.some((l) => {
    if (!l.participantId || l.participantId !== schedule.participantId) return false;
    const meta = (l.metadata ?? {}) as Record<string, unknown>;
    const name = String(meta.medication_name ?? "").trim().toLowerCase();
    return name === target;
  });
}

export function useMedicationScheduleExceptions() {
  const schedulesQ = useQuery({
    queryKey: ["all-active-schedules"],
    queryFn: () => listAllActiveSchedules(),
    staleTime: 30_000,
  });
  const logsQ = useQuery({
    queryKey: ["todays-compliance-logs"],
    queryFn: () => listTodaysComplianceLogs(),
    staleTime: 30_000,
  });
  const participantsQ = useQuery({
    queryKey: ["participants"],
    queryFn: () => listParticipants(),
    staleTime: 60_000,
  });
  // Presence gate — only participants currently checked in today qualify
  // for a dashboard medication alert. Absent/expected/checked-out are
  // silently suppressed; underlying medication records are untouched.
  const presenceQ = useQuery({
    queryKey: ["med-alerts-presence-gate", getSydneyIsoDate()],
    queryFn: () => fetchTodaysCheckedInParticipants(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const schedules: MedicationSchedule[] = schedulesQ.data ?? [];
  const logs: ComplianceLog[] = logsQ.data ?? [];
  const participants: Participant[] = participantsQ.data ?? [];
  const checkedIn: Set<string> = presenceQ.data ?? new Set();

  const rows = useMemo<MedicationScheduleExceptionRow[]>(() => {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const byId = new Map(participants.map((p) => [p.id, p]));

    return schedules
      .filter((s): s is MedicationSchedule & { participantId: string } => !!s.participantId)
      .map((s): MedicationScheduleExceptionRow | null => {
        // Presence gate — drop silently when not physically in custody.
        if (!checkedIn.has(s.participantId)) return null;
        if (isAdministered(s, logs)) return null;
        const scheduledTime = s.expectedTime.slice(0, 5);
        const scheduledMinutes = timeToMinutes(scheduledTime);
        const delta = scheduledMinutes - nowMinutes;
        let severity: Severity | null = null;
        let stateLabel = "";
        if (delta < 0) {
          severity = "critical";
          stateLabel = "OVERDUE";
        } else if (delta <= 60) {
          severity = "warning";
          stateLabel = "Due within 1 hour";
        }
        if (!severity) return null;
        const participantName = byId.get(s.participantId)?.fullName ?? "Unassigned participant";
        return {
          key: s.id,
          participantId: s.participantId,
          participantName,
          medicationName: s.medicationName,
          scheduledTime,
          title: `${participantName} · ${s.medicationName}`,
          detail: `${stateLabel} · scheduled ${scheduledTime}${s.dosage ? ` · ${s.dosage}` : ""}`,
          severity,
        };
      })
      .filter((r): r is MedicationScheduleExceptionRow => r !== null)
      .sort((a, b) => timeToMinutes(a.scheduledTime) - timeToMinutes(b.scheduledTime));
  }, [schedules, logs, participants, checkedIn]);

  return {
    data: rows,
    isLoading:
      schedulesQ.isLoading ||
      logsQ.isLoading ||
      participantsQ.isLoading ||
      presenceQ.isLoading,
  };
}


export const DAY_ANOMALY_PLACEHOLDERS: readonly PlaceholderRow[] = [
  {
    title: "Odometer mismatch",
    detail: "Logged by Driver Bill on HiAce Bus 2 — variance of 18 km",
    severity: "warning",
  },
  {
    title: "Minor vehicle scrape reported",
    detail: "Reported on the Saturday Night Disco run",
    severity: "warning",
  },
  {
    title: "Late return — bus parked after 22:30",
    detail: "End-of-day reconciliation pending coordinator review",
    severity: "info",
  },
] as const;


// Legacy useStaffCertificationExceptions / useVehicleMaintenanceExceptions
// have been decommissioned — both are now served by useComplianceExceptions()
// reading from the public.compliance_assets registry. See PROJECT_CONTEXT.md §10.


// ---------------------------------------------------------------------------
// START / END DAY ANOMALY — live vehicle clearance failures for today
// ---------------------------------------------------------------------------

export interface DayAnomalyRow {
  key: string;
  title: string;
  detail: string;
  severity: Severity;
  kind?: "hoist" | "other";
  participantId?: string;
  participantName?: string;
}

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function startOfToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const HOIST_HINT_RX = /hoist|wheelchair/i;

/**
 * Streams today's failed vehicle clearances into the dashboard's
 * Start/End Day Anomaly tile. Hoist failures are expanded into one row
 * per hoist-dependent passenger on today's manifest so coordinators can
 * trigger a per-passenger Split Manifest action.
 */
export function useStartEndDayAnomalies() {
  const date = todayDateStr();
  const q = useQuery<FailedClearanceReport[]>({
    queryKey: ["start-end-day-anomalies", date],
    queryFn: () => listFailedClearancesWithItems(date),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
  });
  const summaryQ = useQuery<TodayManifestSummary>({
    queryKey: ["today-manifest-summary", date],
    queryFn: () => getTodayManifestSummary(date),
    staleTime: 30_000,
  });

  const rows = useMemo<DayAnomalyRow[]>(() => {
    const reports = q.data ?? [];
    const hoistDeps = summaryQ.data?.hoistDependents ?? [];
    const out: DayAnomalyRow[] = [];
    for (const r of reports) {
      const label = r.assetRego ? `${r.assetName} (${r.assetRego})` : r.assetName;
      if (r.failedItems.length === 0) {
        out.push({
          key: r.clearance.id,
          title: `${label} — Clearance Failed`,
          detail: r.clearance.notes ?? "Driver flagged the vehicle as not cleared for service.",
          severity: "critical",
          kind: "other",
        });
        continue;
      }
      for (const item of r.failedItems) {
        const isHoist = HOIST_HINT_RX.test(item.checkpointLabel);
        if (isHoist && hoistDeps.length > 0) {
          for (const dep of hoistDeps) {
            out.push({
              key: `${r.clearance.id}:${item.id}:${dep.participantId}`,
              title: `${label} — ${dep.participantName} requires hoist`,
              detail: `Hoist fault on ${item.checkpointLabel}. ${dep.reason ? `Medical note: ${dep.reason}` : "Reroute to alternative transport."}`,
              severity: "critical",
              kind: "hoist",
              participantId: dep.participantId,
              participantName: dep.participantName,
            });
          }
        } else {
          out.push({
            key: `${r.clearance.id}:${item.id}`,
            title: `${label} — ${item.checkpointLabel}`,
            detail: item.notes?.trim()
              ? item.notes.trim()
              : item.isMandatory
                ? "Mandatory checkpoint failed — vehicle not cleared."
                : "Non-mandatory checkpoint flagged.",
            severity: item.isMandatory ? "critical" : "warning",
            kind: isHoist ? "hoist" : "other",
          });
        }
      }
    }
    return out;
  }, [q.data, summaryQ.data]);

  return { data: rows, isLoading: q.isLoading };
}

// ---------------------------------------------------------------------------
// COMPLIANCE GOVERNANCE — registry-driven feed for all expiring items.
// SQL: docs/sql/2026-07-06_compliance_governance.sql + backfill 2026-07-07.
// ---------------------------------------------------------------------------

export interface ComplianceExceptionRow {
  key: string;
  assetId: string;
  category: string;
  actionModule: ComplianceActionModule;
  title: string;
  detail: string;
  severity: Severity;
  daysDelta: number;
  asset: ComplianceAsset;
}

function rygeToSeverity(r: "red" | "yellow" | "green"): Severity | null {
  if (r === "red") return "critical";
  if (r === "yellow") return "warning";
  return null;
}

function complianceDetail(asset: ComplianceAsset, daysDelta: number): string {
  if (!asset.expiry_date) return asset.description ?? "Action required.";
  const human =
    daysDelta < 0
      ? `EXPIRED ${Math.abs(daysDelta)}d ago`
      : daysDelta === 0
        ? "Expires today"
        : `Expires in ${daysDelta}d`;
  return `${human} (${formatDate(asset.expiry_date ?? "")})`;
}

export function useComplianceExceptions() {
  const q = useQuery<ComplianceAsset[]>({
    queryKey: ["compliance-assets", "active"],
    queryFn: () => listComplianceAssets({ status: "active" }),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
  });

  const rows = useMemo<ComplianceExceptionRow[]>(() => {
    const assets = q.data ?? [];
    const today = startOfToday();
    const todayMs = today.getTime();
    const out: ComplianceExceptionRow[] = [];

    for (const a of assets) {
      const severity = rygeToSeverity(computeRyge(a, today));
      if (!severity) continue;
      let daysDelta = 9999;
      if (a.expiry_date) {
        const expiry = (() => {
          const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(a.expiry_date);
          if (!m) return null;
          return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        })();
        if (expiry) daysDelta = Math.round((expiry.getTime() - todayMs) / 86_400_000);
      }
      out.push({
        key: `compliance:${a.id}`,
        assetId: a.id,
        category: a.category,
        actionModule: a.action_module,
        title: a.name,
        detail: complianceDetail(a, daysDelta),
        severity,
        daysDelta,
        asset: a,
      });
    }
    out.sort((x, y) => x.daysDelta - y.daysDelta);
    return out;
  }, [q.data]);

  return { data: rows, isLoading: q.isLoading };
}

// ---------------------------------------------------------------------------
// MAINTENANCE TILE FEED — open items that have gone stale (no note activity).
//
// BL-066: tile turns yellow when last activity ≥ 7 days, red ≥ 14 days.
// Only stale items surface as exception rows; items within SLA are silent
// (tile stays green). Thresholds default to system_parameters values but
// can be overridden via the params argument.
// ---------------------------------------------------------------------------

export interface MaintenanceTileRow {
  key: string;
  title: string;
  detail: string;
  severity: Severity;
  daysSinceActivity: number;
}

async function fetchOpenMaintenanceForTile() {
  const { data, error } = await supabase
    .from("maintenance_items")
    .select("id, title, status, created_at, last_note_at, location_label")
    .in("status", ["open", "in_progress"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Array<{
    id: string;
    title: string;
    status: string;
    created_at: string;
    last_note_at: string | null;
    location_label: string | null;
  }>;
}

export function useMaintenanceTileFeed(params?: {
  /** Days without a note before tile turns yellow (default 7). */
  slaDays?: number;
  /** Days without a note before tile turns red (default 14). */
  redDays?: number;
}) {
  const slaDays = params?.slaDays ?? 7;
  const redDays = params?.redDays ?? 14;
  const slaMs  = slaDays * 86_400_000;
  const redMs  = redDays * 86_400_000;

  return useQuery({
    queryKey: ["maintenance-tile-feed"],
    queryFn: fetchOpenMaintenanceForTile,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    select: (rows) => {
      const now = operationalNowMs();
      const out: MaintenanceTileRow[] = [];
      for (const r of rows) {
        const activityAt = r.last_note_at ?? r.created_at;
        const ageMs = now - new Date(activityAt).getTime();
        if (ageMs < slaMs) continue;
        const daysSince = Math.floor(ageMs / 86_400_000);
        const severity: Severity = ageMs >= redMs ? "critical" : "warning";
        const loc = r.location_label ? ` · ${r.location_label}` : "";
        out.push({
          key: r.id,
          title: r.title,
          detail: `No update in ${daysSince}d${loc}`,
          severity,
          daysSinceActivity: daysSince,
        });
      }
      return out.sort((a, b) => b.daysSinceActivity - a.daysSinceActivity);
    },
  });
}

// ---------------------------------------------------------------------------
// COMPLIANCE CATEGORIES — one entry per unique category in compliance_assets.
//
// GUARDRAILS §5.1: "Adding a new compliance category … automatically registers
// the new rule into the Governance Hub without requiring application
// redeployment."
//
// Unlike useComplianceExceptions (yellow/red only), this hook returns an
// entry for EVERY active category so the dashboard renders a permanent tile
// per category. Green categories show an "all-clear" tile; yellow/red show a
// count badge and scroll to the drill table.
//
// Reuses the ["compliance-assets", "active"] query key — React Query
// deduplicates the network request when both hooks are mounted.
// ---------------------------------------------------------------------------

export interface ComplianceCategoryRow {
  category: string;
  /**
   * Yellow + red exception rows for this category sorted by daysDelta.
   * Empty array = all assets in this category are currently GREEN.
   */
  exceptionRows: ComplianceExceptionRow[];
}

function buildExceptionRow(
  a: ComplianceAsset,
  today: Date,
  todayMs: number,
): ComplianceExceptionRow | null {
  const severity = rygeToSeverity(computeRyge(a, today));
  if (!severity) return null;
  let daysDelta = 9999;
  if (a.expiry_date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(a.expiry_date);
    if (m) {
      const expiry = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      daysDelta = Math.round((expiry.getTime() - todayMs) / 86_400_000);
    }
  }
  return {
    key: `compliance:${a.id}`,
    assetId: a.id,
    category: a.category,
    actionModule: a.action_module,
    title: a.name,
    detail: complianceDetail(a, daysDelta),
    severity,
    daysDelta,
    asset: a,
  };
}

export function useComplianceCategories() {
  const q = useQuery<ComplianceAsset[]>({
    queryKey: ["compliance-assets", "active"],
    queryFn: () => listComplianceAssets({ status: "active" }),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
  });

  const data = useMemo<ComplianceCategoryRow[]>(() => {
    const assets = q.data ?? [];
    const today = startOfToday();
    const todayMs = today.getTime();

    // Group all active assets by category, collecting exception rows per group.
    const map = new Map<string, ComplianceExceptionRow[]>();
    for (const a of assets) {
      if (!map.has(a.category)) map.set(a.category, []);
      const row = buildExceptionRow(a, today, todayMs);
      if (row) map.get(a.category)!.push(row);
    }

    // Defined display order — categories not listed here sort alphabetically after.
    const CATEGORY_PRIORITY: Record<string, number> = {
      EQUIPMENT: 0,
      VEHICLE:   1,
      STAFF:     2,
      INSURANCE: 3,
      FACILITY:  4,
      VENUE:     5,
    };
    const priority = (cat: string) => CATEGORY_PRIORITY[cat] ?? 99;

    return Array.from(map.entries())
      .sort(([a], [b]) => priority(a) - priority(b) || a.localeCompare(b))
      .map(([category, exceptionRows]) => ({
        category,
        exceptionRows: exceptionRows.sort((x, y) => x.daysDelta - y.daysDelta),
      }));
  }, [q.data]);

  return { data, isLoading: q.isLoading };
}

// ---------------------------------------------------------------------------
// NO-SHOW / MISSING — clients who are overdue for today's Day Centre session.
//
// The attendance sweep already marks status = 'overdue' when expected_arrival_at
// passes without check-in. This tile just surfaces that count.
// Yellow: any overdue. Red: overdue AND expected_arrival_at was > redHours ago.
// ---------------------------------------------------------------------------

export interface NoShowTileRow {
  key: string;
  title: string;
  detail: string;
  severity: Severity;
}

async function fetchTodayOverdueAttendees(): Promise<
  Array<{ participant_id: string; expected_arrival_at: string; session_id: string }>
> {
  const date = getSydneyIsoDate();
  const sessionRes = await supabase
    .from("site_day_sessions")
    .select("id")
    .eq("session_date", date)
    .maybeSingle();
  if (sessionRes.error || !sessionRes.data) return [];
  const sessionId = sessionRes.data.id as string;
  const { data, error } = await supabase
    .from("client_attendance_log")
    .select("participant_id, expected_arrival_at, session_id")
    .eq("session_id", sessionId)
    .eq("status", "overdue");
  if (error) throw error;
  return (data ?? []) as Array<{
    participant_id: string;
    expected_arrival_at: string;
    session_id: string;
  }>;
}

export function useNoShowTileFeed(params?: { redHours?: number }) {
  const redHours = params?.redHours ?? 2;
  const redMs    = redHours * 3_600_000;

  const overdueQ = useQuery({
    queryKey: ["no-show-tile-feed", getSydneyIsoDate()],
    queryFn: fetchTodayOverdueAttendees,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const participantsQ = useQuery({
    queryKey: ["participants"],
    queryFn: () => listParticipants(),
    staleTime: 60_000,
  });

  const rows = useMemo<NoShowTileRow[]>(() => {
    const now = operationalNowMs();
    const byId = new Map((participantsQ.data ?? []).map((p) => [p.id, p]));
    return (overdueQ.data ?? []).map((r) => {
      const expectedMs  = new Date(r.expected_arrival_at).getTime();
      const overdueForMs = now - expectedMs;
      const overdueMin   = Math.floor(overdueForMs / 60_000);
      const severity: Severity = overdueForMs >= redMs ? "critical" : "warning";
      const name = byId.get(r.participant_id)?.fullName ?? "Unknown client";
      const expectedTime = r.expected_arrival_at.slice(11, 16);
      return {
        key: r.participant_id,
        title: name,
        detail: `Expected ${expectedTime} · overdue ${overdueMin} min`,
        severity,
      };
    });
  }, [overdueQ.data, participantsQ.data, redMs]);

  return {
    data: rows,
    isLoading: overdueQ.isLoading || participantsQ.isLoading,
  };
}

// ---------------------------------------------------------------------------
// ROLL CALL BREACH — multi-day event evening/morning roll has unaccounted
// participants past the deadline (+ optional grace window).
//
// Yellow: deadline passed, ≥1 person still 'expected' (not accounted/absent).
// Red: deadline + graceMinutes passed, still unaccounted.
// Only fires when there is an active multi-day event_day_session today.
// ---------------------------------------------------------------------------

export interface RollCallBreachRow {
  key: string;
  title: string;
  detail: string;
  severity: Severity;
}

async function fetchRollCallBreaches(graceMs: number): Promise<RollCallBreachRow[]> {
  const date = getSydneyIsoDate();
  const now = operationalNowMs();

  // Only multi-day sessions (have curfew_time or morning_roll_time set)
  const { data: sessions, error: sErr } = await supabase
    .from("event_day_sessions")
    .select("id, event_id, session_date, curfew_time, morning_roll_time, phase")
    .eq("session_date", date)
    .not("phase", "eq", "closed");
  if (sErr) throw sErr;
  if (!sessions || sessions.length === 0) return [];

  const out: RollCallBreachRow[] = [];

  for (const s of sessions as Array<{
    id: string; event_id: string; session_date: string;
    curfew_time: string | null; morning_roll_time: string | null; phase: string;
  }>) {
    // Build deadline timestamps for evening + morning rolls
    const checks: Array<{ label: string; deadlineMs: number; table: string }> = [];
    if (s.curfew_time) {
      const [hh, mm] = s.curfew_time.split(":").map(Number);
      const deadline = new Date(`${date}T${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:00`);
      checks.push({ label: "Evening roll call", deadlineMs: deadline.getTime(), table: "event_curfew_log" });
    }
    if (s.morning_roll_time) {
      const [hh, mm] = s.morning_roll_time.split(":").map(Number);
      const deadline = new Date(`${date}T${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:00`);
      checks.push({ label: "Morning roll call", deadlineMs: deadline.getTime(), table: "event_morning_log" });
    }

    for (const check of checks) {
      if (now < check.deadlineMs) continue; // deadline not yet reached

      // Count 'expected' (unaccounted) rows for this session
      const { count, error: cErr } = await supabase
        .from(check.table as "event_curfew_log" | "event_morning_log")
        .select("id", { count: "exact", head: true })
        .eq("event_day_session_id", s.id)
        .eq("status", "expected");
      if (cErr) continue;
      if (!count || count === 0) continue;

      const pastDeadlineMs = now - check.deadlineMs;
      const severity: Severity = pastDeadlineMs >= graceMs ? "critical" : "warning";
      const minsLate = Math.floor(pastDeadlineMs / 60_000);
      out.push({
        key: `${s.id}:${check.table}`,
        title: `${check.label} — ${count} unaccounted`,
        detail: `Deadline passed ${minsLate} min ago · Session ${s.session_date}`,
        severity,
      });
    }
  }

  return out;
}

export function useRollCallBreachFeed(params?: { graceMinutes?: number }) {
  const graceMs = (params?.graceMinutes ?? 30) * 60_000;
  return useQuery<RollCallBreachRow[]>({
    queryKey: ["roll-call-breach-feed", graceMs],
    queryFn: () => fetchRollCallBreaches(graceMs),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

// ---------------------------------------------------------------------------
// ACTIVE RED INCIDENTS — open RED issues from site_issues_register created
// today. Yellow: any open red today. Red: no Hub note for ≥ warnHours.
// ---------------------------------------------------------------------------

export interface ActiveRedIncidentRow {
  key: string;
  title: string;
  detail: string;
  severity: Severity;
}

async function fetchTodayOpenRedIssues(warnMs: number): Promise<ActiveRedIncidentRow[]> {
  const date = getSydneyIsoDate();
  const { data, error } = await supabase
    .from("site_issues_register")
    .select("id, issue_description, status, created_at")
    .eq("severity", "red")
    .in("status", ["open", "pending"])
    .gte("created_at", `${date}T00:00:00.000Z`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (!data || data.length === 0) return [];

  const ids = (data as Array<{ id: string }>).map((r) => r.id);

  // Latest hub note per issue (site_issues_register → day_centre | event)
  const { data: notes, error: notesErr } = await supabase
    .from("hub_issue_notes")
    .select("source_row_id, stamped_at")
    .in("source", ["day_centre", "event"])
    .in("source_row_id", ids)
    .order("stamped_at", { ascending: false });
  if (notesErr) {
    console.warn("[exception-feed] hub notes for active RED failed", notesErr);
  }

  const latestNote = new Map<string, string>();
  for (const n of (notes ?? []) as Array<{ source_row_id: string; stamped_at: string }>) {
    if (!latestNote.has(n.source_row_id)) latestNote.set(n.source_row_id, n.stamped_at);
  }

  const now = operationalNowMs();
  return (data as Array<{ id: string; issue_description: string; created_at: string }>).map((r) => {
    const lastAt   = latestNote.get(r.id) ?? r.created_at;
    const silentMs = now - new Date(lastAt).getTime();
    const severity: Severity = silentMs >= warnMs ? "critical" : "warning";
    const minsAgo  = Math.floor((now - new Date(r.created_at).getTime()) / 60_000);
    return {
      key: r.id,
      title: String(r.issue_description ?? "RED incident").slice(0, 100),
      detail: `Logged ${minsAgo} min ago${latestNote.has(r.id) ? "" : " · no Hub update yet"}`,
      severity,
    };
  });
}

export function useActiveRedIncidentsFeed(params?: { warnHours?: number }) {
  const warnMs = (params?.warnHours ?? 24) * 3_600_000;
  return useQuery<ActiveRedIncidentRow[]>({
    queryKey: ["active-red-incidents-feed", getSydneyIsoDate()],
    queryFn: () => fetchTodayOpenRedIssues(warnMs),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

// ---------------------------------------------------------------------------
// HUB HUMAN INCIDENTS (STALE) — open issues across all time that have had
// no Hub note activity for ≥ warnHours (yellow) or ≥ redHours (red).
// Excludes today's issues (those surface in Active RED Incidents above).
// ---------------------------------------------------------------------------

export interface HubHumanIncidentRow {
  key: string;
  title: string;
  detail: string;
  severity: Severity;
  daysSinceActivity: number;
}

async function fetchStaleHubIssues(
  warnMs: number,
  redMs: number,
): Promise<HubHumanIncidentRow[]> {
  const date = getSydneyIsoDate();

  // Open issues older than today (today's reds are in Active RED tile)
  const { data, error } = await supabase
    .from("site_issues_register")
    .select("id, issue_description, severity, status, created_at")
    .in("status", ["open", "pending", "awaiting_external"])
    .lt("created_at", `${date}T00:00:00.000Z`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (!data || data.length === 0) return [];

  const ids = (data as Array<{ id: string }>).map((r) => r.id);

  // Latest hub note per issue (site_issues_register → day_centre | event)
  const { data: notes, error: notesErr } = await supabase
    .from("hub_issue_notes")
    .select("source_row_id, stamped_at")
    .in("source", ["day_centre", "event"])
    .in("source_row_id", ids)
    .order("stamped_at", { ascending: false });
  if (notesErr) {
    console.warn("[exception-feed] hub notes for stale Hub failed", notesErr);
  }

  const latestNote = new Map<string, string>();
  for (const n of (notes ?? []) as Array<{ source_row_id: string; stamped_at: string }>) {
    if (!latestNote.has(n.source_row_id)) latestNote.set(n.source_row_id, n.stamped_at);
  }

  const now = operationalNowMs();
  const out: HubHumanIncidentRow[] = [];

  for (const r of data as Array<{
    id: string; issue_description: string; severity: string; created_at: string;
  }>) {
    const lastAt    = latestNote.get(r.id) ?? r.created_at;
    const silentMs  = now - new Date(lastAt).getTime();
    if (silentMs < warnMs) continue; // within SLA — silent
    const daysSince = Math.floor(silentMs / 86_400_000);
    const severity: Severity = silentMs >= redMs ? "critical" : "warning";
    out.push({
      key: r.id,
      title: String(r.issue_description ?? "Open issue").slice(0, 100),
      detail: `No Hub update in ${daysSince}d · ${String(r.severity ?? "").toUpperCase()}`,
      severity,
      daysSinceActivity: daysSince,
    });
  }

  return out.sort((a, b) => b.daysSinceActivity - a.daysSinceActivity);
}

export function useHubHumanIncidentsFeed(params?: {
  warnHours?: number;
  redHours?: number;
}) {
  const warnMs = (params?.warnHours ?? 24) * 3_600_000;
  const redMs  = (params?.redHours  ?? 48) * 3_600_000;
  return useQuery<HubHumanIncidentRow[]>({
    queryKey: ["hub-human-incidents-feed", warnMs, redMs],
    queryFn: () => fetchStaleHubIssues(warnMs, redMs),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

// ---------------------------------------------------------------------------
// BL-084 Phase A — active infectious exclusions (Health & Safety tile)
// ---------------------------------------------------------------------------

export interface InfectiousExclusionFeedRow {
  key: string;
  title: string;
  detail: string;
  severity: Severity;
  hubIssueId: string | null;
}

export function useInfectiousExclusionsFeed() {
  return useQuery<InfectiousExclusionFeedRow[]>({
    queryKey: ["infectious-exclusions-active"],
    queryFn: async () => {
      const { listActiveInfectiousExclusions, INFECTION_CATEGORY_LABELS } =
        await import("@/lib/api/infectious-exclusion");
      const rows = await listActiveInfectiousExclusions();
      return rows.map((r) => {
        const scope = [
          r.excludeCentre ? "Centre" : null,
          r.excludeTrips ? "Trips" : null,
        ]
          .filter(Boolean)
          .join(" + ");
        return {
          key: r.id,
          title: r.participantName ?? "Participant",
          detail: `${INFECTION_CATEGORY_LABELS[r.category]} · excluded from ${scope} since ${r.excludedFrom}`,
          severity: "warning" as Severity,
          hubIssueId: r.hubIssueId,
        };
      });
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

// BL-084 Phase B+C — active emergencies + site lockdown / programme suspend
export interface OperationalEmergencyFeedRow {
  key: string;
  title: string;
  detail: string;
  severity: Severity;
  hubIssueId: string | null;
}

export function useOperationalEmergencyFeed() {
  return useQuery<OperationalEmergencyFeedRow[]>({
    queryKey: ["operational-emergencies-hub-feed"],
    queryFn: async () => {
      const { listActiveEmergencies } = await import(
        "@/lib/api/operational-emergency"
      );
      const { supabase } = await import("@/integrations/supabase/client");
      const out: OperationalEmergencyFeedRow[] = [];

      // Active Drill/Live only — stood-down tickets stay in Governance Active,
      // they must not keep flashing the home Emergency tile.
      const emergencies = await listActiveEmergencies();
      for (const e of emergencies) {
        const mode = e.mode === "drill" ? "DRILL" : "LIVE";
        out.push({
          key: `emg-${e.id}`,
          title: `${mode} emergency · ${e.severity}`,
          detail: e.situationText,
          severity: e.severity === "red" ? "critical" : "warning",
          hubIssueId: e.hubIssueId,
        });
      }

      const { data: lockdownSessions } = await supabase
        .from("site_day_sessions")
        .select("id, lockdown_reason, lockdown_severity, lockdown_hub_issue_id, session_date")
        .eq("lockdown_active", true)
        .limit(20);
      for (const s of lockdownSessions ?? []) {
        const row = s as {
          id: string;
          lockdown_reason?: string | null;
          lockdown_severity?: string | null;
          lockdown_hub_issue_id?: string | null;
          session_date?: string;
        };
        out.push({
          key: `lock-${row.id}`,
          title: `Centre lockdown · ${row.session_date ?? ""}`.trim(),
          detail: row.lockdown_reason ?? "Lockdown / early close",
          severity: row.lockdown_severity === "red" ? "critical" : "warning",
          hubIssueId: row.lockdown_hub_issue_id ?? null,
        });
      }

      const { data: suspendedDays } = await supabase
        .from("event_day_sessions")
        .select(
          "id, programme_suspend_reason, programme_suspend_severity, programme_suspend_hub_issue_id, session_date",
        )
        .eq("programme_suspended", true)
        .limit(20);
      for (const s of suspendedDays ?? []) {
        const row = s as {
          id: string;
          programme_suspend_reason?: string | null;
          programme_suspend_severity?: string | null;
          programme_suspend_hub_issue_id?: string | null;
          session_date?: string;
        };
        out.push({
          key: `suspend-${row.id}`,
          title: `Programme suspended · ${row.session_date ?? ""}`.trim(),
          detail: row.programme_suspend_reason ?? "Programme on hold",
          severity:
            row.programme_suspend_severity === "red" ? "critical" : "warning",
          hubIssueId: row.programme_suspend_hub_issue_id ?? null,
        });
      }

      // Open do-not-open Hub tickets only while the session is still closed_no_go
      // (not stood-down Drill/Live reviews).
      const { data: doNotOpen } = await supabase
        .from("site_issues_register")
        .select("id, issue_description, severity, status, session_id")
        .eq("status", "open")
        .eq("issue_area", "health_safety")
        .ilike("issue_description", "%[SITE DO-NOT-OPEN]%")
        .limit(20);
      for (const i of doNotOpen ?? []) {
        const row = i as {
          id: string;
          issue_description?: string;
          severity?: string;
        };
        if (out.some((r) => r.hubIssueId === row.id)) continue;
        out.push({
          key: `hs-dno-${row.id}`,
          title: (row.issue_description ?? "Do not open").slice(0, 80),
          detail: "Centre not opened — Hub Health & Safety",
          severity: row.severity === "red" ? "critical" : "warning",
          hubIssueId: row.id,
        });
      }

      return out;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

