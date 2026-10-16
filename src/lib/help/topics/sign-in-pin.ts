import type { HelpTopic } from "../types";

export const signInPinTopic: HelpTopic = {
  id: "sign-in-pin",
  kind: "howto",
  title: "Sign-in and PIN",
  summary:
    "Everyone signs in with a PIN. A manager PIN then asks for that person's email and password.",
  keywords: [
    "login",
    "pin",
    "password",
    "auth",
    "sign in",
    "unlock",
    "manager",
    "carer",
  ],
  menus: ["auth", "dashboard"],
  roles: "all",
  relatedIds: ["red-verbal-consultation", "manifest-start-run"],
  steps: [
    {
      heading: "PIN first",
      body: "Everyone enters their PIN on the sign-in screen. Drivers, support workers, volunteers, and carers are signed in as themselves. A 4-digit PIN works once, then you choose a 6-digit PIN.",
    },
    {
      heading: "Manager confirm",
      body: "If the PIN belongs to a manager or assistant manager, the next screen asks for that person's email and password. Another person's login is rejected.",
    },
    {
      heading: "Change PIN",
      body: "Use Change PIN at the top of the screen, or on the idle lock. Enter the current PIN, then the new 6-digit PIN twice. A manager can set or unlock a PIN on the staff or carer form.",
    },
    {
      heading: "Action PIN",
      body: "Close run, medication witness, and similar actions can ask for a named person's PIN. That signs the action. It does not log you out or log someone else in.",
    },
    {
      heading: "If a PIN is rejected",
      body: "After too many tries on a known person, a manager must unlock the PIN. Too many wrong codes on the pad sleep that tablet for a short time. Guardian PINs are not a sign-in. Use Log out when someone else takes the tablet.",
    },
  ],
};
