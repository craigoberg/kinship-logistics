/**
 * BL-094 — Venue safety evidence for trip Audit Pack.
 * Baseline sign-offs (§12.2), per-event reconfirmations (if present),
 * and Event Deliver Open walkthrough ticks (BL-070 ledger metadata).
 */
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { batchLatestBaselineSignoffs } from "@/lib/api/venues";
import { rowsToCsv } from "./csv";
import { auditDate, auditDateTime } from "./format";
import { resolveStaffNames } from "./staff-names";
import type { AuditPackFile } from "./types";

export type VenueOnTrip = {
  venueId: string;
  venueName: string;
  role: "primary" | "stop";
  sessionDates: string[];
};

async function listVenuesOnTrip(eventId: string): Promise<VenueOnTrip[]> {
  const byId = new Map<string, VenueOnTrip>();

  const eventRes = await supabase
    .from("event_manifest")
    .select("primary_venue_id, venues!event_manifest_primary_venue_id_fkey(name)")
    .eq("id", eventId)
    .maybeSingle();
  if (!eventRes.error && eventRes.data) {
    const row = eventRes.data as {
      primary_venue_id: string | null;
      venues?: { name?: string } | null;
    };
    if (row.primary_venue_id) {
      byId.set(row.primary_venue_id, {
        venueId: row.primary_venue_id,
        venueName: row.venues?.name ?? row.primary_venue_id,
        role: "primary",
        sessionDates: [],
      });
    }
  }

  const stopsRes = await supabase
    .from("event_venue_stops")
    .select("venue_id, session_date, venues(name)")
    .eq("event_id", eventId);
  if (!stopsRes.error) {
    for (const raw of stopsRes.data ?? []) {
      const s = raw as {
        venue_id: string | null;
        session_date: string;
        venues?: { name?: string } | null;
      };
      if (!s.venue_id) continue;
      const existing = byId.get(s.venue_id);
      if (existing) {
        if (!existing.sessionDates.includes(s.session_date)) {
          existing.sessionDates.push(s.session_date);
        }
        if (existing.role !== "primary") existing.role = "stop";
      } else {
        byId.set(s.venue_id, {
          venueId: s.venue_id,
          venueName: s.venues?.name ?? s.venue_id,
          role: "stop",
          sessionDates: [s.session_date],
        });
      }
    }
  }

  return [...byId.values()].sort((a, b) =>
    a.venueName.localeCompare(b.venueName),
  );
}

async function listLocationOpenedLedger(eventId: string): Promise<
  Array<{
    createdAt: string;
    staffId: string;
    sessionDate: string;
    sessionId: string;
    notes: string;
    checks: string[];
  }>
> {
  // Prefer jsonb contains; fall back to a bounded scan if filter unsupported.
  let result = await supabase
    .from("operational_ledger")
    .select("created_at, staff_id, metadata")
    .eq("action_type", "EVENT_LOCATION_OPENED")
    .contains("metadata", { event_id: eventId })
    .order("created_at", { ascending: true });

  if (result.error) {
    result = await supabase
      .from("operational_ledger")
      .select("created_at, staff_id, metadata")
      .eq("action_type", "EVENT_LOCATION_OPENED")
      .order("created_at", { ascending: false })
      .limit(500);
    if (result.error) {
      if (isSchemaMismatchError(result.error)) return [];
      throw result.error;
    }
  }

  const rows: Array<{
    createdAt: string;
    staffId: string;
    sessionDate: string;
    sessionId: string;
    notes: string;
    checks: string[];
  }> = [];

  for (const raw of result.data ?? []) {
    const r = raw as {
      created_at: string;
      staff_id: string;
      metadata: Record<string, unknown> | null;
    };
    const meta = r.metadata ?? {};
    if (String(meta.event_id ?? "") !== eventId) continue;
    const checksRaw = meta.venue_open_checks;
    const checks = Array.isArray(checksRaw)
      ? checksRaw.map((c) => String(c)).filter(Boolean)
      : typeof checksRaw === "string" && checksRaw.trim()
        ? [checksRaw.trim()]
        : [];
    rows.push({
      createdAt: r.created_at,
      staffId: r.staff_id ?? "",
      sessionDate: String(meta.session_date ?? ""),
      sessionId: String(meta.event_day_session_id ?? ""),
      notes: meta.notes != null ? String(meta.notes) : "",
      checks,
    });
  }

  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function listEventVenueReconfirmations(eventId: string): Promise<
  Array<{
    venueId: string;
    reconfirmedAt: string;
    reconfirmedBy: string;
    stillValid: boolean;
    evidenceRef: string;
    notes: string;
  }>
> {
  const { data, error } = await supabase
    .from("event_venue_reconfirmations")
    .select(
      "venue_id, reconfirmed_at, reconfirmed_by_staff_id, still_valid, evidence_ref, notes",
    )
    .eq("event_id", eventId);
  if (error) {
    if (isSchemaMismatchError(error)) return [];
    throw error;
  }
  return (data ?? []).map((raw) => {
    const r = raw as {
      venue_id: string;
      reconfirmed_at: string;
      reconfirmed_by_staff_id: string | null;
      still_valid: boolean;
      evidence_ref: string | null;
      notes: string | null;
    };
    return {
      venueId: r.venue_id,
      reconfirmedAt: r.reconfirmed_at,
      reconfirmedBy: r.reconfirmed_by_staff_id ?? "",
      stillValid: Boolean(r.still_valid),
      evidenceRef: r.evidence_ref ?? "",
      notes: r.notes ?? "",
    };
  });
}

export type VenueSafetyPack = {
  files: AuditPackFile[];
  pdfLines: string[];
  summary: {
    venueCount: number;
    baselinesPresent: number;
    baselinesMissing: number;
    walkthroughOpens: number;
    walkthroughWithChecks: number;
    reconfirmCount: number;
  };
};

export async function assembleVenueSafetyEvidence(
  eventId: string,
  folder: string,
): Promise<VenueSafetyPack> {
  const venues = await listVenuesOnTrip(eventId);
  const venueIds = venues.map((v) => v.venueId);
  const baselines = await batchLatestBaselineSignoffs(venueIds);
  const walkthrough = await listLocationOpenedLedger(eventId);
  const reconfirms = await listEventVenueReconfirmations(eventId);

  const staffIds = [
    ...walkthrough.map((w) => w.staffId),
    ...reconfirms.map((r) => r.reconfirmedBy),
    ...[...baselines.values()].map((b) => b?.signed_off_by_staff_id ?? ""),
  ];
  const staffNames = await resolveStaffNames(staffIds);

  const baselineRows = venues.map((v) => {
    const sig = baselines.get(v.venueId) ?? null;
    return {
      venueName: v.venueName,
      venueId: v.venueId,
      role: v.role,
      sessionDates: v.sessionDates.map(auditDate).join("; "),
      hasBaseline: sig ? "yes" : "no",
      signoffId: sig?.id ?? "",
      signedOffAt: auditDateTime(sig?.signed_off_at ?? ""),
      signedOffByName: sig?.signed_off_by_staff_id
        ? staffNames.get(sig.signed_off_by_staff_id) ?? sig.signed_off_by_staff_id
        : "",
      evidenceRef: sig?.evidence_ref ?? "",
      notes: sig?.notes ?? "",
    };
  });

  const walkthroughRows = walkthrough.map((w) => ({
    sessionDate: auditDate(w.sessionDate),
    openedAt: auditDateTime(w.createdAt),
    openedByName: staffNames.get(w.staffId) ?? w.staffId,
    sessionId: w.sessionId,
    checkCount: w.checks.length,
    checksCompleted:
      w.checks.length > 0
        ? w.checks.join(" | ")
        : "(high-trust — no checklist configured)",
    notes: w.notes,
  }));

  const venueNameById = new Map(venues.map((v) => [v.venueId, v.venueName]));
  const reconfirmRows = reconfirms.map((r) => ({
    venueName: venueNameById.get(r.venueId) ?? r.venueId,
    venueId: r.venueId,
    reconfirmedAt: auditDateTime(r.reconfirmedAt),
    reconfirmedByName:
      staffNames.get(r.reconfirmedBy) ?? r.reconfirmedBy,
    stillValid: r.stillValid ? "yes" : "no",
    evidenceRef: r.evidenceRef,
    notes: r.notes,
  }));

  const baselinesPresent = baselineRows.filter((r) => r.hasBaseline === "yes").length;
  const baselinesMissing = baselineRows.filter((r) => r.hasBaseline === "no").length;
  const walkthroughWithChecks = walkthrough.filter((w) => w.checks.length > 0).length;

  const pdfLines: string[] = [];
  if (venues.length === 0) {
    pdfLines.push("No registry venues linked (primary / itinerary stops).");
  } else {
    pdfLines.push(
      `Venues on trip ${venues.length} · baselines ${baselinesPresent} · missing ${baselinesMissing}`,
    );
    for (const r of baselineRows) {
      pdfLines.push(
        r.hasBaseline === "yes"
          ? `${r.venueName} (${r.role}) · baseline ${r.signedOffAt} · ${r.signedOffByName || "—"} · evidence ${r.evidenceRef.slice(0, 60) || "—"}`
          : `${r.venueName} (${r.role}) · NO baseline sign-off`,
      );
    }
  }

  pdfLines.push(
    `Open walkthroughs ${walkthrough.length}` +
      (walkthroughWithChecks
        ? ` (${walkthroughWithChecks} with checklist ticks)`
        : walkthrough.length
          ? " (high-trust / empty checklist)"
          : ""),
  );
  if (walkthroughRows.length === 0) {
    pdfLines.push("No EVENT_LOCATION_OPENED ledger rows for this event.");
  } else {
    for (const w of walkthroughRows.slice(0, 20)) {
      pdfLines.push(
        `${w.sessionDate || "—"} · ${w.openedAt} · ${w.openedByName || "—"} · checks=${w.checkCount} · ${String(w.checksCompleted).slice(0, 90)}`,
      );
    }
    if (walkthroughRows.length > 20) {
      pdfLines.push(`… +${walkthroughRows.length - 20} more (see venue_open_walkthrough.csv)`);
    }
  }

  if (reconfirmRows.length === 0) {
    pdfLines.push(
      "No per-event reconfirmation rows (event_venue_reconfirmations empty for this trip).",
    );
  } else {
    pdfLines.push(`Reconfirmations ${reconfirmRows.length}`);
    for (const r of reconfirmRows) {
      pdfLines.push(
        `${r.venueName} · ${r.reconfirmedAt} · ${r.reconfirmedByName || "—"} · still_valid=${r.stillValid} · ${r.evidenceRef.slice(0, 40) || "—"}`,
      );
    }
  }

  const files: AuditPackFile[] = [
    {
      path: `${folder}/venue_safety_baselines.csv`,
      content: rowsToCsv(
        [
          "venueName",
          "venueId",
          "role",
          "sessionDates",
          "hasBaseline",
          "signoffId",
          "signedOffAt",
          "signedOffByName",
          "evidenceRef",
          "notes",
        ],
        baselineRows,
      ),
    },
    {
      path: `${folder}/venue_open_walkthrough.csv`,
      content: rowsToCsv(
        [
          "sessionDate",
          "openedAt",
          "openedByName",
          "sessionId",
          "checkCount",
          "checksCompleted",
          "notes",
        ],
        walkthroughRows,
      ),
    },
    {
      path: `${folder}/venue_reconfirmations.csv`,
      content: rowsToCsv(
        [
          "venueName",
          "venueId",
          "reconfirmedAt",
          "reconfirmedByName",
          "stillValid",
          "evidenceRef",
          "notes",
        ],
        reconfirmRows,
      ),
    },
  ];

  return {
    files,
    pdfLines,
    summary: {
      venueCount: venues.length,
      baselinesPresent,
      baselinesMissing,
      walkthroughOpens: walkthrough.length,
      walkthroughWithChecks,
      reconfirmCount: reconfirmRows.length,
    },
  };
}
