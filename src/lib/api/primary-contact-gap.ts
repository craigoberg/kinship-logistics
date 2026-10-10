import { supabase } from "@/integrations/supabase/client";
import { createIssue, markResolved } from "@/lib/api/site-issues";
import { operationalNowIso } from "@/lib/operational-clock";

const MARKER = "[PRIMARY CONTACT]";

export interface MissingPrimaryContact {
  participantId: string;
  name: string;
}

function markerFor(participantId: string): string {
  return `${MARKER} ${participantId}`;
}

function participantIdFromIssue(description: string): string | null {
  const match = description.match(/\[PRIMARY CONTACT\]\s+([0-9a-f-]{36})/i);
  return match?.[1] ?? null;
}

/** Active clients with nobody marked as their primary contact. */
export async function listClientsMissingPrimaryContact(): Promise<MissingPrimaryContact[]> {
  const [people, carers] = await Promise.all([
    supabase
      .from("participants")
      .select("id, first_name, last_name, participant_kind, archived_at, service_status")
      .is("archived_at", null),
    supabase
      .from("carers_registry")
      .select("participant_id, is_primary_contact, exited_at")
      .eq("is_primary_contact", true),
  ]);
  if (people.error) throw new Error(people.error.message);
  if (carers.error) throw new Error(carers.error.message);

  const covered = new Set(
    ((carers.data ?? []) as Array<{ participant_id: string | null; exited_at?: string | null }>)
      .filter((c) => c.participant_id && !c.exited_at)
      .map((c) => c.participant_id as string),
  );

  const gaps: MissingPrimaryContact[] = [];
  for (const raw of people.data ?? []) {
    const p = raw as {
      id: string;
      first_name: string | null;
      last_name: string | null;
      participant_kind: string | null;
      service_status: string | null;
    };
    if (p.participant_kind === "guest") continue;
    if (p.service_status === "exited") continue;
    if (covered.has(p.id)) continue;
    const name = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Client";
    gaps.push({ participantId: p.id, name });
  }
  gaps.sort((a, b) => a.name.localeCompare(b.name));
  return gaps;
}

/**
 * One open yellow Hub issue per client, raised when the Dashboard is opened.
 * Not a midnight job. A second open does not create another ticket.
 */
export async function syncMissingPrimaryContactIssues(): Promise<MissingPrimaryContact[]> {
  const gaps = await listClientsMissingPrimaryContact();
  const gapIds = new Set(gaps.map((g) => g.participantId));

  const { data: openRows, error } = await supabase
    .from("site_issues_register")
    .select("id, issue_description, status")
    .eq("status", "open")
    .like("issue_description", `%${MARKER}%`);
  if (error) {
    console.warn("[primary-contact] could not read open tickets", error.message);
    return gaps;
  }
  const open = (openRows ?? []) as Array<{ id: string; issue_description: string }>;
  const openFor = new Set(
    open.map((row) => participantIdFromIssue(row.issue_description)).filter((id): id is string => !!id),
  );

  for (const gap of gaps) {
    if (openFor.has(gap.participantId)) continue;
    try {
      await createIssue({
        sessionId: null,
        eventId: null,
        eventDaySessionId: null,
        severity: "yellow",
        owner: "internal",
        occurredAt: operationalNowIso(),
        issueDescription: `${gap.name} has no primary contact. ${markerFor(gap.participantId)}`,
        workaroundPlan: "Add a primary contact on the client profile. This ticket closes when that contact is saved.",
      });
    } catch (err) {
      console.warn("[primary-contact] yellow ticket failed", err);
    }
  }

  for (const row of open) {
    const id = participantIdFromIssue(row.issue_description);
    if (!id || gapIds.has(id)) continue;
    try {
      await markResolved(row.id);
    } catch (err) {
      console.warn("[primary-contact] could not close ticket", err);
    }
  }

  return gaps;
}

export async function resolvePrimaryContactGap(participantId: string): Promise<void> {
  const needle = markerFor(participantId);
  const { data, error } = await supabase
    .from("site_issues_register")
    .select("id, issue_description")
    .eq("status", "open")
    .like("issue_description", `%${needle}%`);
  if (error || !data) return;
  for (const row of data as Array<{ id: string }>) {
    try {
      await markResolved(row.id);
    } catch (err) {
      console.warn("[primary-contact] could not close ticket", err);
    }
  }
}
