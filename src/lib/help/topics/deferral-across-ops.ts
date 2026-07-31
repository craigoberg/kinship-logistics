import type { HelpTopic } from "../types";

export const deferralAcrossOpsTopic: HelpTopic = {
  id: "deferral-across-ops",
  kind: "howto",
  title: "Defer — Hub, check-ins, and rolls",
  summary:
    "What Defer means in high-trust ops: park work to a next-action time without pretending the issue is gone — Hub, Day Centre arrivals, and event roll calls.",
  keywords: [
    "defer",
    "deferred",
    "deferred until",
    "next action",
    "check-in",
    "bulk defer",
    "roll call",
    "grace",
    "sla",
  ],
  menus: ["governance", "day", "event-deliver"],
  roles: ["manager", "assistant_manager", "support_worker", "driver"],
  relatedIds: [
    "ryge-philosophy",
    "hub-three-streams",
    "governance-hub-issue",
    "day-centre-happy-path",
    "event-deliver-happy-path",
  ],
  steps: [
    {
      heading: "Philosophy — delay with accountability",
      body: "Defer is not “dismiss.” It means: we still own this, but the next meaningful action is at a stated time. High-trust competency allows competent staff to push a clock or park Hub work when continuing safely — with a reason, a deadline, and a receipt.",
    },
    {
      heading: "Hub — Defer / Set next action date",
      body: "In Manage issue (Human or Maintenance), tick Defer / Set next action date, choose when, and record the defer reason / next action. Status becomes Deferred; the item leaves the hot Active focus until deferred_until is due, then resurfaces. Repeat deferrals are counted. Log Note without defer just adds timeline text.",
    },
    {
      heading: "What Hub defer does and does not do",
      body: "Defer can clear some Open Centre / open-location RED blockers when the Hub status is deferred (or an accepted workaround exists) — it does not delete the risk. SLA / urgency badges pause while the defer deadline is in the future, then show action-due / overdue if nobody acts after the deadline.",
    },
    {
      heading: "Day Centre check-in — push expected arrival",
      body: "On the attendance roll, operators can defer a person’s (or a bulk group’s) expected_arrival_at — e.g. bus running late. That moves the Yellow/Red late clock forward. Yellows may auto-clear when the new time is still in the future. Use when the person is still coming; do not use defer instead of marking Absent with a real disposition.",
    },
    {
      heading: "Event rolls — Deferred until",
      body: "Morning / evening accountability: when overdue, use roll deferral (PIN on Yellow; verbal consultation path on Red) to push Deferred until for one person or all outstanding. Banners use the pushed time — quiet grace until then, then Yellow, then Red after Admin red minutes. Late return on the bus: defer rather than forcing hotel “Accounted” while still en route.",
    },
    {
      heading: "Compliance / venue baseline grace",
      body: "Venue safety baseline and some compliance items can use a short deferral/grace window (amber warning) so planning can continue — that is office defer of a renewal, not the same control as Hub issue Defer, but the idea matches: temporary acceptance with a dated next review.",
    },
    {
      heading: "When not to defer",
      body: "Do not defer instead of resolving a situation that is unsafe right now. Do not defer forever without a next action. If people are missing and you have a safety plan, use Absent / Left trip disposition — not an endless arrival defer.",
    },
  ],
};
