/**
 * BL-065 ALPHA — onboarding_cases CRUD, operational mapping, Hub review/cert assets.
 * SQL: docs/sql/2026-08-10_onboarding_cases.sql
 */
import { supabase } from "@/integrations/supabase/client";
import {
  insertAttendanceSchedule,
  insertCarer,
  insertParticipant,
  insertStaffMember,
  listAttendanceSchedules,
  resolveStaffIdWithFallback,
  updateParticipant,
  updateStaffMember,
  type StaffCertification,
  type WeekDay,
} from "@/lib/data-store";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import {
  displayNameFromPayload,
  emptyPayloadForPack,
  transportModeToScheduleCode,
  type AccompanyingFormPayload,
  type ClientFormPayload,
  type OnboardingCaseStatus,
  type OnboardingFormPayload,
  type OnboardingPackType,
  type StaffFormPayload,
  type VolunteerFormPayload,
} from "@/lib/onboarding/form-types";

const SCHEMA_HINT =
  "Onboarding table missing — run docs/sql/2026-08-10_onboarding_cases.sql then hard refresh.";

export interface OnboardingCase {
  id: string;
  packType: OnboardingPackType;
  status: OnboardingCaseStatus;
  subjectTable: string | null;
  subjectId: string | null;
  formPayload: OnboardingFormPayload;
  filingLocation: string | null;
  signedAt: string | null;
  signeeName: string | null;
  signeeRelationship: string | null;
  confirmedByStaffId: string | null;
  reviewDueAt: string | null;
  displayName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OnboardingCaseRow {
  id: string;
  pack_type: OnboardingPackType;
  status: OnboardingCaseStatus;
  subject_table: string | null;
  subject_id: string | null;
  form_payload: OnboardingFormPayload;
  filing_location: string | null;
  signed_at: string | null;
  signee_name: string | null;
  signee_relationship: string | null;
  confirmed_by_staff_id: string | null;
  review_due_at: string | null;
  display_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToCase(r: OnboardingCaseRow): OnboardingCase {
  const pack = r.pack_type;
  const fallback = emptyPayloadForPack(pack);
  const payload = {
    ...fallback,
    ...(r.form_payload ?? {}),
    pack,
  } as OnboardingFormPayload;
  return {
    id: r.id,
    packType: pack,
    status: r.status,
    subjectTable: r.subject_table,
    subjectId: r.subject_id,
    formPayload: payload,
    filingLocation: r.filing_location,
    signedAt: r.signed_at,
    signeeName: r.signee_name,
    signeeRelationship: r.signee_relationship,
    confirmedByStaffId: r.confirmed_by_staff_id,
    reviewDueAt: r.review_due_at,
    displayName: r.display_name,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function throwSchema(err: unknown): never {
  if (isSchemaMismatchError(err) || /onboarding_cases|Could not find the table/i.test(String((err as Error)?.message ?? err))) {
    throw new Error(SCHEMA_HINT);
  }
  throw err;
}

export async function listOnboardingCases(args?: {
  status?: OnboardingCaseStatus;
  packType?: OnboardingPackType;
  subjectTable?: string;
  subjectId?: string;
}): Promise<OnboardingCase[]> {
  let q = supabase
    .from("onboarding_cases")
    .select("*")
    .order("updated_at", { ascending: false });
  if (args?.status) q = q.eq("status", args.status);
  if (args?.packType) q = q.eq("pack_type", args.packType);
  if (args?.subjectTable) q = q.eq("subject_table", args.subjectTable);
  if (args?.subjectId) q = q.eq("subject_id", args.subjectId);
  const { data, error } = await q;
  if (error) throwSchema(error);
  return (data ?? []).map((r) => rowToCase(r as OnboardingCaseRow));
}

export async function getOnboardingCase(id: string): Promise<OnboardingCase | null> {
  const { data, error } = await supabase
    .from("onboarding_cases")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throwSchema(error);
  return data ? rowToCase(data as OnboardingCaseRow) : null;
}

export async function createOnboardingCase(
  packType: OnboardingPackType,
  opts?: {
    subjectTable?: string | null;
    subjectId?: string | null;
    seedPayload?: Partial<OnboardingFormPayload>;
  },
): Promise<OnboardingCase> {
  const payload = {
    ...emptyPayloadForPack(packType),
    ...(opts?.seedPayload ?? {}),
    pack: packType,
  } as OnboardingFormPayload;
  const row = {
    pack_type: packType,
    status: "draft" as const,
    subject_table: opts?.subjectTable ?? null,
    subject_id: opts?.subjectId ?? null,
    form_payload: payload,
    display_name: displayNameFromPayload(payload),
  };
  const { data, error } = await supabase
    .from("onboarding_cases")
    .insert(row)
    .select("*")
    .single();
  if (error) throwSchema(error);
  return rowToCase(data as OnboardingCaseRow);
}

export async function saveOnboardingDraft(
  id: string,
  payload: OnboardingFormPayload,
): Promise<OnboardingCase> {
  const { data, error } = await supabase
    .from("onboarding_cases")
    .update({
      form_payload: payload,
      display_name: displayNameFromPayload(payload),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throwSchema(error);
  return rowToCase(data as OnboardingCaseRow);
}

function addMonthsIso(from: Date, months: number): string {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

const DAY_CODE_TO_WEEKDAY: Record<string, WeekDay> = {
  "DAY-MON": "Monday",
  "DAY-TUE": "Tuesday",
  "DAY-WED": "Wednesday",
  "DAY-THU": "Thursday",
  "DAY-FRI": "Friday",
  "DAY-SAT": "Saturday",
  "DAY-SUN": "Sunday",
};

async function upsertReviewAsset(input: {
  category: string;
  type: string;
  name: string;
  description: string;
  subjectTable: string;
  subjectId: string;
  expiryDate: string;
  configExtra?: Record<string, unknown>;
}): Promise<void> {
  const actor = await resolveStaffIdWithFallback().catch(() => null);
  const { data: existing } = await supabase
    .from("compliance_assets")
    .select("id")
    .eq("subject_table", input.subjectTable)
    .eq("subject_id", input.subjectId)
    .eq("type", input.type)
    .eq("status", "active")
    .maybeSingle();

  const payload = {
    category: input.category,
    type: input.type,
    name: input.name,
    description: input.description,
    subject_table: input.subjectTable,
    subject_id: input.subjectId,
    expiry_date: input.expiryDate,
    next_action_at: null,
    action_module: "generic_resolve" as const,
    config: {
      yellow_days: 60,
      red_days: 14,
      handshake: "single",
      onboarding_alpha: true,
      ...(input.configExtra ?? {}),
    },
    status: "active" as const,
    created_by: actor,
  };

  if (existing) {
    await supabase
      .from("compliance_assets")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", (existing as { id: string }).id);
  } else {
    await supabase.from("compliance_assets").insert(payload);
  }
}

async function upsertStaffCertAsset(
  staffId: string,
  staffName: string,
  cert: StaffCertification,
): Promise<void> {
  if (!cert.name?.trim() || !cert.expiry?.trim()) return;
  const actor = await resolveStaffIdWithFallback().catch(() => null);
  const certName = cert.name.trim();
  const { data: rows } = await supabase
    .from("compliance_assets")
    .select("id, config")
    .eq("subject_table", "staff_registry")
    .eq("subject_id", staffId)
    .eq("type", "certification")
    .eq("status", "active");

  const match = (rows ?? []).find((r) => {
    const cfg = (r as { config?: { cert_name?: string } }).config;
    return (cfg?.cert_name ?? "").toLowerCase() === certName.toLowerCase();
  }) as { id: string } | undefined;

  const payload = {
    category: "STAFF",
    type: "certification",
    name: `${staffName} · ${certName}`,
    description: `Onboarding / induction certification for ${staffName}.`,
    subject_table: "staff_registry",
    subject_id: staffId,
    expiry_date: cert.expiry,
    next_action_at: null,
    action_module: "staff_cert" as const,
    config: {
      yellow_days: 60,
      red_days: 7,
      handshake: "single",
      cert_name: certName,
      cert_number: cert.number ?? "",
      onboarding_alpha: true,
    },
    status: "active" as const,
    created_by: actor,
  };

  if (match) {
    await supabase
      .from("compliance_assets")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", match.id);
  } else {
    await supabase.from("compliance_assets").insert(payload);
  }
}

async function patchParticipantClinical(
  participantId: string,
  fields: {
    dateOfBirth?: string;
    allergiesNotes?: string;
    emergencyName?: string;
    emergencyPhone?: string;
    emergencyRelationship?: string;
  },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (fields.dateOfBirth !== undefined) row.date_of_birth = fields.dateOfBirth || null;
  if (fields.allergiesNotes !== undefined)
    row.allergies_notes = fields.allergiesNotes || null;
  if (fields.emergencyName !== undefined)
    row.emergency_contact_name = fields.emergencyName || null;
  if (fields.emergencyPhone !== undefined)
    row.emergency_contact_phone = fields.emergencyPhone || null;
  if (fields.emergencyRelationship !== undefined)
    row.emergency_contact_relationship = fields.emergencyRelationship || null;
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase
    .from("participants")
    .update(row)
    .eq("id", participantId);
  if (error && !isSchemaMismatchError(error)) throw error;
}

async function syncClientAttendance(
  participantId: string,
  payload: ClientFormPayload,
): Promise<void> {
  const existing = await listAttendanceSchedules(participantId).catch(() => []);
  const enabled = payload.attendance.filter((d) => d.enabled);
  for (const day of enabled) {
    const weekday = DAY_CODE_TO_WEEKDAY[day.dayCode];
    // Live DB stores DAY-* codes; insert with the code the floor already uses.
    const dayOfWeek = day.dayCode as unknown as WeekDay;
    const already = existing.some(
      (s) =>
        s.dayOfWeek === dayOfWeek ||
        String(s.dayOfWeek) === day.dayCode ||
        (weekday && String(s.dayOfWeek) === weekday),
    );
    if (already) continue;
    await insertAttendanceSchedule({
      participantId,
      dayOfWeek,
      serviceType: day.dayCode.startsWith("DAY-S") ? "SRV-TRIP" : "SRV-DAY",
      inboundTransport: transportModeToScheduleCode(day.inbound),
      outboundTransport: transportModeToScheduleCode(day.outbound),
      expectedArrivalTime: day.expectedArrival || "09:00",
      expectedDepartureTime: day.expectedDeparture || "15:00",
    });
  }
}

async function applyClientToDb(
  caseRow: OnboardingCase,
  payload: ClientFormPayload,
): Promise<{ subjectTable: string; subjectId: string }> {
  const ndis =
    payload.fundingType === "ndis"
      ? payload.ndisNumber.trim()
      : payload.ndisNumber.trim() || `FFS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  const street = [payload.streetAddress, payload.suburb, payload.postcode]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");

  let participantId = caseRow.subjectId;
  if (caseRow.subjectTable === "participants" && participantId) {
    await updateParticipant(participantId, {
      firstName: payload.firstName.trim(),
      lastName: payload.lastName.trim(),
      ndisNumber: ndis,
      streetAddress: street || null,
      regularPickupAddress: payload.regularPickupAddress.trim() || street || null,
      iddsi: { liquids: payload.iddsiLiquids, foods: payload.iddsiSolids },
    });
  } else {
    const created = await insertParticipant({
      firstName: payload.firstName.trim(),
      lastName: payload.lastName.trim(),
      ndisNumber: ndis,
      streetAddress: street || null,
      regularPickupAddress: payload.regularPickupAddress.trim() || street || null,
      iddsi: { liquids: payload.iddsiLiquids, foods: payload.iddsiSolids },
    });
    participantId = created.id;
  }

  await patchParticipantClinical(participantId!, {
    dateOfBirth: payload.dateOfBirth.trim(),
    allergiesNotes: payload.allergiesText.trim(),
    emergencyName: payload.emergencyName.trim(),
    emergencyPhone: payload.emergencyPhone.trim(),
    emergencyRelationship: payload.emergencyRelationship.trim(),
  });

  if (payload.emergencyName.trim()) {
    await insertCarer({
      participantId: participantId!,
      fullName: payload.emergencyName.trim(),
      relationship: payload.emergencyRelationship.trim() || "Emergency contact",
      phone: payload.emergencyPhone.trim() || null,
      email: null,
      streetAddress: null,
      isPrimaryContact: true,
      notes: "From client onboarding",
    }).catch(() => {
      /* may already exist as primary — non-fatal for ALPHA */
    });
  }

  const g0 = payload.guardians[0];
  if (g0.name.trim()) {
    await insertCarer({
      participantId: participantId!,
      fullName: g0.name.trim(),
      relationship: g0.relationship.trim() || "Guardian",
      phone: g0.phone.trim() || null,
      email: g0.email.trim() || null,
      streetAddress: null,
      isPrimaryContact: false,
      notes: "Guardian from client onboarding",
    }).catch(() => undefined);
  }

  await syncClientAttendance(participantId!, payload);

  // Persist clinical/care notes into participants.notes if column exists — best effort via form only.
  return { subjectTable: "participants", subjectId: participantId! };
}

function buildCertList(
  payload: StaffFormPayload | VolunteerFormPayload,
): StaffCertification[] {
  const certs: StaffCertification[] = [];
  if (payload.wwccNumber.trim()) {
    certs.push({
      name: "WWCC",
      number: payload.wwccNumber.trim(),
      expiry: payload.wwccExpiry.trim() || null,
    });
  }
  if (payload.ndisScreeningNumber.trim()) {
    certs.push({
      name: "NDIS Worker Screening",
      number: payload.ndisScreeningNumber.trim(),
      expiry: payload.ndisScreeningExpiry.trim() || null,
    });
  }
  for (const c of payload.certs) {
    if (!c.name.trim()) continue;
    if (!c.number.trim() && !c.expiry.trim()) continue;
    certs.push({
      name: c.name.trim(),
      number: c.number.trim(),
      expiry: c.expiry.trim() || null,
    });
  }
  if (payload.pack === "staff" && payload.drives && payload.licenceNumber.trim()) {
    certs.push({
      name: `Driver licence${payload.licenceClass ? ` (${payload.licenceClass})` : ""}`,
      number: payload.licenceNumber.trim(),
      expiry: payload.licenceExpiry.trim() || null,
    });
  }
  return certs;
}

async function applyStaffLikeToDb(
  caseRow: OnboardingCase,
  payload: StaffFormPayload | VolunteerFormPayload,
): Promise<{ subjectTable: string; subjectId: string }> {
  const certs = buildCertList(payload);
  const isVolunteer = payload.pack === "volunteer";
  const notesParts = [
    isVolunteer
      ? `Volunteer role: ${(payload as VolunteerFormPayload).roleDescription}`
      : `Job title: ${(payload as StaffFormPayload).jobTitle}`,
    payload.pack === "volunteer"
      ? `Available: ${(payload as VolunteerFormPayload).daysAvailable}`
      : null,
    payload.pack === "volunteer"
      ? `Supervisor: ${(payload as VolunteerFormPayload).supervisorName}`
      : null,
    `DOB: ${payload.dateOfBirth || "—"}`,
    `Emergency: ${payload.emergencyName} ${payload.emergencyPhone} (${payload.emergencyRelationship})`,
    "Source: onboarding ALPHA",
  ].filter(Boolean);

  const staffPayload = {
    fullName: payload.fullName.trim(),
    role: isVolunteer
      ? (payload as VolunteerFormPayload).roleDescription.trim() || "Volunteer"
      : (payload as StaffFormPayload).jobTitle.trim(),
    personnelType: isVolunteer
      ? (payload as VolunteerFormPayload).systemAccess.trim() || "Volunteer"
      : (payload as StaffFormPayload).systemAccess.trim() || "support_worker",
    phone: payload.phone.trim() || null,
    email: payload.email.trim() || null,
    streetAddress: payload.streetAddress.trim() || null,
    active: true,
    notes: notesParts.join("\n"),
    certifications: certs,
  };

  let staffId = caseRow.subjectId;
  if (caseRow.subjectTable === "staff_registry" && staffId) {
    await updateStaffMember(staffId, staffPayload);
  } else {
    // PIN is set later in Staff directory (induction checklist). Empty string
    // satisfies NOT NULL pin_hash columns on some environments.
    const created = await insertStaffMember({
      ...staffPayload,
      pinHash: "",
    });
    staffId = created.id;
  }
  return { subjectTable: "staff_registry", subjectId: staffId! };
}

async function applyAccompanyingToDb(
  caseRow: OnboardingCase,
  payload: AccompanyingFormPayload,
): Promise<{ subjectTable: string; subjectId: string }> {
  if (!payload.linkedParticipantId.trim()) {
    throw new Error("Linked client is required for accompanying support person.");
  }
  const notes = [
    "Accompanying support person (onboarding)",
    payload.accompanyCentre ? "Attends centre" : null,
    payload.accompanyTrips ? "Attends trips" : null,
    payload.daysNotes.trim() || null,
    payload.wwccNumber
      ? `WWCC ${payload.wwccNumber} exp ${payload.wwccExpiry || "—"}`
      : null,
    payload.ownEmergencyName
      ? `Own emergency: ${payload.ownEmergencyName} ${payload.ownEmergencyPhone}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  let carerId = caseRow.subjectId;
  if (caseRow.subjectTable === "carers_registry" && carerId) {
    const { error } = await supabase
      .from("carers_registry")
      .update({
        participant_id: payload.linkedParticipantId,
        full_name: payload.fullName.trim(),
        relationship: payload.relationship.trim() || null,
        phone: payload.phone.trim() || null,
        email: payload.email.trim() || null,
        street_address: payload.streetAddress.trim() || null,
        notes,
      })
      .eq("id", carerId);
    if (error) throw error;
  } else {
    const created = await insertCarer({
      participantId: payload.linkedParticipantId,
      fullName: payload.fullName.trim(),
      relationship: payload.relationship.trim() || "Accompanying support",
      phone: payload.phone.trim() || null,
      email: payload.email.trim() || null,
      streetAddress: payload.streetAddress.trim() || null,
      isPrimaryContact: false,
      notes,
    });
    carerId = created.id;
  }
  return { subjectTable: "carers_registry", subjectId: carerId! };
}

async function applyOperationalMapping(
  caseRow: OnboardingCase,
  payload: OnboardingFormPayload,
): Promise<{ subjectTable: string; subjectId: string }> {
  switch (payload.pack) {
    case "client":
      return applyClientToDb(caseRow, payload);
    case "staff":
    case "volunteer":
      return applyStaffLikeToDb(caseRow, payload);
    case "accompanying":
      return applyAccompanyingToDb(caseRow, payload);
  }
}

async function syncHubAssetsForCase(
  caseRow: OnboardingCase,
  payload: OnboardingFormPayload,
  subjectTable: string,
  subjectId: string,
  reviewDueAt: string,
): Promise<void> {
  const label = displayNameFromPayload(payload);

  if (payload.pack === "client") {
    await upsertReviewAsset({
      category: "PARTICIPANT",
      type: "client_profile_review",
      name: `Client profile review — ${label}`,
      description:
        "Annual client profile / care needs / emergency contact review (BL-065). Reset on Review/Update re-file.",
      subjectTable,
      subjectId,
      expiryDate: reviewDueAt,
    });
    await upsertReviewAsset({
      category: "PARTICIPANT",
      type: "client_consent_pack",
      name: `Client consent pack — ${label}`,
      description:
        "Annual consent currency (privacy, third party, photo, outing, emergency medical).",
      subjectTable,
      subjectId,
      expiryDate: reviewDueAt,
    });
    return;
  }

  if (payload.pack === "staff" || payload.pack === "volunteer") {
    await upsertReviewAsset({
      category: "STAFF",
      type: "workforce_induction_review",
      name: `Workforce induction review — ${label}`,
      description: "Annual re-acknowledgement of induction / code of conduct (BL-065).",
      subjectTable,
      subjectId,
      expiryDate: reviewDueAt,
    });
    const certs = buildCertList(payload);
    for (const c of certs) {
      await upsertStaffCertAsset(subjectId, label, c);
    }
    return;
  }

  await upsertReviewAsset({
    category: "CARER",
    type: "accompanying_declaration",
    name: `Accompanying person declaration — ${label}`,
    description: "Annual accompanying support person declaration review.",
    subjectTable,
    subjectId,
    expiryDate: reviewDueAt,
  });
  if (payload.wwccNumber.trim() && payload.wwccExpiry.trim()) {
    await upsertReviewAsset({
      category: "CARER",
      type: "accompanying_wwcc",
      name: `Accompanying WWCC — ${label}`,
      description: "WWCC for accompanying support person.",
      subjectTable,
      subjectId,
      expiryDate: payload.wwccExpiry.trim(),
      configExtra: { cert_name: "WWCC", cert_number: payload.wwccNumber.trim() },
    });
  }
}

/** Office Confirm fields — maps to operational tables; status office_confirmed. */
export async function confirmOnboardingCase(
  id: string,
  payload: OnboardingFormPayload,
): Promise<OnboardingCase> {
  const existing = await getOnboardingCase(id);
  if (!existing) throw new Error("Onboarding case not found.");
  if (existing.status === "superseded") {
    throw new Error("This onboarding case was superseded. Start a Review/Update instead.");
  }

  const mapped = await applyOperationalMapping(existing, payload);
  const actor = await resolveStaffIdWithFallback().catch(() => null);

  const { data, error } = await supabase
    .from("onboarding_cases")
    .update({
      form_payload: payload,
      display_name: displayNameFromPayload(payload),
      status: "office_confirmed",
      subject_table: mapped.subjectTable,
      subject_id: mapped.subjectId,
      confirmed_by_staff_id: actor,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throwSchema(error);
  return rowToCase(data as OnboardingCaseRow);
}

/** Mark signed & filed — Filing location evidence + Hub review/cert assets. */
export async function fileOnboardingCase(
  id: string,
  args: {
    payload: OnboardingFormPayload;
    filingLocation: string;
    signedAt: string;
    signeeName: string;
    signeeRelationship: string;
  },
): Promise<OnboardingCase> {
  const filing = args.filingLocation.trim();
  if (filing.length < 6) {
    throw new Error("Filing location must be at least 6 characters.");
  }
  if (!args.signeeName.trim()) throw new Error("Signee name is required.");
  if (!args.signedAt.trim()) throw new Error("Signed date is required.");

  let current = await getOnboardingCase(id);
  if (!current) throw new Error("Onboarding case not found.");

  // Ensure operational mapping exists (confirm may have been skipped).
  if (
    current.status === "draft" ||
    !current.subjectId ||
    !current.subjectTable
  ) {
    current = await confirmOnboardingCase(id, args.payload);
  } else {
    await saveOnboardingDraft(id, args.payload);
    const mapped = await applyOperationalMapping(current, args.payload);
    await supabase
      .from("onboarding_cases")
      .update({
        subject_table: mapped.subjectTable,
        subject_id: mapped.subjectId,
        form_payload: args.payload,
        display_name: displayNameFromPayload(args.payload),
      })
      .eq("id", id);
    current = (await getOnboardingCase(id))!;
  }

  const reviewDueAt = addMonthsIso(new Date(args.signedAt), 12);

  await syncHubAssetsForCase(
    current,
    args.payload,
    current.subjectTable!,
    current.subjectId!,
    reviewDueAt,
  );

  const { data, error } = await supabase
    .from("onboarding_cases")
    .update({
      status: "signed_filed",
      filing_location: filing,
      signed_at: new Date(args.signedAt).toISOString(),
      signee_name: args.signeeName.trim(),
      signee_relationship: args.signeeRelationship.trim() || null,
      review_due_at: reviewDueAt,
      form_payload: args.payload,
      display_name: displayNameFromPayload(args.payload),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throwSchema(error);
  return rowToCase(data as OnboardingCaseRow);
}

/**
 * Start a Review/Update: supersede prior signed case for same subject+pack,
 * clone payload into a new draft.
 */
export async function startOnboardingReview(
  priorCaseId: string,
): Promise<OnboardingCase> {
  const prior = await getOnboardingCase(priorCaseId);
  if (!prior) throw new Error("Prior onboarding case not found.");

  if (prior.status === "signed_filed") {
    await supabase
      .from("onboarding_cases")
      .update({ status: "superseded" })
      .eq("id", prior.id);
  }

  return createOnboardingCase(prior.packType, {
    subjectTable: prior.subjectTable,
    subjectId: prior.subjectId,
    seedPayload: prior.formPayload,
  });
}

export async function listOnboardingForSubject(
  subjectTable: string,
  subjectId: string,
): Promise<OnboardingCase[]> {
  return listOnboardingCases({ subjectTable, subjectId });
}
