/**
 * Hub issue timeline for audit packs — notes, deferrals, resolutions
 * with stamped_at + staff (Practice Standards evidence of implementation).
 */
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import type { UnifiedIssueSource } from "@/lib/api/unified-issues";
import { auditDateTime } from "./format";
import { auditIdentity } from "./identity";
import { resolveStaffNames } from "./staff-names";
import { rowsToCsv } from "./csv";

export interface AuditTrailRef {
  source: UnifiedIssueSource;
  sourceRowId: string;
}

export interface AuditNoteRow {
  source: string;
  sourceRowId: string;
  noteId: string;
  kind: string;
  stampedAt: string;
  staffId: string;
  staffName: string;
  note: string;
  deferredUntil: string;
  isResolution: boolean;
}

export interface IssueResolutionSummary {
  resolutionNote: string;
  resolvedAt: string;
  resolvedById: string;
  resolvedByName: string;
  noteCount: number;
  lastNoteAt: string;
  lastNoteByName: string;
}

/** Batch-load hub_issue_notes for many issues (chunked `.in`). */
export async function loadHubNotesForRefs(
  refs: AuditTrailRef[],
): Promise<AuditNoteRow[]> {
  if (refs.length === 0) return [];

  const bySource = new Map<UnifiedIssueSource, string[]>();
  for (const r of refs) {
    const list = bySource.get(r.source) ?? [];
    list.push(r.sourceRowId);
    bySource.set(r.source, list);
  }

  const raw: Array<Record<string, unknown>> = [];
  for (const [source, ids] of bySource) {
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += 80) {
      const chunk = unique.slice(i, i + 80);
      const { data, error } = await supabase
        .from("hub_issue_notes")
        .select("*")
        .eq("source", source)
        .in("source_row_id", chunk)
        .order("stamped_at", { ascending: true });
      if (error) {
        if (isSchemaMismatchError(error)) continue;
        console.warn("[audit-pack] hub_issue_notes", source, error);
        continue;
      }
      raw.push(...((data ?? []) as Array<Record<string, unknown>>));
    }
  }

  const staffNames = await resolveStaffNames(
    raw.map((r) => (r.staff_id as string | null) ?? null),
  );

  return raw.map((r) => {
    const staffId = (r.staff_id as string | null) ?? "";
    const kind = String(r.kind ?? "append");
    const note = String(r.note ?? "");
    const meta = (r.metadata as Record<string, unknown> | null) ?? null;
    const deferredUntil =
      (meta?.deferred_until as string | undefined) ??
      (kind === "defer" ? note.match(/until\s+(\S+)/i)?.[1] ?? "" : "");
    const isResolution =
      kind === "resolve" || /^\[RESOLVED\]/i.test(note);
    return {
      source: String(r.source ?? ""),
      sourceRowId: String(r.source_row_id ?? ""),
      noteId: String(r.id ?? ""),
      kind,
      stampedAt: String(r.stamped_at ?? ""),
      staffId: auditIdentity().staffKey(staffId),
      staffName: staffId ? staffNames.get(staffId) ?? staffId : "",
      note,
      deferredUntil: deferredUntil || "",
      isResolution,
    };
  });
}

export function summarizeResolutions(
  notes: AuditNoteRow[],
): Map<string, IssueResolutionSummary> {
  const byKey = new Map<string, AuditNoteRow[]>();
  for (const n of notes) {
    const key = `${n.source}:${n.sourceRowId}`;
    const list = byKey.get(key) ?? [];
    list.push(n);
    byKey.set(key, list);
  }

  const out = new Map<string, IssueResolutionSummary>();
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) =>
      a.stampedAt.localeCompare(b.stampedAt),
    );
    const resolution =
      [...sorted].reverse().find((n) => n.isResolution) ?? null;
    const last = sorted[sorted.length - 1] ?? null;
    const noteText = resolution
      ? resolution.note.replace(/^\[RESOLVED\]\s*/i, "")
      : "";
    out.set(key, {
      resolutionNote: noteText,
      resolvedAt: resolution?.stampedAt ?? "",
      resolvedById: resolution?.staffId ?? "",
      resolvedByName: resolution?.staffName ?? "",
      noteCount: sorted.length,
      lastNoteAt: last?.stampedAt ?? "",
      lastNoteByName: last?.staffName ?? "",
    });
  }
  return out;
}

export function notesToCsv(notes: AuditNoteRow[]): string {
  return rowsToCsv(
    [
      "source",
      "sourceRowId",
      "noteId",
      "kind",
      "stampedAt",
      "staffName",
      "staffId",
      "note",
      "deferredUntil",
      "isResolution",
    ],
    notes.map((n) => ({
      ...n,
      stampedAt: auditDateTime(n.stampedAt),
      deferredUntil: auditDateTime(n.deferredUntil) || n.deferredUntil,
      isResolution: n.isResolution ? "yes" : "no",
    })),
  );
}

/** Map site_issues_register row → Hub source key used in hub_issue_notes. */
export function hubSourceForSiteIssue(row: {
  eventId?: string | null;
  eventDaySessionId?: string | null;
}): UnifiedIssueSource {
  return row.eventId || row.eventDaySessionId ? "event" : "day_centre";
}

/** Format a short trail for PDF (last N notes). */
export function formatTrailPreview(
  notes: AuditNoteRow[],
  max = 6,
): string[] {
  const sorted = [...notes].sort((a, b) =>
    a.stampedAt.localeCompare(b.stampedAt),
  );
  const slice = sorted.slice(-max);
  return slice.map((n) => {
    const stamp = auditDateTime(n.stampedAt) || "—";
    const who = n.staffName || "—";
    const tag = n.isResolution ? "RESOLVED" : n.kind.toUpperCase();
    return `${stamp} · ${who} · ${tag} · ${n.note.slice(0, 100)}`;
  });
}
