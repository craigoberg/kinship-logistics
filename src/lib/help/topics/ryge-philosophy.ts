import type { HelpTopic } from "../types";

export const rygePhilosophyTopic: HelpTopic = {
  id: "ryge-philosophy",
  kind: "howto",
  title: "RYGE philosophy — Green, Yellow, Red, Escalation",
  summary:
    "How the high-trust competency model uses RYGE: what each colour means, examples, and when Escalation (verbal manager consultation) applies.",
  keywords: [
    "ryge",
    "green",
    "yellow",
    "red",
    "escalation",
    "severity",
    "high trust",
    "competency",
    "workaround",
    "traffic light",
  ],
  menus: ["governance", "day", "event-deliver", "manifest", "red"],
  roles: "all",
  relatedIds: [
    "hub-three-streams",
    "deferral-across-ops",
    "red-verbal-consultation",
    "governance-hub-issue",
  ],
  steps: [
    {
      heading: "High-trust competency first",
      body: "Yada assumes trained, competent operators. The app does not micromanage every step when risk is low: empty mandated checklists mean high-trust 1-tap open; day close can finish when rolls/handover are done even before a clock deadline. Trust is earned by competency and receipts — every meaningful exception is still logged.",
    },
    {
      heading: "RYGE is the shared language",
      body: "Red / Yellow / Green / Escalation is the same traffic-light language on walk-arounds, Big Red, Hub cards, rolls, and compliance. Severity describes risk and what the system should do — not which Hub tab the item lives in (tabs are by topic: person vs asset vs expiry).",
    },
    {
      heading: "GREEN — low priority, still real work",
      body: "Examples: scuff or graffiti that can wait, a cosmetic dent, a minor notice that does not change today’s plan. Green is not “ignore forever” — it still needs follow-up in the Hub. A quiet day with no open issues means the operation is healthy; a Green ticket means “logged, low urgency.”",
    },
    {
      heading: "YELLOW — caution with a workaround",
      body: "Examples: wheelchair lift used with a documented manual workaround; late arrival still expected; cert or venue baseline inside a grace/defer window; meal SFH gap already Manager-approved. Yellow is logged immediately, stays visible, and usually does not hard-stop the shift while a safe workaround is in place. If the workaround fails, promote to RED.",
    },
    {
      heading: "RED — safety / structural stop",
      body: "Examples: cannot safely open the centre or venue; critical vehicle fault with no safe workaround; welfare situation that needs manager contact now; roll call breached past Red threshold. RED can hard-block Open Centre / Open location / Close Run paths until resolved, deferred with acceptance, or covered by an accepted verbal workaround.",
    },
    {
      heading: "Escalation — talk to a manager, then receipt it",
      body: "Escalation is the high-trust path for RED (and some Red roll breaches): you speak with a manager by name, agree a plan, and sign with your operator PIN. The Hub gets a [VERBAL WORKAROUND] / issue for the manager to confirm later. That is not the old multi-device lock screen — it is asynchronous verbal consultation plus ledger proof. Council email escalate is a separate office path for council-facing matters.",
    },
    {
      heading: "Choose severity honestly",
      body: "If people or the run are unsafe without a manager decision → RED. If you can continue safely with a clear workaround → YELLOW. If it is a low-urgency defect or note → GREEN. When unsure between Yellow and Red, prefer the path that gets a manager eyes-on sooner.",
    },
  ],
};
