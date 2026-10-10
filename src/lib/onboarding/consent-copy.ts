/** Plain-language consent / T&C blocks for ALPHA print packs (legal polish later). */

export const CLIENT_CONSENT_BLOCKS = [
  {
    key: "privacyCollection",
    title: "Consent for information collection",
    body: "I consent to Young Adults Disabled Association Inc (YADA) collecting, maintaining, storing and releasing information about the Client for the purposes of delivering supports and reporting under applicable Commonwealth / State disability arrangements and NDIS requirements.",
  },
  {
    key: "thirdPartySpeak",
    title: "Authorisation to speak with third parties",
    body: "I give permission to YADA to make enquiries and speak on the Client's behalf with NDIS-related personnel, medical professionals and other related parties regarding the Client's supports, health and safety.",
  },
  {
    key: "photoVideo",
    title: "Permission to use photograph / video",
    body: "I give permission for YADA to take photography/video of the Client for educational and/or promotional purposes in any media, including www.yada.org.au. I understand I may decline this consent without affecting access to supports.",
  },
  {
    key: "outingCommunity",
    title: "Outing / community access consent",
    body: "I consent to the Client participating in YADA day-centre and community outings / weekend trips as arranged, including travel by YADA transport where scheduled. Staff will follow the Client's care profile, allergies and IDDSI requirements.",
  },
  {
    key: "emergencyMedical",
    title: "Emergency medical treatment",
    body: "In a medical emergency, I authorise YADA staff to seek urgent medical / ambulance assistance for the Client and to share necessary medical information with emergency services and treating clinicians.",
  },
  {
    key: "rightsHandbook",
    title: "Rights, complaints and participant handbook",
    body: "I have been given (or offered) the YADA Participant Handbook. I understand the Client's rights, how to raise a complaint or compliment (including anonymously), and that choosing an advocate will not affect access to supports. I know I can ask staff to help use Rights & voice in YADA Connect or yada.org.au.",
  },
] as const;

export const STAFF_DECLARATION_BLOCKS = [
  {
    key: "codeOfConduct",
    title: "Code of conduct",
    body: "I agree to follow YADA's code of conduct, treat participants with dignity and respect, and act in line with NDIS Practice Standards and organisational policies.",
  },
  {
    key: "confidentiality",
    title: "Confidentiality & privacy",
    body: "I will keep participant and organisational information confidential and only share it as required for care, safety or lawful reporting.",
  },
  {
    key: "whs",
    title: "Work health & safety",
    body: "I will follow WHS directions, report hazards and incidents promptly, and use equipment safely.",
  },
  {
    key: "mandatoryReporting",
    title: "Mandatory reporting awareness",
    body: "I understand my obligations to report abuse, neglect, serious incidents and NDIS reportable incidents as required by law and YADA procedure.",
  },
  {
    key: "conflictOfInterest",
    title: "Conflict of interest",
    body: "I will declare any conflict of interest that could affect my work with YADA participants or decisions.",
  },
  {
    key: "declareCharges",
    title: "Screening & charges declaration",
    body: "I declare that I will immediately notify YADA of any change to my WWCC, NDIS Worker Screening status, or any charge / conviction that may affect my suitability to work with people with disability.",
  },
] as const;

export const VOLUNTEER_EXTRA_BLOCKS = [
  {
    key: "boundaries",
    title: "Volunteer boundaries",
    body: "I understand I work under staff supervision, will not give medication or make care decisions alone, and will maintain professional boundaries with participants and families.",
  },
  {
    key: "photoSelf",
    title: "Photo of volunteer (optional)",
    body: "I consent to YADA using photographs of me in volunteer recognition or promotional materials. I may decline without affecting my volunteer role.",
  },
] as const;

export const ACCOMPANYING_DECLARATION_BLOCKS = [
  {
    key: "acknowledgeBoundaries",
    title: "Supervision boundaries",
    body: "I acknowledge that when I accompany a Client at YADA, YADA staff retain duty of care for the Client. I am not a substitute for YADA support workers.",
  },
  {
    key: "followStaffDirection",
    title: "Follow staff direction",
    body: "I agree to follow reasonable directions from YADA staff regarding safety, routines, transport and group activities.",
  },
  {
    key: "reportIncidents",
    title: "Report incidents",
    body: "I will immediately report any incident, injury, allegation or concern about a participant to YADA staff on duty.",
  },
] as const;

export const SERVICE_SUMMARY =
  "YADA provides day-centre and community supports. This signed form is the paper evidence of the information held in YADA Connect. Reviews are due every 12 months, or sooner when circumstances change (health, contacts, transport, consents).";
