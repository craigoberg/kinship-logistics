/**
 * Left-trip vs activity-skip helpers (BL-090 two-tier).
 *
 * Left trip  — gone home; floor → absent; Hub welfare; hotel placeholder only.
 * Activity skip — still on trip; floor stays checked_in; hotel rolls still apply.
 */

/** How they left the trip (gone home). */
export const LEFT_TRIP_DISPOSITIONS = [
  { value: "uber_home", label: "Uber / taxi home" },
  { value: "family_collected", label: "Family collected" },
  { value: "staff_accompanied", label: "Staff accompanied" },
  { value: "stayed_with_carer", label: "Stayed with carer" },
  { value: "sick", label: "Sick — going home" },
  { value: "other", label: "Other" },
] as const;

export type LeftTripDisposition = (typeof LEFT_TRIP_DISPOSITIONS)[number]["value"];

/** Why they are skipping this activity but staying on the trip. */
export const ACTIVITY_SKIP_REASONS = [
  { value: "sick", label: "Sick" },
  { value: "doesnt_want_to_go", label: "Doesn't want to go" },
  { value: "resting_in_room", label: "Resting in room / hotel" },
  { value: "other", label: "Other" },
] as const;

export type ActivitySkipReason = (typeof ACTIVITY_SKIP_REASONS)[number]["value"];

const LEFT_TRIP_LABEL = new Map(
  LEFT_TRIP_DISPOSITIONS.map((d) => [d.value, d.label] as const),
);
const SKIP_LABEL = new Map(
  ACTIVITY_SKIP_REASONS.map((d) => [d.value, d.label] as const),
);

const LEFT_TRIP_NOTES_RE = /^\[LEFT TRIP:([a-z_]+)\](?:\s*\[Joining Day 2\])?\s*/i;
const LEFT_TRIP_JOINING_DAY2_RE = /^\[LEFT TRIP:[a-z_]+\]\s*\[Joining Day 2\]/i;
const ACTIVITY_SKIP_NOTES_RE = /^\[ACTIVITY SKIP:([a-z_]+)\]\s*/i;

/** True when floor notes encode a Left-trip (gone home) disposition. */
export function isLeftTripNotes(notes: string | null | undefined): boolean {
  return LEFT_TRIP_NOTES_RE.test((notes ?? "").trim());
}

/**
 * Check-In "joining later" leave — do not carry as absent onto later trip days;
 * they may reappear as expected/checked_in via overnight continuity.
 */
export function isLeftTripJoiningDay2(notes: string | null | undefined): boolean {
  return LEFT_TRIP_JOINING_DAY2_RE.test((notes ?? "").trim());
}

export function dispositionLabel(value: string): string {
  return LEFT_TRIP_LABEL.get(value as LeftTripDisposition) ?? value;
}

export function activitySkipLabel(value: string): string {
  return SKIP_LABEL.get(value as ActivitySkipReason) ?? value;
}

export function encodeLeftTripNotes(opts: {
  disposition: LeftTripDisposition;
  safetyPlan: string;
  joiningDay2?: boolean;
}): string {
  const tag = `[LEFT TRIP:${opts.disposition}]`;
  const join = opts.joiningDay2 ? " [Joining Day 2]" : "";
  return `${tag}${join} ${opts.safetyPlan.trim()}`.trim();
}

export function encodeActivitySkipNotes(opts: {
  reason: ActivitySkipReason;
  note?: string;
}): string {
  const tag = `[ACTIVITY SKIP:${opts.reason}]`;
  const note = (opts.note ?? "").trim();
  return note ? `${tag} ${note}` : tag;
}

/** Human-readable reason for Left-trip placeholders (disposition + plan). */
export function formatLeftTripDisplay(notes: string | null | undefined): string {
  const raw = (notes ?? "").trim();
  if (!raw) return "";
  const m = raw.match(LEFT_TRIP_NOTES_RE);
  if (!m) return raw;
  const label = dispositionLabel(m[1]!);
  const rest = raw.slice(m[0].length).trim();
  return rest ? `${label} — ${rest}` : label;
}

/** Short badge e.g. "Left trip · Sick — going home". */
export function formatLeftTripShortLabel(notes: string | null | undefined): string {
  const raw = (notes ?? "").trim();
  const m = raw.match(LEFT_TRIP_NOTES_RE);
  if (m) return `Left trip · ${dispositionLabel(m[1]!)}`;
  if (raw) return "Left trip";
  return "Left trip";
}

export function formatActivitySkipDisplay(notes: string | null | undefined): string {
  const raw = (notes ?? "").trim();
  if (!raw) return "";
  const m = raw.match(ACTIVITY_SKIP_NOTES_RE);
  if (!m) return raw;
  const label = activitySkipLabel(m[1]!);
  const rest = raw.slice(m[0].length).trim();
  return rest ? `${label} — ${rest}` : label;
}

export function formatActivitySkipShortLabel(notes: string | null | undefined): string {
  const raw = (notes ?? "").trim();
  const m = raw.match(ACTIVITY_SKIP_NOTES_RE);
  if (m) return `Skip · ${activitySkipLabel(m[1]!)}`;
  return "Not at activity";
}

export function isActivitySkipNotes(notes: string | null | undefined): boolean {
  return ACTIVITY_SKIP_NOTES_RE.test((notes ?? "").trim());
}

export function leftTripHubDescription(
  participantName: string,
  disposition: LeftTripDisposition,
  safetyPlan: string,
): string {
  return `[LEFT TRIP] ${participantName} — ${dispositionLabel(disposition)} — ${safetyPlan.trim()}`;
}
