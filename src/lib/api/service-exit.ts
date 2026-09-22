/**
 * Immediate service exit for clients and staff/volunteers.
 * SQL: docs/sql/2026-09-23_service_exit.sql
 *
 * History stays on the same UUID. Future schedules, meds, and bookings end.
 * Does not restore those plans on reactivate.
 */
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { recordOfficeChangeBestEffort } from "@/lib/api/office-change-log";
import {
  discontinueMedicationSchedule,
  removeAttendanceSchedule,
} from "@/lib/data-store";
import { getOperationalTodayIso, operationalNowIso } from "@/lib/operational-clock";
import {
  exitReasonLabel,
  isDeceasedExit,
  type ClientExitReason,
  type StaffExitReason,
} from "@/lib/service-exit";

export const SQL_HINT =
  "Run docs/sql/2026-09-23_service_exit.sql on this database, then hard-refresh.";

const OPEN_CENTRE_PHASES = new Set(["open_pending", "active_day", "escalated_lock"]);
const LIVE_EVENT_PHASES = new Set(["pre_departure", "active", "in_transit", "at_base"]);

type PgErr = { code?: string | null; message?: string | null } | null;

function schemaOrThrow(error: PgErr, fallback = "Save failed"): void {
  if (!error) return;
  if (isSchemaMismatchError(error)) throw new Error(SQL_HINT);
  throw new Error(error.message || fallback);
}

function isManagerRole(personnelType: string | null, title: string | null): boolean {
  const access = (personnelType ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  const roleTitle = (title ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (access === "guardian" || roleTitle === "guardian") return false;
  if (access === "dashboard" || roleTitle === "dashboard") return false;
  const primary = access || roleTitle;
  if (!primary) return false;
  if (
    primary === "driver" ||
    primary === "support_worker" ||
    primary === "support" ||
    primary.includes("driver")
  ) {
    return false;
  }
  if (
    primary === "coordinator" ||
    primary === "manager" ||
    primary === "assistant_manager" ||
    primary.includes("manager")
  ) {
    return true;
  }
  const fallback = access ? roleTitle : "";
  return (
    fallback === "coordinator" ||
    fallback === "manager" ||
    fallback === "assistant_manager" ||
    fallback.includes("manager")
  );
}

export async function resolveAuthorisingManager(
  pin: string,
): Promise<{ id: string; fullName: string }> {
  if (!/^\d{4,}$/.test(pin)) {
    throw new Error("Enter the manager’s 4-digit PIN.");
  }
  const { data, error } = await supabase.rpc("verify_operator_pin", {
    entered_pin: pin,
  });
  if (error) throw new Error(error.message || "Could not verify that PIN.");
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<{
    id: string;
    full_name?: string | null;
    role: string | null;
    personnel_type?: string | null;
  }>;
  const record = rows[0];
  if (!record?.id) throw new Error("PIN not recognised.");
  if (!isManagerRole(record.personnel_type ?? null, record.role ?? null)) {
    throw new Error("A manager PIN is required. Guardian and dashboard PINs cannot authorise this.");
  }
  return { id: record.id, fullName: record.full_name || "Manager" };
}

function oneJoin<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function isLiveOpenEvent(status: string | null, endDate: string | null, today: string): boolean {
  if (status !== "Open") return false;
  const end = (endDate ?? "").slice(0, 10);
  return end === "" || end >= today;
}

async function openCentreSessionIds(today: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("site_day_sessions")
    .select("id, phase")
    .eq("session_date", today);
  if (error) {
    if (isSchemaMismatchError(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? [])
    .filter((row) => OPEN_CENTRE_PHASES.has(String((row as { phase?: string }).phase ?? "")))
    .map((row) => String((row as { id: string }).id));
}

async function liveEventSessionIds(today: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("event_day_sessions")
    .select("id, phase")
    .eq("session_date", today);
  if (error) {
    if (isSchemaMismatchError(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? [])
    .filter((row) => LIVE_EVENT_PHASES.has(String((row as { phase?: string }).phase ?? "")))
    .map((row) => String((row as { id: string }).id));
}

export async function assertClearOfLiveService(input: {
  displayName: string;
  participantId?: string | null;
  staffId?: string | null;
}): Promise<void> {
  const today = getOperationalTodayIso();
  const blocks: string[] = [];
  const participantId = (input.participantId ?? "").trim();
  const staffId = (input.staffId ?? "").trim();

  const centreIds = await openCentreSessionIds(today);
  const eventIds = await liveEventSessionIds(today);

  if (participantId && centreIds.length > 0) {
    const { data, error } = await supabase
      .from("client_attendance_log")
      .select("id")
      .in("session_id", centreIds)
      .eq("participant_id", participantId)
      .eq("status", "checked_in")
      .limit(1);
    if (error && !isSchemaMismatchError(error)) throw new Error(error.message);
    if ((data ?? []).length > 0) blocks.push("checked in at Day Centre");
  }

  if (staffId && centreIds.length > 0) {
    const { data, error } = await supabase
      .from("support_attendance_log")
      .select("id")
      .in("session_id", centreIds)
      .eq("staff_id", staffId)
      .eq("status", "checked_in")
      .limit(1);
    if (error && !isSchemaMismatchError(error)) throw new Error(error.message);
    if ((data ?? []).length > 0) blocks.push("checked in at Day Centre");
  }

  if (participantId && eventIds.length > 0) {
    const { data, error } = await supabase
      .from("event_attendance_log")
      .select("id")
      .in("event_day_session_id", eventIds)
      .eq("participant_id", participantId)
      .eq("status", "checked_in")
      .limit(1);
    if (error && !isSchemaMismatchError(error)) throw new Error(error.message);
    if ((data ?? []).length > 0) blocks.push("checked in on today’s trip");
  }

  if (staffId && eventIds.length > 0) {
    const { data, error } = await supabase
      .from("event_support_attendance_log")
      .select("id")
      .in("event_day_session_id", eventIds)
      .eq("staff_id", staffId)
      .eq("status", "checked_in")
      .limit(1);
    if (error && !isSchemaMismatchError(error)) throw new Error(error.message);
    if ((data ?? []).length > 0) blocks.push("checked in on today’s trip");
  }

  const { data: trips, error: tripErr } = await supabase
    .from("transport_trips")
    .select("id, driver_staff_id")
    .eq("status", "active");
  if (tripErr && !isSchemaMismatchError(tripErr)) throw new Error(tripErr.message);
  const activeTrips = (trips ?? []) as Array<{ id: string; driver_staff_id?: string | null }>;
  if (staffId && activeTrips.some((t) => t.driver_staff_id === staffId)) {
    blocks.push("driving a live manifest");
  }
  const tripIds = activeTrips.map((t) => t.id);
  if (tripIds.length > 0 && (participantId || staffId)) {
    const { data: legs, error: legErr } = await supabase
      .from("trip_legs")
      .select("to_participant_id, from_participant_id, to_staff_id, from_staff_id")
      .in("trip_id", tripIds);
    if (legErr && !isSchemaMismatchError(legErr)) throw new Error(legErr.message);
    const onBus = (legs ?? []).some((leg) => {
      const row = leg as {
        to_participant_id?: string | null;
        from_participant_id?: string | null;
        to_staff_id?: string | null;
        from_staff_id?: string | null;
      };
      if (participantId && (row.to_participant_id === participantId || row.from_participant_id === participantId)) {
        return true;
      }
      if (staffId && (row.to_staff_id === staffId || row.from_staff_id === staffId)) return true;
      return false;
    });
    if (onBus) blocks.push("on a live bus manifest");
  }

  if (staffId) {
    const { data, error } = await supabase
      .from("event_day_sessions")
      .select("id, phase")
      .eq("manager_staff_id", staffId)
      .eq("session_date", today);
    if (error && !isSchemaMismatchError(error)) throw new Error(error.message);
    const leading = (data ?? []).some((row) =>
      LIVE_EVENT_PHASES.has(String((row as { phase?: string }).phase ?? "")),
    );
    if (leading) blocks.push("trip leader today");
  }

  if (participantId) {
    const titles = await liveOpenBookingTitles("event_roster_bookings", "participant_id", participantId, today);
    if (titles.length > 0) blocks.push(`booked on open event ${titles.join(", ")}`);
  }
  if (staffId) {
    const titles = await liveOpenBookingTitles("event_support_bookings", "staff_id", staffId, today);
    if (titles.length > 0) blocks.push(`booked on open event ${titles.join(", ")}`);
  }

  if (blocks.length === 0) return;
  throw new Error(`Finish today first. ${input.displayName} is ${blocks.join("; ")}.`);
}

async function liveOpenBookingTitles(
  table: "event_roster_bookings" | "event_support_bookings",
  column: "participant_id" | "staff_id",
  personId: string,
  today: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from(table)
    .select("booking_status, event_manifest!inner(title, status, end_date)")
    .eq(column, personId)
    .neq("booking_status", "Cancelled");
  if (error) {
    if (isSchemaMismatchError(error)) return [];
    throw new Error(error.message);
  }
  const titles: string[] = [];
  for (const raw of data ?? []) {
    const row = raw as {
      event_manifest?:
        | { title?: string | null; status?: string | null; end_date?: string | null }
        | Array<{ title?: string | null; status?: string | null; end_date?: string | null }>
        | null;
    };
    const event = oneJoin(row.event_manifest);
    if (!event || !isLiveOpenEvent(event.status ?? null, event.end_date ?? null, today)) continue;
    const title = (event.title ?? "Event").trim() || "Event";
    if (!titles.includes(title)) titles.push(title);
  }
  return titles;
}

async function cancelFutureBookings(
  table: "event_roster_bookings" | "event_support_bookings",
  column: "participant_id" | "staff_id",
  personId: string,
): Promise<number> {
  const today = getOperationalTodayIso();
  const { data, error } = await supabase
    .from(table)
    .select("id, booking_status, event_manifest!inner(status, end_date)")
    .eq(column, personId)
    .neq("booking_status", "Cancelled");
  if (error) {
    if (isSchemaMismatchError(error)) return 0;
    throw new Error(error.message);
  }
  const ids: string[] = [];
  for (const raw of data ?? []) {
    const row = raw as {
      id: string;
      event_manifest?:
        | { status?: string | null; end_date?: string | null }
        | Array<{ status?: string | null; end_date?: string | null }>
        | null;
    };
    const event = oneJoin(row.event_manifest);
    const status = event?.status ?? "";
    if (status === "Closed") continue;
    if (isLiveOpenEvent(status, event?.end_date ?? null, today)) continue;
    ids.push(row.id);
  }
  if (ids.length === 0) return 0;
  const { error: updErr } = await supabase
    .from(table)
    .update({ booking_status: "Cancelled" })
    .in("id", ids);
  if (updErr) throw new Error(updErr.message);
  return ids.length;
}

async function clearExpectedRows(input: {
  table: "client_attendance_log" | "support_attendance_log";
  column: "participant_id" | "staff_id";
  personId: string;
}): Promise<void> {
  const ids = await openCentreSessionIds(getOperationalTodayIso());
  if (ids.length === 0) return;
  const { error } = await supabase
    .from(input.table)
    .delete()
    .in("session_id", ids)
    .eq(input.column, input.personId)
    .eq("status", "expected");
  if (error && !isSchemaMismatchError(error)) throw new Error(error.message);
}

async function endClientForwardPlans(
  participantId: string,
  managerId: string,
  reasonLabel: string,
): Promise<void> {
  const { data: schedules, error: schedErr } = await supabase
    .from("participant_attendance_schedules")
    .select("id")
    .eq("participant_id", participantId)
    .eq("active", true);
  if (schedErr) throw new Error(schedErr.message);
  for (const row of schedules ?? []) {
    await removeAttendanceSchedule({
      id: (row as { id: string }).id,
      reason: "Service exit",
      staffId: managerId,
    });
  }

  const { data: meds, error: medErr } = await supabase
    .from("participant_medication_schedules")
    .select("id")
    .eq("participant_id", participantId)
    .eq("active", true);
  if (medErr) throw new Error(medErr.message);
  for (const row of meds ?? []) {
    await discontinueMedicationSchedule({
      id: (row as { id: string }).id,
      authorizedById: managerId,
      witnessedById: managerId,
      referenceType: "Management Operational Directive",
      reason: `Service exit — ${reasonLabel}`,
    });
  }

  await cancelFutureBookings("event_roster_bookings", "participant_id", participantId);
  await clearExpectedRows({
    table: "client_attendance_log",
    column: "participant_id",
    personId: participantId,
  });
}

async function endStaffForwardPlans(staffId: string): Promise<void> {
  const { data, error } = await supabase
    .from("support_attendance_schedules")
    .select("id")
    .eq("staff_id", staffId)
    .eq("active", true);
  if (error && !isSchemaMismatchError(error)) throw new Error(error.message);
  const ids = (data ?? []).map((row) => (row as { id: string }).id);
  if (ids.length > 0) {
    const { error: updErr } = await supabase
      .from("support_attendance_schedules")
      .update({ active: false })
      .in("id", ids);
    if (updErr) throw new Error(updErr.message);
  }
  await cancelFutureBookings("event_support_bookings", "staff_id", staffId);
  await clearExpectedRows({
    table: "support_attendance_log",
    column: "staff_id",
    personId: staffId,
  });
}

function assertNotes(reason: string, notes: string, mode: "offboard" | "reactivate"): string {
  const trimmed = notes.trim();
  const required =
    mode === "reactivate" || reason === "other" || reason === "deceased";
  if (required && trimmed.length < 20) {
    throw new Error("Notes must be at least 20 characters.");
  }
  return trimmed;
}

export async function offboardClient(input: {
  participantId: string;
  displayName: string;
  reason: ClientExitReason | string;
  notes: string;
  managerPin: string;
}): Promise<{ exitedAt: string }> {
  const reason = input.reason.trim();
  const notes = assertNotes(reason, input.notes, "offboard");
  const manager = await resolveAuthorisingManager(input.managerPin);
  await assertClearOfLiveService({
    displayName: input.displayName,
    participantId: input.participantId,
  });

  const { data: existing, error: readErr } = await supabase
    .from("participants")
    .select("id, participant_kind, service_status")
    .eq("id", input.participantId)
    .maybeSingle();
  schemaOrThrow(readErr, "Could not read this client.");
  const row = existing as {
    participant_kind?: string | null;
    service_status?: string | null;
  } | null;
  if (!row) throw new Error("Client not found.");
  if (row.participant_kind === "guest") {
    throw new Error("Guests use Archive guest. Service exit is for clients.");
  }
  const already = row.service_status === "exited";
  const now = operationalNowIso();
  if (!already) {
    const { error } = await supabase
      .from("participants")
      .update({
        service_status: "exited",
        exited_at: now,
        exited_by_id: manager.id,
        exit_reason: reason,
        exit_notes: notes || null,
      })
      .eq("id", input.participantId);
    schemaOrThrow(error);
    void recordOfficeChangeBestEffort({
      action: "archived",
      entity: "client",
      recordId: input.participantId,
      recordName: input.displayName,
      summary: `Off-boarded client ${input.displayName} (${exitReasonLabel(reason)})`,
      before: { serviceStatus: "active" },
      after: { serviceStatus: "exited", exitReason: reason, exitNotes: notes || null },
    });
  }

  await endClientForwardPlans(input.participantId, manager.id, exitReasonLabel(reason));
  return { exitedAt: now };
}

export async function reactivateClient(input: {
  participantId: string;
  displayName: string;
  notes: string;
  managerPin: string;
}): Promise<void> {
  const notes = assertNotes("", input.notes, "reactivate");
  const manager = await resolveAuthorisingManager(input.managerPin);
  const { data, error: readErr } = await supabase
    .from("participants")
    .select("service_status, exit_reason")
    .eq("id", input.participantId)
    .maybeSingle();
  schemaOrThrow(readErr);
  const row = data as { service_status?: string | null; exit_reason?: string | null } | null;
  if (!row) throw new Error("Client not found.");
  if (isDeceasedExit(row.exit_reason)) {
    throw new Error("A person recorded as deceased cannot be reactivated.");
  }
  const { error } = await supabase
    .from("participants")
    .update({
      service_status: "active",
      exited_at: null,
      exited_by_id: null,
      exit_reason: null,
      exit_notes: null,
    })
    .eq("id", input.participantId);
  schemaOrThrow(error);
  void recordOfficeChangeBestEffort({
    action: "updated",
    entity: "client",
    recordId: input.participantId,
    recordName: input.displayName,
    summary: `Reactivated client ${input.displayName}`,
    before: { serviceStatus: "exited" },
    after: { serviceStatus: "active", returnNotes: notes, authorisedBy: manager.fullName },
  });
}

async function signOutIfSelf(staffId: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return;
  let row: { email?: string | null; auth_user_id?: string | null } | null = null;
  const withAuth = await supabase
    .from("staff_registry")
    .select("email, auth_user_id")
    .eq("id", staffId)
    .maybeSingle();
  if (withAuth.error && /auth_user_id/i.test(withAuth.error.message ?? "")) {
    const emailOnly = await supabase
      .from("staff_registry")
      .select("email")
      .eq("id", staffId)
      .maybeSingle();
    if (emailOnly.error || !emailOnly.data) return;
    row = emailOnly.data as { email?: string | null };
  } else if (withAuth.error || !withAuth.data) {
    return;
  } else {
    row = withAuth.data as { email?: string | null; auth_user_id?: string | null };
  }
  const email = (row?.email ?? "").trim().toLowerCase();
  const sessionEmail = (user.email ?? "").trim().toLowerCase();
  const emailMatch = email.includes("@") && email === sessionEmail;
  const authMatch = !!row?.auth_user_id && row.auth_user_id === user.id;
  if (emailMatch || authMatch) await supabase.auth.signOut();
}

export async function offboardStaff(input: {
  staffId: string;
  displayName: string;
  reason: StaffExitReason | string;
  notes: string;
  managerPin: string;
}): Promise<{ exitedAt: string }> {
  const reason = input.reason.trim();
  const notes = assertNotes(reason, input.notes, "offboard");
  const manager = await resolveAuthorisingManager(input.managerPin);
  await assertClearOfLiveService({
    displayName: input.displayName,
    staffId: input.staffId,
  });

  const { data: existing, error: readErr } = await supabase
    .from("staff_registry")
    .select("active, exited_at")
    .eq("id", input.staffId)
    .maybeSingle();
  schemaOrThrow(readErr);
  const row = existing as { active?: boolean | null; exited_at?: string | null } | null;
  if (!row) throw new Error("Staff member not found.");
  const already = row.active === false;
  const now = operationalNowIso();
  const patch: Record<string, unknown> = {
    active: false,
    exited_by_id: manager.id,
    exit_reason: reason,
    exit_notes: notes || null,
  };
  if (!already) patch.exited_at = now;
  const { error } = await supabase.from("staff_registry").update(patch).eq("id", input.staffId);
  schemaOrThrow(error);
  if (!already) {
    void recordOfficeChangeBestEffort({
      action: "archived",
      entity: "staff",
      recordId: input.staffId,
      recordName: input.displayName,
      summary: `Off-boarded staff ${input.displayName} (${exitReasonLabel(reason)})`,
      before: { active: true },
      after: { active: false, exitReason: reason, exitNotes: notes || null },
    });
  }
  await endStaffForwardPlans(input.staffId);
  await signOutIfSelf(input.staffId);
  return { exitedAt: already ? (row.exited_at ?? now) : now };
}

export async function reactivateStaff(input: {
  staffId: string;
  displayName: string;
  notes: string;
  managerPin: string;
}): Promise<void> {
  const notes = assertNotes("", input.notes, "reactivate");
  const manager = await resolveAuthorisingManager(input.managerPin);
  const { data, error: readErr } = await supabase
    .from("staff_registry")
    .select("exit_reason")
    .eq("id", input.staffId)
    .maybeSingle();
  schemaOrThrow(readErr);
  const row = data as { exit_reason?: string | null } | null;
  if (!row) throw new Error("Staff member not found.");
  if (isDeceasedExit(row.exit_reason)) {
    throw new Error("A person recorded as deceased cannot be reactivated.");
  }
  const { error } = await supabase
    .from("staff_registry")
    .update({
      active: true,
      exited_at: null,
      exited_by_id: null,
      exit_reason: null,
      exit_notes: null,
    })
    .eq("id", input.staffId);
  schemaOrThrow(error);
  void recordOfficeChangeBestEffort({
    action: "updated",
    entity: "staff",
    recordId: input.staffId,
    recordName: input.displayName,
    summary: `Reactivated staff ${input.displayName}`,
    before: { active: false },
    after: { active: true, returnNotes: notes, authorisedBy: manager.fullName },
  });
}

export async function loadExitedParticipantIds(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("participants")
    .select("id, participant_kind")
    .eq("service_status", "exited");
  if (error) {
    if (isSchemaMismatchError(error)) return new Set();
    throw new Error(error.message);
  }
  const ids = new Set<string>();
  for (const raw of data ?? []) {
    const row = raw as { id: string; participant_kind?: string | null };
    if (row.participant_kind === "guest") continue;
    ids.add(row.id);
  }
  return ids;
}

export async function loadInactiveStaffIds(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("staff_registry")
    .select("id")
    .eq("active", false);
  if (error) {
    if (isSchemaMismatchError(error)) return new Set();
    throw new Error(error.message);
  }
  return new Set((data ?? []).map((row) => (row as { id: string }).id));
}
