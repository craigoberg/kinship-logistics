/**
 * One exercise clock for every signed-in person on this site.
 *
 * Craig turns it on, sets a Sydney date and time, and every browser jumps
 * there. Turn it off and everyone returns to the live clock. It expires at
 * the next Sydney midnight (wall date), so a forgotten exercise cannot run
 * the floor the next morning.
 *
 * Stored on system_parameters key `operational_clock.shared`.
 * SQL: docs/sql/2026-10-23_shared_operational_clock.sql
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { canUseDevTools } from "@/lib/dev-tools-access";
import { getSydneyIsoDate } from "@/lib/operational-time";
import { IS_TEST_BUILD } from "@/lib/test-mode";

export const SHARED_OPERATIONAL_CLOCK_KEY = "operational_clock.shared";

export interface SharedOperationalClockRecord {
  enabled: boolean;
  date: string | null;
  time: string | null;
  setOnWallDate: string | null;
  revision: number;
}

export interface SharedClockFace {
  date: string;
  time: string;
}

const CHANNEL_NAME = "exercise-operational-clock";
const POLL_MS = 2500;

type Listener = () => void;
const listeners = new Set<Listener>();

let current: SharedOperationalClockRecord | null = null;
let lastFaceKey = "";
let channel: RealtimeChannel | null = null;
let started = false;
let pullWarned = false;

function wallSydneyDateIso(): string {
  return getSydneyIsoDate(new Date());
}

function faceOf(record: SharedOperationalClockRecord | null): SharedClockFace | null {
  if (!record?.enabled || !record.date || !record.time || !record.setOnWallDate) return null;
  if (record.setOnWallDate !== wallSydneyDateIso()) return null;
  return { date: record.date, time: record.time };
}

function faceKey(record: SharedOperationalClockRecord | null): string {
  const face = faceOf(record);
  return face ? `${face.date}T${face.time}` : "off";
}

function emitIfFaceChanged(prev: SharedOperationalClockRecord | null): void {
  const nextKey = faceKey(current);
  if (nextKey === lastFaceKey) return;
  const expired =
    faceKey(prev) !== "off" &&
    nextKey === "off" &&
    !!current?.enabled &&
    current.setOnWallDate !== wallSydneyDateIso();
  lastFaceKey = nextKey;
  if (expired) {
    toast.message("Exercise clock expired", {
      description: "A new calendar day started. Everyone is on the live clock until it is set again.",
    });
  }
  for (const listener of listeners) listener();
}

export function subscribeSharedClock(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Active exercise face, or null when off or past Sydney midnight. */
export function getSharedOperationalOverride(): SharedClockFace | null {
  return faceOf(current);
}

export function isSharedOperationalClockOn(): boolean {
  return getSharedOperationalOverride() != null;
}

function asRecord(value: unknown): SharedOperationalClockRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<SharedOperationalClockRecord>;
  return {
    enabled: row.enabled === true,
    date: typeof row.date === "string" ? row.date : null,
    time: typeof row.time === "string" ? row.time : null,
    setOnWallDate: typeof row.setOnWallDate === "string" ? row.setOnWallDate : null,
    revision: typeof row.revision === "number" ? row.revision : 0,
  };
}

function accept(next: SharedOperationalClockRecord | null): void {
  if (
    current &&
    next &&
    next.revision < current.revision &&
    next.setOnWallDate === current.setOnWallDate
  ) {
    return;
  }
  const prev = current;
  const same =
    !!prev &&
    !!next &&
    prev.enabled === next.enabled &&
    prev.date === next.date &&
    prev.time === next.time &&
    prev.setOnWallDate === next.setOnWallDate &&
    prev.revision === next.revision;
  if (same) {
    emitIfFaceChanged(prev);
    return;
  }
  current = next;
  emitIfFaceChanged(prev);
}

async function pull(): Promise<void> {
  const { data, error } = await supabase
    .from("system_parameters")
    .select("value")
    .eq("key", SHARED_OPERATIONAL_CLOCK_KEY)
    .maybeSingle();
  if (error) {
    if (!pullWarned) {
      pullWarned = true;
      console.warn("[shared-clock] read failed", error.message);
    }
    return;
  }
  accept(asRecord(data?.value ?? null));
}

function rememberLocal(next: SharedOperationalClockRecord): void {
  accept(next);
}

async function staffIdForPublish(): Promise<string> {
  const { getActiveUserProfile } = await import("@/lib/data-store");
  const staffId = getActiveUserProfile()?.staffId ?? "";
  if (!staffId) throw new Error("Sign in before setting the exercise clock.");
  return staffId;
}

async function writeRecord(record: SharedOperationalClockRecord): Promise<void> {
  const staffId = await staffIdForPublish();
  const rpc = await supabase.rpc("set_shared_operational_clock", {
    _staff_id: staffId,
    _value: record,
  });
  if (!rpc.error) {
    void channel?.send({ type: "broadcast", event: "clock", payload: record });
    return;
  }
  const blob = `${rpc.error.message ?? ""} ${rpc.error.details ?? ""}`.toLowerCase();
  const missing =
    rpc.error.code === "PGRST202" ||
    rpc.error.code === "42883" ||
    blob.includes("set_shared_operational_clock") ||
    blob.includes("could not find the function");
  if (!missing) throw new Error(rpc.error.message);

  const { data, error } = await supabase
    .from("system_parameters")
    .update({
      value: record,
      updated_by: staffId,
      updated_at: new Date().toISOString(),
    })
    .eq("key", SHARED_OPERATIONAL_CLOCK_KEY)
    .select("key");
  if (error) throw new Error(error.message);
  if (!data?.length) {
    throw new Error(
      "Exercise clock is not on the database yet. Run docs/sql/2026-10-23_shared_operational_clock.sql.",
    );
  }
  void channel?.send({ type: "broadcast", event: "clock", payload: record });
}

async function ledgerClock(record: SharedOperationalClockRecord): Promise<void> {
  try {
    const { writeToLedger } = await import("@/lib/api/ledger");
    const { getActiveUserProfile } = await import("@/lib/data-store");
    const staffId = getActiveUserProfile()?.staffId;
    if (!staffId) return;
    const summary = record.enabled
      ? `Exercise clock on for everyone: ${record.date} ${record.time} Sydney.`
      : "Exercise clock off. Everyone is on the live clock.";
    await writeToLedger({
      staff_id: staffId,
      category: "CENTRE",
      severity: "INFO",
      action_type: "SHARED_OPERATIONAL_CLOCK",
      gps_lat: null,
      gps_lng: null,
      metadata: {
        enabled: record.enabled,
        date: record.date,
        time: record.time,
        summary,
      },
    });
  } catch (err) {
    console.warn("[shared-clock] ledger", err);
  }
}

/**
 * Publish the exercise clock. `null` turns it off for everyone.
 * Optimistic on this browser, then saved for the other browsers.
 */
export async function publishSharedOperationalClock(
  next: SharedClockFace | null,
): Promise<void> {
  if (!IS_TEST_BUILD) return;
  if (!canUseDevTools()) {
    throw new Error("Only Craig can set the exercise clock for everyone.");
  }
  const prev = current;
  const [hh, mm] = (next?.time ?? "").trim().split(":").map(Number);
  const time = `${String(Math.min(23, Math.max(0, hh ?? 0))).padStart(2, "0")}:${String(Math.min(59, Math.max(0, mm ?? 0))).padStart(2, "0")}`;
  const record: SharedOperationalClockRecord = next
    ? {
        enabled: true,
        date: next.date,
        time,
        setOnWallDate: wallSydneyDateIso(),
        revision: (current?.revision ?? 0) + 1,
      }
    : {
        enabled: false,
        date: null,
        time: null,
        setOnWallDate: null,
        revision: (current?.revision ?? 0) + 1,
      };
  rememberLocal(record);
  try {
    await writeRecord(record);
  } catch (err) {
    accept(prev);
    throw err;
  }
  void ledgerClock(record);
}

/** Poll + broadcast so every open browser follows Craig's clock. */
export function startSharedOperationalClockSync(): void {
  if (!IS_TEST_BUILD || started || typeof window === "undefined") return;
  started = true;
  void pull();
  window.setInterval(() => {
    void pull();
  }, POLL_MS);

  channel = supabase
    .channel(CHANNEL_NAME)
    .on("broadcast", { event: "clock" }, (message) => {
      accept(asRecord(message.payload ?? null));
    })
    .subscribe();
}
