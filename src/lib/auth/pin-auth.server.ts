/**
 * Server-only PIN login. Pepper never goes to the browser.
 * Everyone starts on the PIN pad. A floor PIN mints that person's session.
 * A manager PIN does not. It must be followed by that same person's email and password.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { getRequestIP } from "@tanstack/react-start/server";

import {
  floorRoleForStaff,
  isBlockedTerminalAccess,
  isManagerLevelAccess,
  trivialPinReason,
  type PinProfile,
} from "@/lib/auth/pin-role";
import {
  createPublishableServerClient,
  createServiceServerClient,
} from "@/lib/supabase.server";

const UPGRADE_TTL_MS = 10 * 60 * 1000;

type PersonKind = "staff" | "carer";

type PersonRow = {
  kind: PersonKind;
  id: string;
  full_name: string | null;
  role: string | null;
  personnel_type: string | null;
  active: boolean | null;
  email: string | null;
  pin_hash: string | null;
  pin_lookup: string | null;
  pin_digits: number | null;
  pin_failed_count: number | null;
  pin_locked_at: string | null;
  auth_user_id: string | null;
};

const STAFF_COLS =
  "id, full_name, role, personnel_type, active, email, pin_hash, pin_lookup, pin_digits, pin_failed_count, pin_locked_at, auth_user_id";
const CARER_COLS_BASE =
  "id, full_name, email, pin_hash, pin_lookup, pin_digits, pin_failed_count, pin_locked_at, auth_user_id";
const CARER_COLS = `${CARER_COLS_BASE}, exited_at`;

function missingExitColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return error.code === "42703" || error.code === "PGRST204" || msg.includes("exited_at");
}

async function selectCarerRow(
  run: (cols: string) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>,
): Promise<{ data: unknown; error: { code?: string; message?: string } | null }> {
  const first = await run(CARER_COLS);
  if (missingExitColumn(first.error)) return run(CARER_COLS_BASE);
  return first;
}

export class PinAuthError extends Error {
  readonly deviceLockedUntil?: string;
  constructor(message: string, deviceLockedUntil?: string) {
    super(message);
    this.name = "PinAuthError";
    this.deviceLockedUntil = deviceLockedUntil;
  }
}

function pepper(): string {
  const value = (process.env.PIN_PEPPER ?? "").trim();
  if (value.length < 16) {
    throw new PinAuthError(
      "PIN login is not configured. Set PIN_PEPPER (at least 16 characters) on the app server.",
    );
  }
  return value;
}

function sha256Hex(pin: string): string {
  return createHash("sha256").update(pin, "utf8").digest("hex");
}

function lookupHex(pin: string): string {
  return createHmac("sha256", pepper()).update(pin, "utf8").digest("hex");
}

function sameHex(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

function service() {
  return createServiceServerClient();
}

async function pinLimits(): Promise<{ maxPerson: number; maxDevice: number; lockMinutes: number }> {
  const defaults = { maxPerson: 5, maxDevice: 8, lockMinutes: 15 };
  const { data, error } = await service()
    .from("system_parameters")
    .select("key, value")
    .in("key", [
      "auth_pin_max_attempts",
      "auth_pin_device_max_attempts",
      "auth_pin_device_lock_minutes",
    ]);
  if (error || !data) return defaults;
  const read = (key: string, fallback: number) => {
    const row = (data as Array<{ key: string; value: unknown }>).find((r) => r.key === key);
    const n = typeof row?.value === "number" ? row.value : Number(row?.value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  return {
    maxPerson: read("auth_pin_max_attempts", defaults.maxPerson),
    maxDevice: read("auth_pin_device_max_attempts", defaults.maxDevice),
    lockMinutes: read("auth_pin_device_lock_minutes", defaults.lockMinutes),
  };
}

function clientIp(): string {
  try {
    const ip = getRequestIP({ xForwardedFor: true });
    return (ip ?? "unknown").trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function deviceKey(deviceId: string): string {
  const id = deviceId.trim().slice(0, 80);
  return `device:${id || "unknown"}`;
}

async function assertPadOpen(deviceId: string): Promise<void> {
  const ip = clientIp();
  const keys = [deviceKey(deviceId), `ip:${ip}`];
  const { data } = await service()
    .from("pin_pad_lockouts")
    .select("scope_key, locked_until")
    .in("scope_key", keys);
  const now = Date.now();
  for (const row of (data ?? []) as Array<{ scope_key: string; locked_until: string | null }>) {
    if (!row.locked_until) continue;
    const until = new Date(row.locked_until).getTime();
    if (until > now) {
      const mins = Math.max(1, Math.ceil((until - now) / 60000));
      throw new PinAuthError(
        `Too many tries on this tablet. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
        row.locked_until,
      );
    }
  }
}

async function notePadFailure(deviceId: string): Promise<void> {
  const limits = await pinLimits();
  const keys = [deviceKey(deviceId), `ip:${clientIp()}`];
  const db = service();
  for (const key of keys) {
    const { data } = await db
      .from("pin_pad_lockouts")
      .select("fail_count, window_started_at, locked_until")
      .eq("scope_key", key)
      .maybeSingle();
    const row = data as {
      fail_count: number;
      window_started_at: string;
      locked_until: string | null;
    } | null;
    const now = Date.now();
    const windowMs = limits.lockMinutes * 60 * 1000;
    const windowStart = row ? new Date(row.window_started_at).getTime() : 0;
    const lockedUntil = row?.locked_until ? new Date(row.locked_until).getTime() : 0;
    const fresh = !row || (lockedUntil <= now && now - windowStart > windowMs);
    const failCount = fresh ? 1 : (row?.fail_count ?? 0) + 1;
    const lock = failCount >= limits.maxDevice;
    await db.from("pin_pad_lockouts").upsert({
      scope_key: key,
      fail_count: lock ? 0 : failCount,
      window_started_at: fresh || lock ? new Date().toISOString() : row?.window_started_at,
      locked_until: lock
        ? new Date(now + windowMs).toISOString()
        : null,
    });
  }
}

async function clearPadFailures(deviceId: string): Promise<void> {
  const keys = [deviceKey(deviceId), `ip:${clientIp()}`];
  await service().from("pin_pad_lockouts").delete().in("scope_key", keys);
}

function isLocked(row: PersonRow, maxPerson: number): boolean {
  if (row.pin_locked_at) return true;
  return (row.pin_failed_count ?? 0) >= maxPerson;
}

async function markPersonFailure(row: PersonRow): Promise<void> {
  const limits = await pinLimits();
  const next = (row.pin_failed_count ?? 0) + 1;
  const patch = {
    pin_failed_count: next,
    pin_locked_at: next >= limits.maxPerson ? new Date().toISOString() : row.pin_locked_at,
  };
  const table = row.kind === "carer" ? "carers_registry" : "staff_registry";
  await service().from(table).update(patch).eq("id", row.id);
}

async function clearPersonFailures(row: PersonRow): Promise<void> {
  const table = row.kind === "carer" ? "carers_registry" : "staff_registry";
  await service()
    .from(table)
    .update({ pin_failed_count: 0, pin_locked_at: null })
    .eq("id", row.id);
}

function pinMatches(row: PersonRow, pin: string): "modern" | "legacy" | null {
  if (/^\d{6}$/.test(pin) && row.pin_lookup && sameHex(row.pin_lookup, lookupHex(pin))) {
    return "modern";
  }
  if (
    /^\d{4}$/.test(pin) &&
    !row.pin_lookup &&
    row.pin_hash &&
    sameHex(row.pin_hash.toLowerCase(), sha256Hex(pin))
  ) {
    return "legacy";
  }
  return null;
}

function staffFrom(raw: Record<string, unknown>): PersonRow {
  return {
    kind: "staff",
    id: String(raw.id),
    full_name: (raw.full_name as string | null) ?? null,
    role: (raw.role as string | null) ?? null,
    personnel_type: (raw.personnel_type as string | null) ?? null,
    active: (raw.active as boolean | null) ?? true,
    email: (raw.email as string | null) ?? null,
    pin_hash: (raw.pin_hash as string | null) ?? null,
    pin_lookup: (raw.pin_lookup as string | null) ?? null,
    pin_digits: (raw.pin_digits as number | null) ?? null,
    pin_failed_count: (raw.pin_failed_count as number | null) ?? 0,
    pin_locked_at: (raw.pin_locked_at as string | null) ?? null,
    auth_user_id: (raw.auth_user_id as string | null) ?? null,
  };
}

function carerFrom(raw: Record<string, unknown>): PersonRow {
  return {
    kind: "carer",
    id: String(raw.id),
    full_name: (raw.full_name as string | null) ?? null,
    role: null,
    personnel_type: null,
    active: !raw.exited_at,
    email: (raw.email as string | null) ?? null,
    pin_hash: (raw.pin_hash as string | null) ?? null,
    pin_lookup: (raw.pin_lookup as string | null) ?? null,
    pin_digits: (raw.pin_digits as number | null) ?? null,
    pin_failed_count: (raw.pin_failed_count as number | null) ?? 0,
    pin_locked_at: (raw.pin_locked_at as string | null) ?? null,
    auth_user_id: (raw.auth_user_id as string | null) ?? null,
  };
}

async function loadStaff(id: string): Promise<PersonRow | null> {
  const { data, error } = await service()
    .from("staff_registry")
    .select(STAFF_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new PinAuthError("Could not check that PIN. Try again.");
  return data ? staffFrom(data as Record<string, unknown>) : null;
}

async function loadCarer(id: string): Promise<PersonRow | null> {
  const { data, error } = await selectCarerRow((cols) =>
    service().from("carers_registry").select(cols).eq("id", id).maybeSingle(),
  );
  if (error) throw new PinAuthError("Could not check that PIN. Try again.");
  return data ? carerFrom(data as Record<string, unknown>) : null;
}

async function findByLookup(hex: string): Promise<PersonRow | null> {
  const db = service();
  const [staffRes, carerRes] = await Promise.all([
    db.from("staff_registry").select(STAFF_COLS).eq("pin_lookup", hex).maybeSingle(),
    selectCarerRow((cols) =>
      db.from("carers_registry").select(cols).eq("pin_lookup", hex).maybeSingle(),
    ),
  ]);
  if (staffRes.error || carerRes.error) {
    throw new PinAuthError("Could not check that PIN. Try again.");
  }
  const staff = staffRes.data ? staffFrom(staffRes.data as Record<string, unknown>) : null;
  const carer = carerRes.data ? carerFrom(carerRes.data as Record<string, unknown>) : null;
  if (staff && carer) {
    throw new PinAuthError(
      "This PIN is shared by more than one person. A manager must set a new PIN.",
    );
  }
  return staff ?? carer;
}

async function findLegacyStaff(pin: string): Promise<PersonRow | null> {
  const hash = sha256Hex(pin);
  const { data, error } = await service()
    .from("staff_registry")
    .select(STAFF_COLS)
    .is("pin_lookup", null)
    .eq("pin_hash", hash)
    .limit(2);
  if (error) throw new PinAuthError("Could not check that PIN. Try again.");
  const rows = ((data ?? []) as Record<string, unknown>[]).map(staffFrom);
  if (rows.length > 1) {
    throw new PinAuthError(
      "This PIN is shared by more than one person. A manager must set a new PIN.",
    );
  }
  return rows[0] ?? null;
}

function assertActive(row: PersonRow): void {
  if (row.active === false) {
    const name = (row.full_name ?? "This person").trim();
    throw new PinAuthError(`${name} has been off-boarded and cannot sign in.`);
  }
}

function assertNotPersonLocked(row: PersonRow, maxPerson: number): void {
  if (isLocked(row, maxPerson)) {
    throw new PinAuthError("This PIN is locked. A manager must unlock it.");
  }
}

async function sessionUser(accessToken: string): Promise<{ id: string; email: string | null }> {
  const token = accessToken.trim();
  if (!token) throw new PinAuthError("Sign in first.");
  const { data, error } = await service().auth.getUser(token);
  if (error || !data.user?.id) throw new PinAuthError("Sign in first.");
  return { id: data.user.id, email: data.user.email ?? null };
}

async function requireUserId(accessToken: string): Promise<string> {
  return (await sessionUser(accessToken)).id;
}

async function requireManagerCaller(accessToken: string): Promise<PersonRow> {
  const user = await sessionUser(accessToken);
  const row = await loadStaffForSession(user.id, user.email);
  if (!row || !isManagerLevelAccess(row.personnel_type, row.role) || row.active === false) {
    throw new PinAuthError("Only a manager can do that.");
  }
  return row;
}

async function loadStaffForSession(userId: string, email: string | null): Promise<PersonRow | null> {
  const db = service();
  const byId = await db.from("staff_registry").select(STAFF_COLS).eq("auth_user_id", userId).maybeSingle();
  if (byId.error) throw new PinAuthError("Could not check that sign-in. Try again.");
  if (byId.data) return staffFrom(byId.data as Record<string, unknown>);
  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized.includes("@")) return null;
  const byEmail = await db
    .from("staff_registry")
    .select(STAFF_COLS)
    .ilike("email", normalized)
    .maybeSingle();
  if (byEmail.error || !byEmail.data) return null;
  const row = staffFrom(byEmail.data as Record<string, unknown>);
  if (!row.auth_user_id) {
    await db.from("staff_registry").update({ auth_user_id: userId }).eq("id", row.id);
    row.auth_user_id = userId;
  }
  return row;
}

function signTicket(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", pepper()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function readTicket(
  token: string,
  purpose: string,
): { kind: PersonKind; id: string; needsUpgrade: boolean } {
  const [body, sig] = token.split(".");
  if (!body || !sig) throw new PinAuthError("That sign-in expired. Enter your PIN again.");
  const expected = createHmac("sha256", pepper()).update(body).digest("base64url");
  if (!sameHex(sig, expected)) {
    throw new PinAuthError("That sign-in expired. Enter your PIN again.");
  }
  let parsed: {
    purpose?: string;
    kind?: PersonKind;
    id?: string;
    exp?: number;
    needsUpgrade?: boolean;
  };
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as typeof parsed;
  } catch {
    throw new PinAuthError("That sign-in expired. Enter your PIN again.");
  }
  if (parsed.purpose !== purpose || (parsed.kind !== "staff" && parsed.kind !== "carer") || !parsed.id) {
    throw new PinAuthError("That sign-in expired. Enter your PIN again.");
  }
  if (!parsed.exp || parsed.exp < Date.now()) {
    throw new PinAuthError("That sign-in expired. Enter your PIN again.");
  }
  return { kind: parsed.kind, id: parsed.id, needsUpgrade: parsed.needsUpgrade === true };
}

function signUpgrade(row: PersonRow): string {
  return signTicket({
    purpose: "pin-upgrade",
    kind: row.kind,
    id: row.id,
    exp: Date.now() + UPGRADE_TTL_MS,
  });
}

function readUpgrade(token: string): { kind: PersonKind; id: string } {
  const ticket = readTicket(token, "pin-upgrade");
  return { kind: ticket.kind, id: ticket.id };
}

function signManagerConfirm(row: PersonRow): string {
  return signTicket({
    purpose: "manager-confirm",
    kind: "staff",
    id: row.id,
    needsUpgrade: !row.pin_lookup,
    exp: Date.now() + UPGRADE_TTL_MS,
  });
}

function personName(row: PersonRow): string {
  return (row.full_name ?? "You").trim() || "You";
}

async function lookupTaken(hex: string, except?: { kind: PersonKind; id: string }): Promise<boolean> {
  const db = service();
  const [staffRes, carerRes] = await Promise.all([
    db.from("staff_registry").select("id").eq("pin_lookup", hex).limit(2),
    db.from("carers_registry").select("id").eq("pin_lookup", hex).limit(2),
  ]);
  const ids = [
    ...((staffRes.data ?? []) as Array<{ id: string }>).map((r) => `staff:${r.id}`),
    ...((carerRes.data ?? []) as Array<{ id: string }>).map((r) => `carer:${r.id}`),
  ];
  const self = except ? `${except.kind}:${except.id}` : null;
  return ids.some((id) => id !== self);
}

async function savePin(row: PersonRow, pin: string): Promise<void> {
  const reason = trivialPinReason(pin);
  if (reason) throw new PinAuthError(reason);
  const hex = lookupHex(pin);
  if (await lookupTaken(hex, { kind: row.kind, id: row.id })) {
    throw new PinAuthError("That PIN is already used. Choose a different PIN.");
  }
  const table = row.kind === "carer" ? "carers_registry" : "staff_registry";
  // pin_hash is NOT NULL on staff_registry. Once pin_lookup is set, the old
  // 4-digit hash is ignored. Blank retires it without violating that constraint.
  const { error } = await service()
    .from(table)
    .update({
      pin_lookup: hex,
      pin_digits: 6,
      pin_hash: "",
      pin_failed_count: 0,
      pin_locked_at: null,
    })
    .eq("id", row.id);
  if (error) {
    console.error("savePin failed", error.code, error.message);
    throw new PinAuthError("Could not save that PIN. Try again.");
  }
}

async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const target = email.trim().toLowerCase();
  const db = service();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new PinAuthError("Could not open a session. Try again.");
    const hit = (data.users ?? []).find((u) => (u.email ?? "").trim().toLowerCase() === target);
    if (hit?.id) return hit.id;
    if ((data.users ?? []).length < 200) break;
  }
  return null;
}

async function authUserTaken(authUserId: string, row: PersonRow): Promise<boolean> {
  const db = service();
  const [staffRes, carerRes] = await Promise.all([
    db.from("staff_registry").select("id").eq("auth_user_id", authUserId).limit(2),
    db.from("carers_registry").select("id").eq("auth_user_id", authUserId).limit(2),
  ]);
  const owners = [
    ...((staffRes.data ?? []) as Array<{ id: string }>).map((r) => `staff:${r.id}`),
    ...((carerRes.data ?? []) as Array<{ id: string }>).map((r) => `carer:${r.id}`),
  ];
  const self = `${row.kind}:${row.id}`;
  return owners.some((id) => id !== self);
}

function internalEmail(row: PersonRow): string {
  return `pin.${row.kind}.${row.id}@users.yada.org.au`;
}

async function mintSession(row: PersonRow): Promise<{
  accessToken: string;
  refreshToken: string;
  profile: PinProfile;
}> {
  const db = service();
  let email = (row.email ?? "").trim().toLowerCase();
  if (!email.includes("@")) email = internalEmail(row);
  let authUserId = (row.auth_user_id ?? "").trim() || null;
  if (authUserId && (await authUserTaken(authUserId, row))) authUserId = null;
  if (!authUserId) {
    let existing = await findAuthUserIdByEmail(email);
    if (existing && (await authUserTaken(existing, row))) {
      email = internalEmail(row);
      existing = await findAuthUserIdByEmail(email);
      if (existing && (await authUserTaken(existing, row))) {
        throw new PinAuthError("Could not open a session. Try again.");
      }
    }
    authUserId = existing;
  }
  const password = randomBytes(32).toString("base64url");
  if (!authUserId) {
    const { data, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: row.full_name ?? undefined,
        person_kind: row.kind,
        person_id: row.id,
      },
    });
    if (error || !data.user?.id) {
      throw new PinAuthError(error?.message ?? "Could not open a session. Try again.");
    }
    authUserId = data.user.id;
  } else {
    const { error } = await db.auth.admin.updateUserById(authUserId, {
      password,
      email_confirm: true,
    });
    if (error) throw new PinAuthError("Could not open a session. Try again.");
  }
  if (row.auth_user_id !== authUserId) {
    const table = row.kind === "carer" ? "carers_registry" : "staff_registry";
    const { error } = await db.from(table).update({ auth_user_id: authUserId }).eq("id", row.id);
    if (error) throw new PinAuthError("Could not link this person to a sign-in. Try again.");
  }
  const anon = createPublishableServerClient();
  const { data: signed, error: signErr } = await anon.auth.signInWithPassword({ email, password });
  if (signErr || !signed.session) {
    throw new PinAuthError("Could not open a session. Try again.");
  }
  return {
    accessToken: signed.session.access_token,
    refreshToken: signed.session.refresh_token,
    profile: await profileFor(row, authUserId),
  };
}

async function profileFor(row: PersonRow, authUserId: string): Promise<PinProfile> {
  if (row.kind === "carer") {
    return {
      personKind: "carer",
      personId: row.id,
      fullName: (row.full_name ?? "Carer").trim() || "Carer",
      role: "carer",
      staffRole: null,
      accessRole: "carer",
      authUserId,
    };
  }
  const role = floorRoleForStaff(row.personnel_type, row.role);
  if (!role || role === "carer") {
    throw new PinAuthError("This PIN cannot be used to sign in.");
  }
  return {
    personKind: "staff",
    personId: row.id,
    fullName: (row.full_name ?? "Staff").trim() || "Staff",
    role,
    staffRole: row.role,
    accessRole: row.personnel_type,
    authUserId,
  };
}

function refuseBlockedTerminal(row: PersonRow): void {
  const blocked = isBlockedTerminalAccess(row.personnel_type, row.role);
  if (blocked === "guardian") {
    throw new PinAuthError(
      "Guardian PINs are for drop-off verification only and cannot be used to sign in.",
    );
  }
  if (blocked === "dashboard") {
    throw new PinAuthError("This PIN cannot be used to sign in.");
  }
}

function isManagerRow(row: PersonRow): boolean {
  return row.kind === "staff" && isManagerLevelAccess(row.personnel_type, row.role);
}

async function notePasswordFailure(row: PersonRow): Promise<void> {
  await markPersonFailure(row);
  const limits = await pinLimits();
  const fresh = await loadStaff(row.id);
  if (fresh && isLocked(fresh, limits.maxPerson)) {
    throw new PinAuthError("This PIN is locked. A manager must unlock it.");
  }
}

async function checkKnownPin(row: PersonRow, pin: string): Promise<"modern" | "legacy"> {
  const limits = await pinLimits();
  assertNotPersonLocked(row, limits.maxPerson);
  const match = pinMatches(row, pin);
  if (!match) {
    await markPersonFailure(row);
    const fresh = row.kind === "carer" ? await loadCarer(row.id) : await loadStaff(row.id);
    if (fresh && isLocked(fresh, limits.maxPerson)) {
      throw new PinAuthError("This PIN is locked. A manager must unlock it.");
    }
    throw new PinAuthError("Incorrect PIN. Please try again.");
  }
  if ((row.pin_failed_count ?? 0) > 0) await clearPersonFailures(row);
  return match;
}

export async function pinSignIn(args: {
  pin: string;
  deviceId: string;
}): Promise<
  | { status: "session"; accessToken: string; refreshToken: string; profile: PinProfile }
  | { status: "upgrade"; upgradeToken: string; personName: string }
  | { status: "manager-password"; confirmToken: string; personName: string; email: string }
> {
  const pin = args.pin.trim();
  await assertPadOpen(args.deviceId);
  if (!/^\d{4}$/.test(pin) && !/^\d{6}$/.test(pin)) {
    await notePadFailure(args.deviceId);
    throw new PinAuthError("Incorrect PIN. Please try again.");
  }
  let row: PersonRow | null = null;
  try {
    row = /^\d{6}$/.test(pin) ? await findByLookup(lookupHex(pin)) : await findLegacyStaff(pin);
  } catch (e) {
    if (e instanceof PinAuthError && e.message.includes("shared")) throw e;
    throw e;
  }
  if (!row) {
    await notePadFailure(args.deviceId);
    throw new PinAuthError("Incorrect PIN. Please try again.");
  }
  const limits = await pinLimits();
  if (isLocked(row, limits.maxPerson)) {
    throw new PinAuthError("This PIN is locked. A manager must unlock it.");
  }
  assertActive(row);
  refuseBlockedTerminal(row);
  if (isManagerRow(row)) {
    const email = (row.email ?? "").trim().toLowerCase();
    if (!email.includes("@")) {
      throw new PinAuthError(
        "This PIN needs an email on the staff form before a manager can finish signing in.",
      );
    }
    await clearPadFailures(args.deviceId);
    if ((row.pin_failed_count ?? 0) > 0) await clearPersonFailures(row);
    return {
      status: "manager-password",
      confirmToken: signManagerConfirm(row),
      personName: personName(row),
      email,
    };
  }
  if (!row.pin_lookup) {
    return {
      status: "upgrade",
      upgradeToken: signUpgrade(row),
      personName: personName(row),
    };
  }
  await clearPadFailures(args.deviceId);
  if ((row.pin_failed_count ?? 0) > 0) await clearPersonFailures(row);
  const minted = await mintSession(row);
  return { status: "session", ...minted };
}

export async function completePinUpgrade(args: {
  upgradeToken: string;
  newPin: string;
  confirmPin: string;
  deviceId: string;
}): Promise<{ accessToken: string; refreshToken: string; profile: PinProfile }> {
  if (args.newPin !== args.confirmPin) {
    throw new PinAuthError("The new PINs do not match.");
  }
  const ticket = readUpgrade(args.upgradeToken);
  const row = ticket.kind === "carer" ? await loadCarer(ticket.id) : await loadStaff(ticket.id);
  if (!row) throw new PinAuthError("That PIN change expired. Enter your current PIN again.");
  assertActive(row);
  if (isManagerRow(row)) {
    throw new PinAuthError("Enter your email and password to finish signing in.");
  }
  refuseBlockedTerminal(row);
  await savePin(row, args.newPin);
  await clearPadFailures(args.deviceId);
  const updated = (ticket.kind === "carer" ? await loadCarer(ticket.id) : await loadStaff(ticket.id)) ?? row;
  return mintSession(updated);
}

export async function confirmManagerPassword(args: {
  confirmToken: string;
  email: string;
  password: string;
}): Promise<
  | { status: "session"; accessToken: string; refreshToken: string; profile: PinProfile }
  | {
      status: "upgrade";
      upgradeToken: string;
      personName: string;
      accessToken: string;
      refreshToken: string;
    }
> {
  const ticket = readTicket(args.confirmToken, "manager-confirm");
  if (ticket.kind !== "staff") {
    throw new PinAuthError("That sign-in expired. Enter your PIN again.");
  }
  const row = await loadStaff(ticket.id);
  if (!row || !isManagerRow(row)) {
    throw new PinAuthError("That sign-in expired. Enter your PIN again.");
  }
  assertActive(row);
  const limits = await pinLimits();
  if (isLocked(row, limits.maxPerson)) {
    throw new PinAuthError("This PIN is locked. A manager must unlock it.");
  }
  const expected = (row.email ?? "").trim().toLowerCase();
  const typed = args.email.trim().toLowerCase();
  if (!expected.includes("@") || typed !== expected) {
    await notePasswordFailure(row);
    throw new PinAuthError("That email does not match this PIN.");
  }
  if (!args.password) {
    throw new PinAuthError("Enter the password for this PIN.");
  }
  const anon = createPublishableServerClient();
  const { data: signed, error: signErr } = await anon.auth.signInWithPassword({
    email: expected,
    password: args.password,
  });
  if (signErr || !signed.session || !signed.user?.id) {
    await notePasswordFailure(row);
    throw new PinAuthError("That password does not match this PIN.");
  }
  const userId = signed.user.id;
  if (row.auth_user_id && row.auth_user_id !== userId) {
    await notePasswordFailure(row);
    throw new PinAuthError("That login does not match this PIN.");
  }
  if (!row.auth_user_id) {
    if (await authUserTaken(userId, row)) {
      throw new PinAuthError("That login is already linked to someone else.");
    }
    const { error } = await service()
      .from("staff_registry")
      .update({ auth_user_id: userId })
      .eq("id", row.id);
    if (error) throw new PinAuthError("Could not link this person to a sign-in. Try again.");
    row.auth_user_id = userId;
  }
  if (ticket.needsUpgrade || !row.pin_lookup) {
    return {
      status: "upgrade",
      upgradeToken: signUpgrade(row),
      personName: personName(row),
      accessToken: signed.session.access_token,
      refreshToken: signed.session.refresh_token,
    };
  }
  await clearPersonFailures(row);
  return {
    status: "session",
    accessToken: signed.session.access_token,
    refreshToken: signed.session.refresh_token,
    profile: await profileFor(row, userId),
  };
}

export async function completeManagerPinUpgrade(args: {
  accessToken: string;
  upgradeToken: string;
  newPin: string;
  confirmPin: string;
}): Promise<{ profile: PinProfile }> {
  if (args.newPin !== args.confirmPin) throw new PinAuthError("The new PINs do not match.");
  const userId = await requireUserId(args.accessToken);
  const ticket = readUpgrade(args.upgradeToken);
  if (ticket.kind !== "staff") throw new PinAuthError("That PIN change expired. Enter your current PIN again.");
  const row = await loadStaff(ticket.id);
  if (!row || row.auth_user_id !== userId) {
    throw new PinAuthError("That PIN change expired. Enter your current PIN again.");
  }
  if (!isManagerLevelAccess(row.personnel_type, row.role)) {
    throw new PinAuthError("That sign-in expired. Enter your PIN again.");
  }
  await savePin(row, args.newPin);
  return { profile: await profileFor(row, userId) };
}

export async function verifyNamedPin(args: {
  accessToken: string;
  personKind: PersonKind;
  personId: string;
  pin: string;
}): Promise<{ personnelType: string | null; roleTitle: string | null }> {
  await requireUserId(args.accessToken);
  const row =
    args.personKind === "carer" ? await loadCarer(args.personId) : await loadStaff(args.personId);
  if (!row) throw new PinAuthError("Incorrect PIN. Please try again.");
  assertActive(row);
  await checkKnownPin(row, args.pin.trim());
  return { personnelType: row.personnel_type, roleTitle: row.role };
}

export async function resolvePinHolder(args: {
  accessToken: string;
  pin: string;
  deviceId: string;
}): Promise<{ personKind: PersonKind; personId: string; fullName: string }> {
  await requireUserId(args.accessToken);
  await assertPadOpen(args.deviceId);
  const pin = args.pin.trim();
  if (!/^\d{4}$/.test(pin) && !/^\d{6}$/.test(pin)) {
    await notePadFailure(args.deviceId);
    throw new PinAuthError("Incorrect PIN. Please try again.");
  }
  const row = /^\d{6}$/.test(pin) ? await findByLookup(lookupHex(pin)) : await findLegacyStaff(pin);
  if (!row) {
    await notePadFailure(args.deviceId);
    throw new PinAuthError("Incorrect PIN. Please try again.");
  }
  assertActive(row);
  const limits = await pinLimits();
  if (isLocked(row, limits.maxPerson)) {
    throw new PinAuthError("This PIN is locked. A manager must unlock it.");
  }
  await clearPadFailures(args.deviceId);
  return {
    personKind: row.kind,
    personId: row.id,
    fullName: (row.full_name ?? "").trim(),
  };
}

export async function assertManagerPin(staffId: string, pin: string, accessToken?: string): Promise<void> {
  if (accessToken) await requireUserId(accessToken);
  const row = await loadStaff(staffId);
  if (!row) throw new PinAuthError("Incorrect manager PIN.");
  await checkKnownPin(row, pin.trim());
  if (!isManagerLevelAccess(row.personnel_type, row.role)) {
    throw new PinAuthError("Selected operator is not a manager.");
  }
}

async function loadSelf(accessToken: string): Promise<PersonRow> {
  const userId = await requireUserId(accessToken);
  const db = service();
  const [staffRes, carerRes] = await Promise.all([
    db.from("staff_registry").select(STAFF_COLS).eq("auth_user_id", userId).maybeSingle(),
    selectCarerRow((cols) =>
      db.from("carers_registry").select(cols).eq("auth_user_id", userId).maybeSingle(),
    ),
  ]);
  if (staffRes.data) return staffFrom(staffRes.data as Record<string, unknown>);
  if (carerRes.data) return carerFrom(carerRes.data as Record<string, unknown>);
  throw new PinAuthError("Sign in first.");
}

export async function changeOwnPin(args: {
  accessToken: string;
  currentPin: string;
  newPin: string;
  confirmPin: string;
}): Promise<{ fullName: string; personKind: PersonKind; personId: string }> {
  if (args.newPin !== args.confirmPin) throw new PinAuthError("The new PINs do not match.");
  const row = await loadSelf(args.accessToken);
  if (row.kind === "staff") assertActive(row);
  await checkKnownPin(row, args.currentPin.trim());
  await savePin(row, args.newPin);
  return {
    fullName: (row.full_name ?? "You").trim() || "You",
    personKind: row.kind,
    personId: row.id,
  };
}

export async function managerSetPin(args: {
  accessToken: string;
  personKind: PersonKind;
  personId: string;
  newPin: string;
}): Promise<{ fullName: string }> {
  await requireManagerCaller(args.accessToken);
  const row = args.personKind === "carer" ? await loadCarer(args.personId) : await loadStaff(args.personId);
  if (!row) throw new PinAuthError("That person was not found.");
  await savePin(row, args.newPin.trim());
  return { fullName: (row.full_name ?? "This person").trim() || "This person" };
}

export async function managerUnlockPin(args: {
  accessToken: string;
  personKind: PersonKind;
  personId: string;
}): Promise<{ fullName: string }> {
  await requireManagerCaller(args.accessToken);
  const row = args.personKind === "carer" ? await loadCarer(args.personId) : await loadStaff(args.personId);
  if (!row) throw new PinAuthError("That person was not found.");
  const table = row.kind === "carer" ? "carers_registry" : "staff_registry";
  const { error } = await service()
    .from(table)
    .update({ pin_failed_count: 0, pin_locked_at: null })
    .eq("id", row.id);
  if (error) throw new PinAuthError("Could not unlock that PIN. Try again.");
  return { fullName: (row.full_name ?? "This person").trim() || "This person" };
}
