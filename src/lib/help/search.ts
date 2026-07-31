import type { ActiveUserProfile } from "@/lib/data-store";
import type { HelpAreaChip, HelpTopic } from "./types";

function normalizeRole(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

/** Manager / assistant_manager (and coarse coordinator) see the full catalogue. */
export function isHelpManagerViewer(profile: ActiveUserProfile | null): boolean {
  if (!profile) return false;
  if (profile.role === "coordinator") return true;
  const staffRole = normalizeRole(profile.staffRole);
  return staffRole === "manager" || staffRole === "assistant_manager";
}

/**
 * Soft visibility for Alpha (BL-105). Hard enforcement lands with BL-002.
 * No profile → show all (signed-in gate is elsewhere); managers → all.
 */
export function canViewHelpTopic(
  topic: HelpTopic,
  profile: ActiveUserProfile | null,
): boolean {
  if (topic.roles === "all") return true;
  if (!profile) return true;
  if (isHelpManagerViewer(profile)) return true;

  const staffRole = normalizeRole(profile.staffRole);
  if (staffRole && topic.roles.includes(staffRole)) return true;

  // Coarse PIN role: support_worker maps to driver in data-store.
  if (profile.role === "driver") {
    if (topic.roles.includes("driver") || topic.roles.includes("support_worker")) {
      return true;
    }
  }

  return false;
}

export function filterTopicsForProfile(
  topics: readonly HelpTopic[],
  profile: ActiveUserProfile | null,
): HelpTopic[] {
  return topics.filter((t) => canViewHelpTopic(t, profile));
}

function topicSearchBlob(topic: HelpTopic): string {
  const stepText = topic.steps.map((s) => `${s.heading} ${s.body}`).join(" ");
  return [
    topic.title,
    topic.summary,
    topic.keywords.join(" "),
    topic.menus.join(" "),
    stepText,
  ]
    .join(" ")
    .toLowerCase();
}

/** Case-insensitive substring match across title, summary, keywords, steps. */
export function searchHelpTopics(
  topics: readonly HelpTopic[],
  query: string,
): HelpTopic[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...topics];
  const tokens = q.split(/\s+/).filter(Boolean);
  return topics.filter((topic) => {
    const blob = topicSearchBlob(topic);
    return tokens.every((token) => blob.includes(token));
  });
}

export function filterTopicsByMenu(
  topics: readonly HelpTopic[],
  menuKey: string | null,
): HelpTopic[] {
  if (!menuKey) return [...topics];
  return topics.filter((t) => t.menus.includes(menuKey));
}

/** Area chips derived from visible topics (stable label map). */
const AREA_LABELS: Record<string, string> = {
  manifest: "Manifest",
  day: "Day Centre",
  "event-deliver": "Event Deliver",
  events: "Event Manage",
  governance: "Hub",
  red: "RED",
  auth: "Sign-in",
  dashboard: "Dashboard",
  transport: "Transport",
  admin: "Admin",
  participants: "Participants",
  staff: "Staff",
};

export function buildHelpAreaChips(topics: readonly HelpTopic[]): HelpAreaChip[] {
  const seen = new Set<string>();
  const chips: HelpAreaChip[] = [];
  for (const topic of topics) {
    for (const menu of topic.menus) {
      if (seen.has(menu)) continue;
      seen.add(menu);
      chips.push({ key: menu, label: AREA_LABELS[menu] ?? menu });
    }
  }
  chips.sort((a, b) => a.label.localeCompare(b.label));
  return chips;
}

export function getHelpTopicById(
  topics: readonly HelpTopic[],
  id: string,
): HelpTopic | undefined {
  return topics.find((t) => t.id === id);
}
