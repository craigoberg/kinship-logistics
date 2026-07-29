import type { UnifiedIssue } from "@/lib/api/unified-issues";
import type { MaintenanceStatus } from "@/lib/api/maintenance";

/** Hub workflow states — aligned across Human Incidents + Maintenance list rows. */
export type HubWorkflowStatus =
  | "open"
  | "in_progress"
  | "deferred"
  | "awaiting_council"
  | "resolved"
  | "closed";

export const HUB_WORKFLOW_STATUS_BADGE: Record<HubWorkflowStatus, string> = {
  open: "bg-orange-500 text-white",
  in_progress: "bg-sky-600 text-white",
  deferred: "bg-amber-500 text-black",
  awaiting_council: "bg-violet-600 text-white",
  resolved: "bg-green-600 text-white",
  closed: "bg-slate-500 text-white",
};

export const HUB_WORKFLOW_STATUS_LABEL: Record<HubWorkflowStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  deferred: "Deferred",
  awaiting_council: "Awaiting Council",
  resolved: "Resolved",
  closed: "Closed",
};

export function issueWorkflowKey(issue: UnifiedIssue): string {
  return `${issue.source}:${issue.sourceRowId}`;
}

export function deriveIssueWorkflowStatus(
  issue: UnifiedIssue,
  reviewStartedKeys: ReadonlySet<string>,
): HubWorkflowStatus {
  const s = issue.status;
  if (s === "resolved" || s === "resolved_approved") return "resolved";
  // Accepted workaround = still open operationally (operating via plan) until Hub Resolve.
  if (s === "workaround_accepted") return "in_progress";
  if (reviewStartedKeys.has(issueWorkflowKey(issue))) {
    return "in_progress";
  }
  if (s === "deferred") return "deferred";
  if (s === "awaiting_external") return "awaiting_council";
  if (s === "claimed" || s === "in_progress") return "in_progress";
  return "open";
}

export function maintenanceWorkflowStatus(
  status: MaintenanceStatus,
): HubWorkflowStatus {
  if (status === "in_progress") return "in_progress";
  if (status === "deferred") return "deferred";
  if (status === "resolved") return "resolved";
  if (status === "closed") return "closed";
  return "open";
}

export function issueDeferredUntil(issue: UnifiedIssue): string | null {
  const raw = (issue.raw ?? {}) as Record<string, unknown>;
  const until = raw.deferred_until;
  if (typeof until === "string" && until.length > 0) {
    return until.split("T")[0];
  }
  if (issue.status === "deferred" && issue.subCategory) {
    return issue.subCategory;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hub urgency — staleness / deadline engine (BL-021)
// ---------------------------------------------------------------------------

/**
 * Urgency level computed from time-since-last-activity and defer deadlines.
 * Rendered as a small secondary badge on each list card, independent of the
 * RYGE severity badge.
 *
 * none        — within SLA, no action required right now
 * update-due  — active item: amber, no log note in yellow window
 * stale       — active item: red, no log note in red window
 * action-due  — deferred item: amber, deadline has passed but no activity yet
 * overdue     — deferred item: red, past deadline + overdue window, no activity
 */
export type HubUrgency = "none" | "update-due" | "stale" | "action-due" | "overdue";

export interface UrgencyParams {
  /** ms since last activity → amber badge (active items) */
  activeYellowMs: number;
  /** ms since last activity → red badge (active items) */
  activeRedMs: number;
  /** ms before defer_until that item resurfaces on Active tab */
  deferRewarnMs: number;
  /** ms after defer_until (with no activity) → red badge */
  deferOverdueRedMs: number;
}

export const HUB_URGENCY_BADGE: Record<
  Exclude<HubUrgency, "none">,
  { label: string; classes: string }
> = {
  "update-due": { label: "Update Due", classes: "bg-amber-500 text-black" },
  stale:        { label: "Stale",      classes: "bg-red-600 text-white" },
  "action-due": { label: "Action Due", classes: "bg-amber-500 text-black" },
  overdue:      { label: "Overdue",    classes: "bg-red-600 text-white" },
};

/**
 * Compute the urgency for a single Hub item.
 *
 * Rules:
 * - While deferred and deadline is in the future: staleness clock pauses → "none".
 * - Once defer lapses with no activity: "action-due" → "overdue" after deferOverdueRedMs.
 * - If activity occurred after the lapsed defer: resets to active SLA clock.
 * - Active (non-deferred) items: "update-due" after activeYellowMs, "stale" after activeRedMs.
 */
export function computeHubUrgency(args: {
  nowMs: number;
  createdAtMs: number;
  /** Timestamp of the most recent log note; null falls back to createdAt. */
  lastActivityMs: number | null;
  /** ISO string of the current defer deadline; null = not deferred. */
  deferredUntilMs: number | null;
  params: UrgencyParams;
}): HubUrgency {
  const { nowMs, createdAtMs, lastActivityMs, deferredUntilMs, params } = args;
  const lastActive = lastActivityMs ?? createdAtMs;

  if (deferredUntilMs !== null) {
    if (nowMs < deferredUntilMs) {
      // Deadline still in the future — staleness clock paused.
      return "none";
    }
    // Deadline has lapsed. Did someone act after the deadline?
    if (lastActive >= deferredUntilMs) {
      // Activity occurred after the lapsed defer → treat as active, apply SLA.
      const timeSinceActive = nowMs - lastActive;
      if (timeSinceActive >= params.activeRedMs) return "stale";
      if (timeSinceActive >= params.activeYellowMs) return "update-due";
      return "none";
    }
    // No activity since the deadline.
    const timeAfterDefer = nowMs - deferredUntilMs;
    if (timeAfterDefer >= params.deferOverdueRedMs) return "overdue";
    return "action-due";
  }

  // Active (non-deferred) — apply SLA clock.
  const timeSinceActive = nowMs - lastActive;
  if (timeSinceActive >= params.activeRedMs) return "stale";
  if (timeSinceActive >= params.activeYellowMs) return "update-due";
  return "none";
}
