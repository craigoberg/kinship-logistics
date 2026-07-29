/**
 * Shared Day Centre medication-round status (TodaysMedicationCard + Activities).
 * Amber = within 60 min of due; Red = >15 min past due (same thresholds as floor card).
 */
import type { ComplianceLog, MedicationSchedule, Participant } from "@/lib/data-store";
import { resolveOperationalNow } from "@/lib/operational-time";

export type MedicationRoundStatus = "administered" | "amber" | "red" | "future";

export type MedicationRoundRow = {
  schedule: MedicationSchedule;
  participant: Participant | undefined;
  scheduledMinutes: number;
  status: MedicationRoundStatus;
  administeredLog?: ComplianceLog;
};

export type MedicationRoundUrgency = "none" | "ok" | "amber" | "red";

export type MedicationRoundSummary = {
  rows: MedicationRoundRow[];
  /** Schedules still needing an administration log. */
  outstandingCount: number;
  redCount: number;
  amberCount: number;
  /** Worst open urgency for the activity chrome (ignores administered). */
  urgency: MedicationRoundUrgency;
  /** True only when presence + schedules are known and every dose is logged. */
  allManaged: boolean;
};

export function operationalNowMinutes(now: Date = resolveOperationalNow()): number {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hh * 60 + mm;
}

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}

/** PRN / as-needed — shown on board but does not block Complete or drive RYG. */
export function isPrnSchedule(frequency: string | null | undefined): boolean {
  return (frequency ?? "").toLowerCase().includes("prn");
}

export function findAdministrationLog(
  schedule: MedicationSchedule,
  logs: ComplianceLog[],
): ComplianceLog | undefined {
  const target = schedule.medicationName.trim().toLowerCase();
  return logs.find((l) => {
    if (!l.participantId || l.participantId !== schedule.participantId) return false;
    const meta = l.metadata as Record<string, unknown>;
    const name = String(meta.medication_name ?? "").trim().toLowerCase();
    return name === target;
  });
}

export function buildMedicationRoundRows(args: {
  schedules: MedicationSchedule[];
  logs: ComplianceLog[];
  checkedInIds: Set<string>;
  participantById: Map<string, Participant>;
  nowMinutes?: number;
}): MedicationRoundRow[] {
  const nowMinutes = args.nowMinutes ?? operationalNowMinutes();
  return args.schedules
    .filter((s): s is MedicationSchedule & { participantId: string } => !!s.participantId)
    .filter((s) => args.checkedInIds.has(s.participantId))
    .map<MedicationRoundRow>((s) => {
      const participant = args.participantById.get(s.participantId);
      const log = findAdministrationLog(s, args.logs);
      const scheduledMinutes = timeToMinutes(s.expectedTime.slice(0, 5));
      const prn = isPrnSchedule(s.frequency);
      let status: MedicationRoundStatus;
      if (log) status = "administered";
      else if (prn) status = "future"; // as-needed — no clock RYG
      else if (nowMinutes > scheduledMinutes + 15) status = "red";
      else if (nowMinutes >= scheduledMinutes - 60) status = "amber";
      else status = "future";
      return {
        schedule: s,
        participant,
        scheduledMinutes,
        status,
        administeredLog: log,
      };
    })
    .sort((a, b) => {
      const order = { red: 0, amber: 1, future: 2, administered: 3 } as const;
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return a.scheduledMinutes - b.scheduledMinutes;
    });
}

export function summarizeMedicationRound(
  rows: MedicationRoundRow[],
): Omit<MedicationRoundSummary, "rows"> {
  // PRN does not block Complete (timed round only).
  const outstanding = rows.filter(
    (r) =>
      r.status !== "administered" && !isPrnSchedule(r.schedule.frequency),
  );
  const redCount = outstanding.filter((r) => r.status === "red").length;
  const amberCount = outstanding.filter((r) => r.status === "amber").length;
  let urgency: MedicationRoundUrgency = "none";
  if (rows.length === 0) urgency = "none";
  else if (redCount > 0) urgency = "red";
  else if (amberCount > 0) urgency = "amber";
  else if (outstanding.length > 0) urgency = "ok";
  else urgency = "none";

  return {
    outstandingCount: outstanding.length,
    redCount,
    amberCount,
    urgency,
    allManaged: outstanding.length === 0,
  };
}

/** Server/UI guard: throw if any checked-in schedule lacks today's admin log. */
export function assertMedicationRoundManaged(args: {
  schedules: MedicationSchedule[];
  logs: ComplianceLog[];
  checkedInIds: Set<string>;
}): void {
  const rows = buildMedicationRoundRows({
    schedules: args.schedules,
    logs: args.logs,
    checkedInIds: args.checkedInIds,
    participantById: new Map(),
  });
  const outstanding = rows.filter(
    (r) =>
      r.status !== "administered" && !isPrnSchedule(r.schedule.frequency),
  );
  if (outstanding.length === 0) return;
  const names = outstanding
    .slice(0, 3)
    .map((r) => r.schedule.medicationName)
    .join(", ");
  throw new Error(
    `Medication round still has ${outstanding.length} outstanding dose${
      outstanding.length === 1 ? "" : "s"
    }${names ? ` (${names}${outstanding.length > 3 ? "…" : ""})` : ""}.`,
  );
}
