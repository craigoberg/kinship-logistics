/**
 * BL-065 ALPHA — fixed payload shapes for the four onboarding packs.
 * Stored in onboarding_cases.form_payload; mapped to operational tables on confirm/file.
 */

export type OnboardingPackType =
  | "client"
  | "staff"
  | "volunteer"
  | "accompanying";

export type OnboardingCaseStatus =
  | "draft"
  | "office_confirmed"
  | "signed_filed"
  | "superseded";

export const ONBOARDING_PACK_LABELS: Record<OnboardingPackType, string> = {
  client: "Client Intake & Consent",
  staff: "Paid Staff Induction",
  volunteer: "Volunteer Induction",
  accompanying: "Accompanying Support Person",
};

export const ATTENDANCE_DAY_OPTIONS = [
  { code: "DAY-MON", label: "Monday" },
  { code: "DAY-TUE", label: "Tuesday" },
  { code: "DAY-WED", label: "Wednesday" },
  { code: "DAY-THU", label: "Thursday" },
  { code: "DAY-FRI", label: "Friday" },
  { code: "DAY-SAT", label: "Saturday (weekend trips)" },
  { code: "DAY-SUN", label: "Sunday (weekend trips)" },
] as const;

export type TransportMode = "bus" | "self" | "carer" | "other";

export interface AttendanceDayDraft {
  dayCode: string;
  enabled: boolean;
  inbound: TransportMode;
  outbound: TransportMode;
  expectedArrival: string;
  expectedDeparture: string;
  inboundNote?: string;
  outboundNote?: string;
}

export interface GuardianDraft {
  name: string;
  phone: string;
  relationship: string;
  email: string;
  dateOfBirth: string;
  interpreterRequired: boolean;
  interpreterLanguage: string;
}

export interface SelfCareDraft {
  bathe: boolean;
  dress: boolean;
  eat: boolean;
  grooming: boolean;
  bed: boolean;
  toilet: boolean;
  walking: boolean;
  footcare: boolean;
}

export interface ClientConsentsDraft {
  privacyCollection: boolean;
  thirdPartySpeak: boolean;
  photoVideo: boolean;
  photoScope: string;
  outingCommunity: boolean;
  emergencyMedical: boolean;
  /** BL-114 — rights / complaints / handbook acknowledgement. */
  rightsHandbook: boolean;
}

/** BL-114 — thin org support plan + comms + risk (0136/0125/0108). */
export interface ClientSupportDraft {
  goals: string;
  strengths: string;
  needs: string;
  preferences: string;
  communicationMode: string;
  communicationStrategies: string;
  riskHazards: string;
  riskControls: string;
}

export const MIN_SUPPORT_PLAN_CHARS = 20;
export const MIN_COMMUNICATION_MODE_CHARS = 6;

export interface ClientFormPayload {
  pack: "client";
  fundingType: "ndis" | "fee_for_service" | "";
  ndisNumber: string;
  firstName: string;
  lastName: string;
  preferredName: string;
  dateOfBirth: string;
  gender: string;
  phone: string;
  email: string;
  streetAddress: string;
  suburb: string;
  postcode: string;
  regularPickupAddress: string;
  countryOfBirth: string;
  languagesAtHome: string;
  aboriginalOrTsi: "" | "yes" | "no";
  livingArrangement: string;
  livingOther: string;
  guardians: [GuardianDraft, GuardianDraft];
  selfCare: SelfCareDraft;
  gpName: string;
  gpAddress: string;
  gpPhone: string;
  disability: string;
  medicationsText: string;
  allergiesText: string;
  iddsiLiquids: number;
  iddsiSolids: number;
  emergencyName: string;
  emergencyPhone: string;
  emergencyRelationship: string;
  emergencySecondaryName: string;
  emergencySecondaryPhone: string;
  emergencySecondaryRelationship: string;
  attendance: AttendanceDayDraft[];
  support: ClientSupportDraft;
  consents: ClientConsentsDraft;
  officeConfirmNote: string;
}

export interface CertDraft {
  name: string;
  number: string;
  expiry: string;
}

export interface WorkforceConsentsDraft {
  codeOfConduct: boolean;
  confidentiality: boolean;
  whs: boolean;
  mandatoryReporting: boolean;
  conflictOfInterest: boolean;
  declareCharges: boolean;
  boundaries?: boolean;
  photoSelf?: boolean;
}

export interface InductionChecklistDraft {
  siteTour: boolean;
  emergencyProcedures: boolean;
  medicationPolicy: boolean;
  incidentReporting: boolean;
  pinSetupNoted: boolean;
}

export interface StaffFormPayload {
  pack: "staff";
  fullName: string;
  dateOfBirth: string;
  phone: string;
  email: string;
  streetAddress: string;
  jobTitle: string;
  systemAccess: string;
  emergencyName: string;
  emergencyPhone: string;
  emergencyRelationship: string;
  ndisScreeningNumber: string;
  ndisScreeningExpiry: string;
  wwccNumber: string;
  wwccExpiry: string;
  idSighted: boolean;
  certs: CertDraft[];
  drives: boolean;
  licenceClass: string;
  licenceNumber: string;
  licenceExpiry: string;
  licenceRestrictions: string;
  declarations: WorkforceConsentsDraft;
  induction: InductionChecklistDraft;
  officeConfirmNote: string;
}

export interface VolunteerFormPayload {
  pack: "volunteer";
  fullName: string;
  dateOfBirth: string;
  phone: string;
  email: string;
  streetAddress: string;
  roleDescription: string;
  daysAvailable: string;
  supervisorName: string;
  systemAccess: string;
  emergencyName: string;
  emergencyPhone: string;
  emergencyRelationship: string;
  ndisScreeningNumber: string;
  ndisScreeningExpiry: string;
  wwccNumber: string;
  wwccExpiry: string;
  idSighted: boolean;
  certs: CertDraft[];
  declarations: WorkforceConsentsDraft;
  induction: InductionChecklistDraft;
  officeConfirmNote: string;
}

export interface AccompanyingFormPayload {
  pack: "accompanying";
  fullName: string;
  relationship: string;
  phone: string;
  email: string;
  streetAddress: string;
  linkedParticipantId: string;
  linkedParticipantName: string;
  accompanyCentre: boolean;
  accompanyTrips: boolean;
  daysNotes: string;
  wwccNumber: string;
  wwccExpiry: string;
  photoConsent: boolean;
  ownEmergencyName: string;
  ownEmergencyPhone: string;
  acknowledgeBoundaries: boolean;
  followStaffDirection: boolean;
  reportIncidents: boolean;
  officeConfirmNote: string;
}

export type OnboardingFormPayload =
  | ClientFormPayload
  | StaffFormPayload
  | VolunteerFormPayload
  | AccompanyingFormPayload;

function emptyGuardian(): GuardianDraft {
  return {
    name: "",
    phone: "",
    relationship: "",
    email: "",
    dateOfBirth: "",
    interpreterRequired: false,
    interpreterLanguage: "",
  };
}

export function emptyClientSupport(): ClientSupportDraft {
  return {
    goals: "",
    strengths: "",
    needs: "",
    preferences: "",
    communicationMode: "",
    communicationStrategies: "",
    riskHazards: "",
    riskControls: "",
  };
}

export function emptyClientConsents(): ClientConsentsDraft {
  return {
    privacyCollection: false,
    thirdPartySpeak: false,
    photoVideo: false,
    photoScope: "educational_promotional",
    outingCommunity: false,
    emergencyMedical: false,
    rightsHandbook: false,
  };
}

function defaultAttendance(): AttendanceDayDraft[] {
  return ATTENDANCE_DAY_OPTIONS.map((d) => ({
    dayCode: d.code,
    enabled: d.code === "DAY-TUE" || d.code === "DAY-THU",
    inbound: "bus",
    outbound: "bus",
    expectedArrival: "09:00",
    expectedDeparture: "15:00",
  }));
}

export function emptyClientPayload(): ClientFormPayload {
  return {
    pack: "client",
    fundingType: "",
    ndisNumber: "",
    firstName: "",
    lastName: "",
    preferredName: "",
    dateOfBirth: "",
    gender: "",
    phone: "",
    email: "",
    streetAddress: "",
    suburb: "",
    postcode: "",
    regularPickupAddress: "",
    countryOfBirth: "",
    languagesAtHome: "",
    aboriginalOrTsi: "",
    livingArrangement: "",
    livingOther: "",
    guardians: [emptyGuardian(), emptyGuardian()],
    selfCare: {
      bathe: false,
      dress: false,
      eat: false,
      grooming: false,
      bed: false,
      toilet: false,
      walking: false,
      footcare: false,
    },
    gpName: "",
    gpAddress: "",
    gpPhone: "",
    disability: "",
    medicationsText: "",
    allergiesText: "",
    iddsiLiquids: 0,
    iddsiSolids: 7,
    emergencyName: "",
    emergencyPhone: "",
    emergencyRelationship: "",
    emergencySecondaryName: "",
    emergencySecondaryPhone: "",
    emergencySecondaryRelationship: "",
    attendance: defaultAttendance(),
    support: emptyClientSupport(),
    consents: emptyClientConsents(),
    officeConfirmNote: "",
  };
}

export function emptyStaffPayload(): StaffFormPayload {
  return {
    pack: "staff",
    fullName: "",
    dateOfBirth: "",
    phone: "",
    email: "",
    streetAddress: "",
    jobTitle: "",
    systemAccess: "support_worker",
    emergencyName: "",
    emergencyPhone: "",
    emergencyRelationship: "",
    ndisScreeningNumber: "",
    ndisScreeningExpiry: "",
    wwccNumber: "",
    wwccExpiry: "",
    idSighted: false,
    certs: [
      { name: "First Aid", number: "", expiry: "" },
      { name: "CPR", number: "", expiry: "" },
      { name: "Manual Handling", number: "", expiry: "" },
    ],
    drives: false,
    licenceClass: "",
    licenceNumber: "",
    licenceExpiry: "",
    licenceRestrictions: "",
    declarations: {
      codeOfConduct: false,
      confidentiality: false,
      whs: false,
      mandatoryReporting: false,
      conflictOfInterest: false,
      declareCharges: false,
    },
    induction: {
      siteTour: false,
      emergencyProcedures: false,
      medicationPolicy: false,
      incidentReporting: false,
      pinSetupNoted: false,
    },
    officeConfirmNote: "",
  };
}

export function emptyVolunteerPayload(): VolunteerFormPayload {
  return {
    pack: "volunteer",
    fullName: "",
    dateOfBirth: "",
    phone: "",
    email: "",
    streetAddress: "",
    roleDescription: "",
    daysAvailable: "",
    supervisorName: "",
    systemAccess: "",
    emergencyName: "",
    emergencyPhone: "",
    emergencyRelationship: "",
    ndisScreeningNumber: "",
    ndisScreeningExpiry: "",
    wwccNumber: "",
    wwccExpiry: "",
    idSighted: false,
    certs: [{ name: "First Aid", number: "", expiry: "" }],
    declarations: {
      codeOfConduct: false,
      confidentiality: false,
      whs: false,
      mandatoryReporting: false,
      conflictOfInterest: false,
      declareCharges: false,
      boundaries: false,
      photoSelf: false,
    },
    induction: {
      siteTour: false,
      emergencyProcedures: false,
      medicationPolicy: false,
      incidentReporting: false,
      pinSetupNoted: false,
    },
    officeConfirmNote: "",
  };
}

export function emptyAccompanyingPayload(): AccompanyingFormPayload {
  return {
    pack: "accompanying",
    fullName: "",
    relationship: "",
    phone: "",
    email: "",
    streetAddress: "",
    linkedParticipantId: "",
    linkedParticipantName: "",
    accompanyCentre: true,
    accompanyTrips: false,
    daysNotes: "",
    wwccNumber: "",
    wwccExpiry: "",
    photoConsent: false,
    ownEmergencyName: "",
    ownEmergencyPhone: "",
    acknowledgeBoundaries: false,
    followStaffDirection: false,
    reportIncidents: false,
    officeConfirmNote: "",
  };
}

export function emptyPayloadForPack(
  pack: OnboardingPackType,
): OnboardingFormPayload {
  switch (pack) {
    case "client":
      return emptyClientPayload();
    case "staff":
      return emptyStaffPayload();
    case "volunteer":
      return emptyVolunteerPayload();
    case "accompanying":
      return emptyAccompanyingPayload();
  }
}

/** Merge stored JSONB onto ALPHA defaults so older client drafts still open. */
export function hydrateOnboardingPayload(
  pack: OnboardingPackType,
  raw: Partial<OnboardingFormPayload> | null | undefined,
): OnboardingFormPayload {
  const fallback = emptyPayloadForPack(pack);
  const merged = {
    ...fallback,
    ...(raw ?? {}),
    pack,
  } as OnboardingFormPayload;
  if (merged.pack === "client") {
    const rawClient = (raw ?? {}) as Partial<ClientFormPayload>;
    merged.consents = {
      ...emptyClientConsents(),
      ...(rawClient.consents ?? {}),
    };
    merged.support = {
      ...emptyClientSupport(),
      ...(rawClient.support ?? {}),
    };
    if (!merged.guardians?.length) {
      merged.guardians = emptyClientPayload().guardians;
    }
    if (!merged.attendance?.length) {
      merged.attendance = emptyClientPayload().attendance;
    }
    if (!merged.selfCare) {
      merged.selfCare = emptyClientPayload().selfCare;
    }
  }
  return merged;
}

export function displayNameFromPayload(payload: OnboardingFormPayload): string {
  switch (payload.pack) {
    case "client":
      return `${payload.firstName} ${payload.lastName}`.trim() || "Client draft";
    case "staff":
    case "volunteer":
    case "accompanying":
      return payload.fullName.trim() || `${payload.pack} draft`;
  }
}

/** Required-field gaps for Confirm / primary actions (live checklist). */
export function missingFieldsForPayload(
  payload: OnboardingFormPayload,
  phase: "draft_save" | "confirm" | "file",
): string[] {
  const missing: string[] = [];
  if (payload.pack === "client") {
    if (!payload.firstName.trim()) missing.push("First name");
    if (!payload.lastName.trim()) missing.push("Surname");
    if (phase === "draft_save") return missing;
    if (!payload.fundingType) missing.push("Funding type");
    if (payload.fundingType === "ndis" && !payload.ndisNumber.trim())
      missing.push("NDIS number");
    if (!payload.dateOfBirth.trim()) missing.push("Date of birth");
    if (!payload.emergencyName.trim()) missing.push("Emergency contact name");
    if (!payload.emergencyPhone.trim()) missing.push("Emergency contact phone");
    if (!payload.allergiesText.trim()) missing.push("Allergies (or write None)");
    if (!payload.attendance.some((d) => d.enabled))
      missing.push("At least one attendance day");
    if (phase === "confirm" || phase === "file") {
      const s = payload.support ?? emptyClientSupport();
      if (s.goals.trim().length < MIN_SUPPORT_PLAN_CHARS)
        missing.push("Support plan — goals");
      if (s.strengths.trim().length < MIN_SUPPORT_PLAN_CHARS)
        missing.push("Support plan — strengths");
      if (s.needs.trim().length < MIN_SUPPORT_PLAN_CHARS)
        missing.push("Support plan — needs");
      if (s.preferences.trim().length < MIN_SUPPORT_PLAN_CHARS)
        missing.push("Support plan — preferences / wishes");
      if (s.communicationMode.trim().length < MIN_COMMUNICATION_MODE_CHARS)
        missing.push("How they communicate");
      if (s.communicationStrategies.trim().length < MIN_SUPPORT_PLAN_CHARS)
        missing.push("Communication strategies");
      if (s.riskHazards.trim().length < MIN_SUPPORT_PLAN_CHARS)
        missing.push("Risk assessment — what to watch for");
      if (s.riskControls.trim().length < MIN_SUPPORT_PLAN_CHARS)
        missing.push("Risk assessment — staff controls");
      const c = payload.consents ?? emptyClientConsents();
      if (!c.privacyCollection) missing.push("Privacy consent");
      if (!c.thirdPartySpeak) missing.push("Third-party authorisation");
      if (!c.outingCommunity) missing.push("Outing consent");
      if (!c.emergencyMedical) missing.push("Emergency medical consent");
      if (!c.rightsHandbook)
        missing.push("Rights, complaints and handbook acknowledgement");
      // photo can be false (declined) — no missing
    }
  } else if (payload.pack === "staff") {
    if (!payload.fullName.trim()) missing.push("Full name");
    if (phase === "draft_save") return missing;
    if (!payload.jobTitle.trim()) missing.push("Job title");
    if (!payload.systemAccess.trim()) missing.push("System access level");
    if (!payload.phone.trim()) missing.push("Phone");
    if (!payload.wwccNumber.trim()) missing.push("WWCC number");
    if (!payload.wwccExpiry.trim()) missing.push("WWCC expiry");
    if (!payload.ndisScreeningNumber.trim())
      missing.push("NDIS Worker Screening number");
    if (phase === "confirm" || phase === "file") {
      const d = payload.declarations;
      if (!d.codeOfConduct) missing.push("Code of conduct");
      if (!d.confidentiality) missing.push("Confidentiality");
      if (!d.whs) missing.push("WHS declaration");
      if (!d.mandatoryReporting) missing.push("Mandatory reporting");
      if (!d.declareCharges) missing.push("Charges / WWCC change declaration");
      if (!payload.idSighted) missing.push("100-point ID sighted");
      const ind = payload.induction;
      if (
        !ind.siteTour ||
        !ind.emergencyProcedures ||
        !ind.incidentReporting
      ) {
        missing.push("Induction checklist (site, emergency, incidents)");
      }
    }
  } else if (payload.pack === "volunteer") {
    if (!payload.fullName.trim()) missing.push("Full name");
    if (phase === "draft_save") return missing;
    if (!payload.roleDescription.trim()) missing.push("Role description");
    if (!payload.phone.trim()) missing.push("Phone");
    if (!payload.wwccNumber.trim()) missing.push("WWCC number");
    if (!payload.wwccExpiry.trim()) missing.push("WWCC expiry");
    if (phase === "confirm" || phase === "file") {
      const d = payload.declarations;
      if (!d.codeOfConduct) missing.push("Code of conduct");
      if (!d.confidentiality) missing.push("Confidentiality");
      if (!d.boundaries) missing.push("Boundaries declaration");
      if (!payload.idSighted) missing.push("ID sighted");
    }
  } else {
    if (!payload.fullName.trim()) missing.push("Full name");
    if (phase === "draft_save") return missing;
    if (!payload.relationship.trim()) missing.push("Relationship to client");
    if (!payload.phone.trim()) missing.push("Phone");
    if (!payload.linkedParticipantId.trim()) missing.push("Linked client");
    if (phase === "confirm" || phase === "file") {
      if (!payload.acknowledgeBoundaries)
        missing.push("Acknowledge YADA supervision boundaries");
      if (!payload.followStaffDirection) missing.push("Follow staff direction");
      if (!payload.reportIncidents) missing.push("Report incidents declaration");
    }
  }
  if (phase === "file") {
    // filing fields checked separately in UI
  }
  return missing;
}

export function transportLabel(mode: TransportMode): string {
  switch (mode) {
    case "bus":
      return "YADA bus / run";
    case "self":
      return "Self / family";
    case "carer":
      return "Carer drop-off / pickup";
    case "other":
      return "Other";
  }
}

/** Map UI transport mode to schedule lookup-ish codes used on floor. */
export function transportModeToScheduleCode(mode: TransportMode): string {
  switch (mode) {
    case "bus":
      return "TRN-BUS";
    case "self":
      return "TRN-SELF";
    case "carer":
      return "TRN-CARER";
    case "other":
      return "TRN-OTHER";
  }
}
