import type { HelpTopic } from "../types";

export const signInPinTopic: HelpTopic = {
  id: "sign-in-pin",
  kind: "howto",
  title: "Sign-in and PIN",
  summary:
    "How terminal login and action PINs work during Alpha — day profile vs step-up PIN.",
  keywords: [
    "login",
    "pin",
    "password",
    "auth",
    "sign in",
    "unlock",
    "operator",
    "coordinator",
  ],
  menus: ["auth", "dashboard"],
  roles: "all",
  relatedIds: ["red-verbal-consultation", "manifest-start-run"],
  steps: [
    {
      heading: "Open the app",
      body: "Go to Yada Connect on the tablet or browser. If you see the auth screen, complete day login first (email + password when that lane is enabled), then staff PIN when prompted.",
    },
    {
      heading: "Day profile (who is on the terminal)",
      body: "After PIN login, your name and role sit on the terminal as the active staff profile. Most screens use that profile for attribution (who opened the centre, who closed a run, who logged an issue).",
    },
    {
      heading: "Action / step-up PIN",
      body: "High-impact actions (Close Run, verbal RED sign-off, some Open/Close gates) ask for a PIN again in a Pin pad dialog. That can be your PIN or another authorised operator’s — it does not always mean logging out of the day session.",
    },
    {
      heading: "If a PIN is rejected",
      body: "Check you entered four digits, that the staff record has a PIN set in Personnel, and that Guardian PINs are not used for terminal login (guardians are drop-off verification only).",
    },
    {
      heading: "Switching operator",
      body: "Use Log out / sign-in again when a different staff member takes the tablet. Do not share PINs — each operator signs their own actions.",
    },
  ],
};
