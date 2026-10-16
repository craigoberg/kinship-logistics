import type { HelpTopic } from "../types";

export const rightsVoiceTopic: HelpTopic = {
  id: "rights-voice",
  kind: "howto",
  title: "Rights & voice — complaints and feedback",
  summary:
    "Office and kiosk forms match the public website. A valid email is required unless the person is making an anonymous complaint.",
  keywords: [
    "rights",
    "voice",
    "complaint",
    "anonymous",
    "feedback",
    "compliment",
    "email",
    "public",
    "website",
  ],
  menus: ["rights_voice"],
  roles: "all",
  relatedIds: ["hub-three-streams", "governance-hub-issue", "client-support-plan"],
  steps: [
    {
      heading: "Same forms as the public site",
      body: "Rights & voice uses the same complaint, enquiry, feedback, compliment, and volunteer forms as yada.org.au. Each submit creates a Governance Hub ticket.",
    },
    {
      heading: "Email is required",
      body: "A valid email is required on every form. Feedback or a compliment can omit the name, but the email is still stored. The checkbox says a valid email is still required.",
    },
    {
      heading: "Anonymous complaint is the exception",
      body: "An anonymous complaint stores no name and no contact. That is the only form that can be sent without an email. Say that clearly if you are helping someone fill it in.",
    },
  ],
};
