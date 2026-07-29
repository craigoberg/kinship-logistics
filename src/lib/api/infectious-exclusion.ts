/**
 * BL-084 Phase A / A.1 — infectious exclusion + home-safe + return-to-care.
 * Manager-only declare; Hub clearance later. Dual entry: Day Centre + Event Deliver.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  insertAttendanceLog,
  resolveStaffIdWithFallback,
  type AttendanceStatus,
} from "@/lib/data-store";
import { createIssue, markResolved } from "@/lib/api/site-issues";
import { writeToLedger, tryGetGps } from "@/lib/api/ledger";
import { getSydneyIsoDate } from "@/lib/operational-time";
import { operationalNowIso } from "@/lib/operational-clock";
import type { UnifiedIssue } from "@/lib/api/unified-issues";
import { resolveUnifiedIssue } from "@/lib/api/unified-issues";
import {
  checkOutParticipant,
  listAttendanceRoll,
  type DepartureVector,
} from "@/lib/api/client-attendance";
import { releaseEventParticipantInfectiousHome } from "@/lib/api/event-attendance";

export type InfectionCategory =
  | "respiratory"
  | "gi"
  | "skin_parasite"
  | "other";

export type ClearanceMethod = "carer_attestation" | "medical_cert";

/** Outcome class for leaving care — not a logistics plan. */
export type HomeSafeDisposition =
  | "family_carer"
  | "staff_escorted"
  | "transport_taxi"
  | "other";

export const INFECTION_CATEGORY_LABELS: Record<InfectionCategory, string> = {
  respiratory: "Respiratory (cold / flu / COVID-like)",
  gi: "Gastrointestinal",
  skin_parasite: "Skin / parasite (e.g. scabies)",
  other: "Other infectious / notifiable",
};

export const HOME_SAFE_DISPOSITIONS: {
  value: HomeSafeDisposition;
  label: string;
  subtitle: string;
}[] = [
  {
    value: "family_carer",
    label: "Family / carer",
    subtitle: "Collected or met by family / carer",
  },
  {
    value: "staff_escorted",
    label: "Staff escorted",
    subtitle: "Staff took them home / to meeting point",
  },
  {
    value: "transport_taxi",
    label: "Transport / taxi",
    subtitle: "Bus drop, taxi, Uber, etc.",
  },
  {
    value: "other",
    label: "Other",
    subtitle: "Describe in note",
  },
];

export const HOME_SAFE_DISPOSITION_LABELS: Record<HomeSafeDisposition, string> =
  Object.fromEntries(
    HOME_SAFE_DISPOSITIONS.map((d) => [d.value, d.label]),
  ) as Record<HomeSafeDisposition, string>;

/** Categories where a medical certificate is recommended (still allow attestation). */
export const CERT_RECOMMENDED_CATEGORIES = new Set<InfectionCategory>([
  "skin_parasite",
  "other",
]);

function dispositionToCentreVector(d: HomeSafeDisposition): DepartureVector {
  if (d === "family_carer") return "family";
  if (d === "transport_taxi") return "bus";
  return "independent";
}

export interface InfectiousExclusion {
  id: string;
  participantId: string;
  participantName: string | null;
  category: InfectionCategory;
  notes: string | null;
  excludeCentre: boolean;
  excludeTrips: boolean;
  excludedFrom: string;
  status: "active" | "cleared";
  hubIssueId: string | null;
  siteDaySessionId: string | null;
  eventId: string | null;
  eventDaySessionId: string | null;
  declaredByStaffId: string;
  declaredAt: string;
  homeSafeDisposition: HomeSafeDisposition | null;
  homeSafeHandoverTo: string | null;
  homeSafeNote: string | null;
  homeSafeAt: string | null;
  homeSafeByStaffId: string | null;
  clearanceMethod: ClearanceMethod | null;
  clearanceNote: string | null;
  evidenceRef: string | null;
  clearedByStaffId: string | null;
  clearedAt: string | null;
}

interface ExclusionRow {
  id: string;
  participant_id: string;
  category: string;
  notes: string | null;
  exclude_centre: boolean;
  exclude_trips: boolean;
  excluded_from: string;
  status: string;
  hub_issue_id: string | null;
  site_day_session_id: string | null;
  event_id?: string | null;
  event_day_session_id?: string | null;
  declared_by_staff_id: string;
  declared_at: string;
  home_safe_disposition?: string | null;
  home_safe_handover_to?: string | null;
  home_safe_note?: string | null;
  home_safe_at?: string | null;
  home_safe_by_staff_id?: string | null;
  clearance_method: string | null;
  clearance_note: string | null;
  evidence_ref: string | null;
  cleared_by_staff_id: string | null;
  cleared_at: string | null;
  participants?: {
    first_name?: string | null;
    last_name?: string | null;
  } | null;
}

function rowToExclusion(r: ExclusionRow): InfectiousExclusion {
  const p = r.participants;
  const name =
    `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || null;
  return {
    id: r.id,
    participantId: r.participant_id,
    participantName: name,
    category: r.category as InfectionCategory,
    notes: r.notes,
    excludeCentre: r.exclude_centre,
    excludeTrips: r.exclude_trips,
    excludedFrom: r.excluded_from,
    status: r.status as "active" | "cleared",
    hubIssueId: r.hub_issue_id,
    siteDaySessionId: r.site_day_session_id,
    eventId: r.event_id ?? null,
    eventDaySessionId: r.event_day_session_id ?? null,
    declaredByStaffId: r.declared_by_staff_id,
    declaredAt: r.declared_at,
    homeSafeDisposition:
      (r.home_safe_disposition as HomeSafeDisposition | null) ?? null,
    homeSafeHandoverTo: r.home_safe_handover_to ?? null,
    homeSafeNote: r.home_safe_note ?? null,
    homeSafeAt: r.home_safe_at ?? null,
    homeSafeByStaffId: r.home_safe_by_staff_id ?? null,
    clearanceMethod: (r.clearance_method as ClearanceMethod | null) ?? null,
    clearanceNote: r.clearance_note,
    evidenceRef: r.evidence_ref,
    clearedByStaffId: r.cleared_by_staff_id,
    clearedAt: r.cleared_at,
  };
}

export async function listActiveInfectiousExclusions(): Promise<InfectiousExclusion[]> {
  const { data, error } = await supabase
    .from("participant_infectious_exclusions")
    .select("*, participants(first_name, last_name)")
    .eq("status", "active")
    .order("declared_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => rowToExclusion(r as ExclusionRow));
}

export async function getActiveExclusionForParticipant(
  participantId: string,
): Promise<InfectiousExclusion | null> {
  const { data, error } = await supabase
    .from("participant_infectious_exclusions")
    .select("*, participants(first_name, last_name)")
    .eq("participant_id", participantId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data ? rowToExclusion(data as ExclusionRow) : null;
}

export async function getExclusionByHubIssueId(
  hubIssueId: string,
): Promise<InfectiousExclusion | null> {
  const { data, error } = await supabase
    .from("participant_infectious_exclusions")
    .select("*, participants(first_name, last_name)")
    .eq("hub_issue_id", hubIssueId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToExclusion(data as ExclusionRow) : null;
}

/** Throws when an active exclusion blocks centre or trips check-in. */
export async function assertNotInfectiousExcluded(
  participantId: string,
  scope: "centre" | "trips",
): Promise<void> {
  const exclusion = await getActiveExclusionForParticipant(participantId);
  if (!exclusion) return;
  if (scope === "centre" && exclusion.excludeCentre) {
    throw new Error(
      "Infectious exclusion active — Day Centre check-in blocked until manager clearance in Hub.",
    );
  }
  if (scope === "trips" && exclusion.excludeTrips) {
    throw new Error(
      "Infectious exclusion active — trip check-in blocked until manager clearance in Hub.",
    );
  }
}

export type InfectiousSurface = "centre" | "trip";

export interface InfectiousInCareState {
  inCare: boolean;
  surface: InfectiousSurface | null;
  attendanceId: string | null;
}

/**
 * Whether the participant is currently in our care on this surface
 * (checked_in on Day Centre or trip day floor).
 */
export async function getInfectiousInCareState(opts: {
  participantId: string;
  surface: InfectiousSurface;
  siteDaySessionId?: string | null;
  eventDaySessionId?: string | null;
}): Promise<InfectiousInCareState> {
  if (opts.surface === "centre") {
    if (!opts.siteDaySessionId) {
      return { inCare: false, surface: null, attendanceId: null };
    }
    const roll = await listAttendanceRoll(opts.siteDaySessionId);
    const row = roll.find(
      (r) => r.participantId === opts.participantId && r.status === "checked_in",
    );
    return row
      ? { inCare: true, surface: "centre", attendanceId: row.id }
      : { inCare: false, surface: "centre", attendanceId: null };
  }

  if (!opts.eventDaySessionId) {
    return { inCare: false, surface: null, attendanceId: null };
  }
  const { data, error } = await supabase
    .from("event_attendance_log")
    .select("id, status")
    .eq("event_day_session_id", opts.eventDaySessionId)
    .eq("participant_id", opts.participantId)
    .maybeSingle();
  if (error) throw error;
  const status = (data as { id: string; status: string } | null)?.status;
  if (status === "checked_in" && data) {
    return {
      inCare: true,
      surface: "trip",
      attendanceId: (data as { id: string }).id,
    };
  }
  return { inCare: false, surface: "trip", attendanceId: null };
}

export interface HomeSafeAttestation {
  disposition: HomeSafeDisposition;
  handoverTo: string;
  note?: string | null;
}

export interface DeclareInfectiousExclusionInput {
  participantId: string;
  participantName: string;
  category: InfectionCategory;
  notes: string;
  excludeCentre: boolean;
  excludeTrips: boolean;
  surface: InfectiousSurface;
  siteDaySessionId?: string | null;
  eventId?: string | null;
  eventDaySessionId?: string | null;
  /**
   * Required when participant is checked_in on this surface.
   * Attests they have left our care safely (outcome class, not route plan).
   */
  homeSafe?: HomeSafeAttestation | null;
}

/**
 * Manager-declared exclusion: Hub Health & Safety issue + register row
 * + optional Sick attendance + optional home-safe floor release when in care.
 */
export async function declareInfectiousExclusion(
  input: DeclareInfectiousExclusionInput,
): Promise<InfectiousExclusion> {
  if (!input.excludeCentre && !input.excludeTrips) {
    throw new Error("Select at least Centre or Trips exclusion.");
  }
  const existing = await getActiveExclusionForParticipant(input.participantId);
  if (existing) {
    throw new Error(
      `${input.participantName} already has an active infectious exclusion — clear it first.`,
    );
  }

  const inCare = await getInfectiousInCareState({
    participantId: input.participantId,
    surface: input.surface,
    siteDaySessionId: input.siteDaySessionId,
    eventDaySessionId: input.eventDaySessionId,
  });

  if (inCare.inCare) {
    if (!input.homeSafe?.disposition) {
      throw new Error(
        "They are currently in care — record how they left (home safe) before declaring.",
      );
    }
    const handover = input.homeSafe.handoverTo.trim();
    if (handover.length < 6) {
      throw new Error("Who has them now must be at least 6 characters.");
    }
  }

  const staffId = await resolveStaffIdWithFallback();
  const today = getSydneyIsoDate();
  const catLabel = INFECTION_CATEGORY_LABELS[input.category];
  const scope = [
    input.excludeCentre ? "Centre" : null,
    input.excludeTrips ? "Trips" : null,
  ]
    .filter(Boolean)
    .join(" + ");

  let homeSafeSuffix = "";
  if (inCare.inCare && input.homeSafe) {
    const dLabel =
      HOME_SAFE_DISPOSITION_LABELS[input.homeSafe.disposition] ??
      input.homeSafe.disposition;
    homeSafeSuffix =
      ` Home safe: ${dLabel}; handover to ${input.homeSafe.handoverTo.trim()}.` +
      (input.homeSafe.note?.trim()
        ? ` ${input.homeSafe.note.trim()}`
        : "");
  }

  const description =
    `[HEALTH & SAFETY][INFECTIOUS EXCLUSION] ${input.participantName} — ${catLabel}. ` +
    `Excluded from: ${scope} from ${today}.` +
    homeSafeSuffix +
    (input.notes.trim() ? ` Notes: ${input.notes.trim()}` : "");

  const workaround =
    `Return only after manager clearance (carer attestation or medical certificate). ` +
    (CERT_RECOMMENDED_CATEGORIES.has(input.category)
      ? "Medical certificate recommended for this category."
      : "Carer attestation may be sufficient if auditor/policy allows.");

  const issue = await createIssue({
    sessionId: input.siteDaySessionId ?? null,
    eventId: input.eventId ?? null,
    eventDaySessionId: input.eventDaySessionId ?? null,
    severity: "yellow",
    issueDescription: description,
    workaroundPlan: workaround,
    owner: "internal",
    issueArea: "health_safety",
  });

  const now = operationalNowIso();
  // Base columns only from Phase A. Trip/home-safe columns (A.1) are omitted
  // when unused so declare still works if …_home_safe.sql is not applied yet.
  const insertPayload: Record<string, unknown> = {
    participant_id: input.participantId,
    category: input.category,
    notes: input.notes.trim() || null,
    exclude_centre: input.excludeCentre,
    exclude_trips: input.excludeTrips,
    excluded_from: today,
    status: "active",
    hub_issue_id: issue.id,
    declared_by_staff_id: staffId,
    declared_at: now,
  };
  if (input.siteDaySessionId) {
    insertPayload.site_day_session_id = input.siteDaySessionId;
  }
  if (input.eventId) {
    insertPayload.event_id = input.eventId;
  }
  if (input.eventDaySessionId) {
    insertPayload.event_day_session_id = input.eventDaySessionId;
  }
  if (inCare.inCare && input.homeSafe) {
    insertPayload.home_safe_disposition = input.homeSafe.disposition;
    insertPayload.home_safe_handover_to = input.homeSafe.handoverTo.trim();
    insertPayload.home_safe_note = input.homeSafe.note?.trim() || null;
    insertPayload.home_safe_at = now;
    insertPayload.home_safe_by_staff_id = staffId;
  }

  const { data, error } = await supabase
    .from("participant_infectious_exclusions")
    .insert(insertPayload)
    .select("*, participants(first_name, last_name)")
    .single();
  if (error) {
    // Avoid orphan Hub tickets when exclusion insert fails (e.g. A.1 SQL not loaded).
    try {
      await markResolved(issue.id);
    } catch {
      /* best-effort */
    }
    const msg = error.message ?? "";
    if (
      /home_safe_|event_day_session_id|event_id/i.test(msg) ||
      error.code === "PGRST204" ||
      error.code === "42703"
    ) {
      throw new Error(
        "Database is missing the home-safe / trip columns. Run docs/sql/2026-07-27_infectious_exclusion_home_safe.sql, then try again.",
      );
    }
    throw error;
  }

  // Floor release when in care (centre checkout / trip absent) — no second Hub ticket.
  if (inCare.inCare && input.homeSafe) {
    try {
      if (input.surface === "centre" && input.siteDaySessionId) {
        const roll = await listAttendanceRoll(input.siteDaySessionId);
        const row = roll.find(
          (r) =>
            r.participantId === input.participantId && r.status === "checked_in",
        );
        if (row) {
          await checkOutParticipant(
            row,
            dispositionToCentreVector(input.homeSafe.disposition),
          );
        }
      } else if (input.surface === "trip" && input.eventDaySessionId) {
        await releaseEventParticipantInfectiousHome({
          eventDaySessionId: input.eventDaySessionId,
          participantId: input.participantId,
          disposition: input.homeSafe.disposition,
          handoverTo: input.homeSafe.handoverTo,
          note: input.homeSafe.note,
        });
      }
    } catch (err) {
      console.error("[infectious-exclusion] home-safe floor release failed", err);
      throw new Error(
        `Exclusion recorded, but home-safe floor release failed: ${(err as Error).message}`,
      );
    }
  }

  if (input.excludeCentre) {
    try {
      await insertAttendanceLog({
        participantId: input.participantId,
        scheduleId: null,
        rosterDate: today,
        expectedService: "Day Centre",
        actualStatus: "Sick" as AttendanceStatus,
        driverNotes: `[INFECTIOUS EXCLUSION] ${catLabel}. ${input.notes.trim()}`.slice(
          0,
          500,
        ),
      });
    } catch (err) {
      console.warn("[infectious-exclusion] attendance Sick log failed", err);
    }
  }

  try {
    const gps = await tryGetGps();
    await writeToLedger({
      staff_id: staffId,
      category: "CENTRE",
      severity: "YELLOW",
      action_type: "health.infectious_exclusion_declared",
      gps_lat: gps?.lat ?? null,
      gps_lng: gps?.lng ?? null,
      metadata: {
        exclusion_id: (data as ExclusionRow).id,
        participant_id: input.participantId,
        hub_issue_id: issue.id,
        category: input.category,
        exclude_centre: input.excludeCentre,
        exclude_trips: input.excludeTrips,
        surface: input.surface,
        home_safe: inCare.inCare,
        home_safe_disposition: input.homeSafe?.disposition ?? null,
      },
    });
  } catch (err) {
    console.error("[infectious-exclusion] ledger failed", err);
  }

  return rowToExclusion(data as ExclusionRow);
}

export interface ClearInfectiousExclusionInput {
  exclusionId: string;
  method: ClearanceMethod;
  clearanceNote: string;
  evidenceRef?: string | null;
}

export async function clearInfectiousExclusion(
  input: ClearInfectiousExclusionInput,
): Promise<InfectiousExclusion> {
  const staffId = await resolveStaffIdWithFallback();
  const note = input.clearanceNote.trim();
  if (note.length < 10) {
    throw new Error("Clearance note must be at least 10 characters.");
  }

  const { data: prior, error: priorErr } = await supabase
    .from("participant_infectious_exclusions")
    .select("*, participants(first_name, last_name)")
    .eq("id", input.exclusionId)
    .single();
  if (priorErr) throw priorErr;
  const row = prior as ExclusionRow;
  if (row.status !== "active") {
    throw new Error("This exclusion is already cleared.");
  }

  const now = operationalNowIso();
  const { data, error } = await supabase
    .from("participant_infectious_exclusions")
    .update({
      status: "cleared",
      clearance_method: input.method,
      clearance_note: note,
      evidence_ref: input.evidenceRef?.trim() || null,
      cleared_by_staff_id: staffId,
      cleared_at: now,
      updated_at: now,
    })
    .eq("id", input.exclusionId)
    .select("*, participants(first_name, last_name)")
    .single();
  if (error) throw error;

  if (row.hub_issue_id) {
    const methodLabel =
      input.method === "medical_cert" ? "medical certificate" : "carer attestation";
    const resolutionNote = `Cleared to return (${methodLabel}). ${note}`;
    const isEvent = !!(row.event_id || row.event_day_session_id);
    try {
      const hubIssue: UnifiedIssue = {
        key: `${isEvent ? "event" : "day_centre"}:${row.hub_issue_id}`,
        source: isEvent ? "event" : "day_centre",
        sourceLabel: isEvent ? "Trip Day" : "Day Centre",
        category: "YELLOW",
        subCategory: "Health & Safety",
        severity: "yellow",
        title: "Infectious exclusion",
        description: resolutionNote,
        status: "open",
        createdAt: row.declared_at,
        sourceRowId: row.hub_issue_id,
        eventId: row.event_id ?? null,
        raw: {},
        lastActivityAt: null,
        deferredUntil: null,
      };
      await resolveUnifiedIssue(hubIssue, resolutionNote);
    } catch (err) {
      console.warn("[infectious-exclusion] Hub resolve failed — marking resolved", err);
      try {
        await markResolved(row.hub_issue_id);
      } catch (markErr) {
        console.warn("[infectious-exclusion] markResolved failed", markErr);
      }
    }
  }

  try {
    const gps = await tryGetGps();
    await writeToLedger({
      staff_id: staffId,
      category: "CENTRE",
      severity: "GREEN",
      action_type: "health.infectious_exclusion_cleared",
      gps_lat: gps?.lat ?? null,
      gps_lng: gps?.lng ?? null,
      metadata: {
        exclusion_id: input.exclusionId,
        participant_id: row.participant_id,
        hub_issue_id: row.hub_issue_id,
        clearance_method: input.method,
      },
    });
  } catch (err) {
    console.error("[infectious-exclusion] clear ledger failed", err);
  }

  return rowToExclusion(data as ExclusionRow);
}
