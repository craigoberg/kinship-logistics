/**
 * Human-driven office/record changes → operational_ledger (Activity log).
 * Floor YELLOW/RED paths keep their own writeToLedger calls — do not replace them.
 */
import { supabase } from "@/integrations/supabase/client";
import { writeToLedger, type LedgerCategory } from "@/lib/api/ledger";
import {
  DEFAULT_STAFF_UUID,
  getActiveUserProfile,
  getStaffId,
  primeStaffDisplayNames,
  resolveStaffDisplayName,
} from "@/lib/data-store";

export const OFFICE_RECORD_CHANGED = "OFFICE_RECORD_CHANGED";

const SECRET_KEY = /pin|password|hash|secret|token/i;

export type OfficeChangeAction =
  | "created"
  | "updated"
  | "archived"
  | "deleted"
  | "confirmed";

export interface AuditActor {
  staffId: string | null;
  authUserId: string | null;
  name: string;
}

export interface RecordOfficeChangeInput {
  action: OfficeChangeAction;
  /** Short type for filters: client, staff, carer, medication, lookup, vendor, … */
  entity: string;
  recordId?: string | null;
  recordName: string;
  summary?: string;
  category?: LedgerCategory;
  source?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

const FIELD_LABELS: Record<string, string> = {
  firstName: "first name",
  lastName: "last name",
  fullName: "name",
  ndisNumber: "NDIS number",
  streetAddress: "street address",
  street_address: "street address",
  regularPickupAddress: "pickup address",
  regular_pickup_address: "pickup address",
  iddsiLiquids: "IDDSI liquids",
  iddsiFoods: "IDDSI foods",
  personnelType: "personnel type",
  isPrimaryContact: "primary contact",
  medicationName: "medication",
  expectedTime: "time",
  pin: "PIN",
  pin_hash: "PIN",
  dualWitnessPinHash: "dual witness PIN",
  allergiesNotes: "allergies",
  registrationExpiry: "rego expiry",
  registration_expiry: "rego expiry",
  regoPlate: "rego",
  lastServiceOdo: "last service odo",
  lastServiceDate: "last service date",
  deferredUntil: "deferred until",
  isActive: "in service",
};

export async function resolveAuditActor(): Promise<AuditActor> {
  const profile = getActiveUserProfile();
  const { data: sessionData } = await supabase.auth.getUser();
  const authUser = sessionData.user ?? null;
  const authUserId = authUser?.id ?? null;

  if (profile?.staffId && profile.staffId !== DEFAULT_STAFF_UUID) {
    const name = (profile.fullName ?? "").trim();
    return {
      staffId: profile.staffId,
      authUserId: profile.authUserId ?? authUserId,
      name: name || "Signed-in staff",
    };
  }

  if (authUserId) {
    const { data: byAuth } = await supabase
      .from("staff_registry")
      .select("id, full_name")
      .eq("auth_user_id", authUserId)
      .maybeSingle();
    if (byAuth) {
      const row = byAuth as { id: string; full_name: string | null };
      return {
        staffId: row.id,
        authUserId,
        name: (row.full_name ?? "").trim() || authUser?.email || "Day login",
      };
    }
    const email = (authUser?.email ?? "").trim();
    if (email) {
      const { data: byEmail } = await supabase
        .from("staff_registry")
        .select("id, full_name")
        .eq("email", email)
        .maybeSingle();
      if (byEmail) {
        const row = byEmail as { id: string; full_name: string | null };
        return {
          staffId: row.id,
          authUserId,
          name: (row.full_name ?? "").trim() || email,
        };
      }
      return { staffId: null, authUserId, name: `Day login (${email})` };
    }
    return { staffId: null, authUserId, name: "Day login" };
  }

  const local = getStaffId();
  if (local && local !== DEFAULT_STAFF_UUID) {
    await primeStaffDisplayNames();
    return { staffId: local, authUserId: null, name: resolveStaffDisplayName(local) };
  }

  return { staffId: null, authUserId: null, name: "Unknown operator" };
}

/** Stamp actor_name on floor/office ledger metadata (never first-staff fallback). */
export async function withAuditActorMeta(
  meta: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const actor = await resolveAuditActor();
  const existing = typeof meta.actor_name === "string" ? meta.actor_name.trim() : "";
  return {
    ...meta,
    actor_name: existing || actor.name,
    actor_staff_id: meta.actor_staff_id ?? actor.staffId,
  };
}

export function formatTravelHow(
  method?: string | null,
  runCode?: string | null,
  vector?: string | null,
): string {
  const raw = (vector || method || "").trim().toLowerCase();
  const run = (runCode ?? "").trim();
  if (raw === "bus") return run ? `via Bus (${run})` : "via Bus";
  if (raw === "private" || raw === "self") return "via Self";
  if (raw === "walk_in") return "via Walk-in";
  if (raw === "family") return "via Family / carer";
  if (raw === "independent") return "via Independent";
  if (raw === "other") return "via Other";
  return "";
}

export async function lookupParticipantName(
  id: string | null | undefined,
): Promise<string | null> {
  if (!id) return null;
  const { data, error } = await supabase
    .from("participants")
    .select("first_name, last_name, full_name")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as {
    first_name?: string | null;
    last_name?: string | null;
    full_name?: string | null;
  };
  const combined = `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim();
  return combined || (r.full_name ?? "").trim() || null;
}

function preview(value: unknown): string {
  if (value == null || value === "") return "(empty)";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") return "(updated)";
  const s = String(value).replace(/\s+/g, " ").trim();
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

function fieldLabel(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

export function sanitizeOfficeSnapshot(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!value) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY.test(k)) {
      out[k] = v == null || v === "" ? null : "(changed)";
      continue;
    }
    out[k] = v;
  }
  return out;
}

function changedKeys(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string[] {
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  const changed: string[] = [];
  for (const key of keys) {
    const a = JSON.stringify((before ?? {})[key] ?? null);
    const b = JSON.stringify((after ?? {})[key] ?? null);
    if (a !== b) changed.push(key);
  }
  return changed;
}

function entityLabel(entity: string): string {
  if (entity === "client") return "client";
  if (entity === "staff") return "staff";
  if (entity === "carer") return "carer";
  return entity.replace(/_/g, " ");
}

export function buildOfficeChangeSummary(input: RecordOfficeChangeInput): string {
  if (input.summary?.trim()) return input.summary.trim();
  const who = input.recordName.trim() || entityLabel(input.entity);
  const label = entityLabel(input.entity);
  if (input.action === "created") return `Added ${label} ${who}`;
  if (input.action === "archived") return `Archived ${label} ${who}`;
  if (input.action === "deleted") return `Deleted ${label} ${who}`;
  if (input.action === "confirmed") return `Confirmed ${label} ${who}`;
  const keys = changedKeys(input.before ?? null, input.after ?? null);
  if (keys.length === 0) return `Updated ${label} ${who}`;
  const bits = keys.slice(0, 6).map((k) => {
    const from = preview((input.before ?? {})[k]);
    const to = preview((input.after ?? {})[k]);
    return `${fieldLabel(k)} ${from} → ${to}`;
  });
  const extra = keys.length > 6 ? `; +${keys.length - 6} more` : "";
  return `Updated ${label} ${who}: ${bits.join("; ")}${extra}`;
}

function categoryForEntity(entity: string): LedgerCategory {
  if (entity === "client" || entity === "guest" || entity === "medication") {
    return "CLIENT";
  }
  if (entity === "fleet" || entity === "vehicle") return "VEHICLE";
  if (
    entity === "event" ||
    entity === "booking" ||
    entity === "itinerary" ||
    entity === "trip_expense"
  ) {
    return "TRIP";
  }
  return "CENTRE";
}

export async function recordOfficeChange(
  input: RecordOfficeChangeInput,
): Promise<void> {
  const actor = await resolveAuditActor();
  const before = sanitizeOfficeSnapshot(input.before);
  const after = sanitizeOfficeSnapshot(input.after);
  const summary = buildOfficeChangeSummary({ ...input, before, after });
  await writeToLedger({
    staff_id: actor.staffId ?? DEFAULT_STAFF_UUID,
    category: input.category ?? categoryForEntity(input.entity),
    severity: "INFO",
    action_type: OFFICE_RECORD_CHANGED,
    gps_lat: null,
    gps_lng: null,
    metadata: {
      summary,
      actor_name: actor.name,
      actor_auth_user_id: actor.authUserId,
      action: input.action,
      entity: input.entity,
      record_id: input.recordId ?? null,
      person_name: input.recordName,
      source: input.source ?? "office",
      before,
      after,
    },
  });
}

export async function recordOfficeChangeBestEffort(
  input: RecordOfficeChangeInput,
): Promise<void> {
  try {
    await recordOfficeChange(input);
  } catch (err) {
    console.error("[office-change-log] failed", err);
  }
}
