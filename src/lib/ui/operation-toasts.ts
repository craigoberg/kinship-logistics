import { toast } from "sonner";

/** Standard success/error toasts — Governance Hub & manage dialogs (BL-060). */
export const operationToasts = {
  noteLogged: () =>
    toast.success("Note logged.", { description: "Timeline updated." }),
  issueDeferred: () =>
    toast.success("Issue deferred.", { description: "Moved to Awaiting tab." }),
  councilEscalated: () =>
    toast.success("Escalated to Council.", { description: "Moved to Awaiting tab." }),
  councilEscalatedMailto: () =>
    toast.success("Escalated to Council — opening your mail…", {
      description:
        "Edit and send from your mail app. Follow up with Hub notes as Council replies.",
    }),
  issueResolved: () =>
    toast.success("Issue resolved.", { description: "Removed from Active tab." }),
  escalationAcknowledged: () =>
    toast.success("Escalation acknowledged.", { description: "Operator handshake recorded." }),
  maintenanceDeferred: () =>
    toast.success("Item deferred.", { description: "Moved to Deferred tab." }),
  maintenanceInProgress: () =>
    toast.success("Work started.", { description: "Status set to In Progress." }),
  maintenanceResolved: () =>
    toast.success("Item resolved.", { description: "Marked complete in register." }),
  maintenanceClosed: () =>
    toast.success("Item closed.", { description: "Archived in maintenance history." }),
  maintenanceAdded: () =>
    toast.success("Maintenance item added.", { description: "Visible on Active tab." }),
  ticketResolved: () =>
    toast.success("Ticket resolved.", { description: "Removed from Active App tickets." }),
  ticketClosed: () =>
    toast.success("Ticket closed.", { description: "Archived in App tickets history." }),
  ticketOpenerMailto: (kind: "note" | "resolve" = "note") =>
    toast.success(
      kind === "resolve"
        ? "Ticket resolved — opening email to the opener…"
        : "Note logged — opening email to the opener…",
      { description: "Edit if you need to, then send." },
    ),
  ticketOpenerMailtoMissing: (openerName: string) =>
    toast.message("Saved in Hub — no email to open.", {
      description: `Add an email on ${openerName}'s staff record to send them updates from here.`,
    }),
  reviewStarted: (waitLabel?: string) =>
    toast.success("Review started.", {
      description: waitLabel
        ? `Office review began ${waitLabel} after logged.`
        : "Timeline updated.",
    }),
  complianceDeferred: () =>
    toast.success("Asset deferred.", { description: "Next action date set." }),
  complianceNoteLogged: () =>
    toast.success("Note logged.", { description: "Timeline updated." }),
  complianceResolved: () =>
    toast.success("Asset renewed.", { description: "Expiry updated and receipt logged." }),
  actionFailed: (message: string) =>
    toast.error("Action failed", { description: message }),
  resolutionFailed: (message: string) =>
    toast.error("Could not resolve", { description: message }),
  managerPinRequired: () =>
    toast.error("Manager PIN required", {
      description: "Sign in with a manager profile to resolve or escalate.",
    }),
};
