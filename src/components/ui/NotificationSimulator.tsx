/**
 * NotificationSimulator
 *
 * Dev-mode UI overlay that listens for `triggerInspectionAlert` events and
 * surfaces mock SMS / Email dispatches so operators can verify routing
 * behaviour before the real channels are wired up.
 *
 *   Sev 1 (critical_no_go)      → centred smartphone-styled modal (SMS preview)
 *   Sev 2 (conditional_warning) → corner toast (email preview)
 *   Sev 3 (minor_log_only)      → no UI; logged silently by the router
 */

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Mail, Phone, X } from "lucide-react";
import {
  useInspectionAlertListener,
  type InspectionAlertPayload,
} from "@/hooks/use-notification-router";
import { ClientTime } from "@/components/ui/client-time";


export function NotificationSimulator() {
  const [smsModal, setSmsModal] = useState<InspectionAlertPayload | null>(null);

  const handle = useCallback((payload: InspectionAlertPayload) => {
    if (payload.channel === "sms") {
      setSmsModal(payload);
      return;
    }
    if (payload.channel === "email") {
      toast(
        <div className="flex flex-col gap-1 text-xs">
          <div className="flex items-center gap-1.5 font-bold text-amber-700 dark:text-amber-300">
            <Mail className="h-3.5 w-3.5" /> 📧 MOCK EMAIL DISPATCHED
          </div>
          <div>
            <span className="font-semibold">TO:</span> {payload.recipient}
          </div>
          {payload.subject && (
            <div>
              <span className="font-semibold">SUBJECT:</span> {payload.subject}
            </div>
          )}
          <div className="mt-1 whitespace-pre-wrap text-muted-foreground">
            {payload.body}
          </div>
        </div>,
        {
          duration: 12_000,
          className: "border-amber-500/60 bg-amber-50 dark:bg-amber-950/40",
        },
      );
    }
  }, []);

  useInspectionAlertListener(handle);

  if (!smsModal) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Mock SMS dispatch preview"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={() => setSmsModal(null)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-[320px] rounded-[2.25rem] border-[10px] border-neutral-900 bg-neutral-950 p-3 shadow-2xl"
      >
        {/* Notch */}
        <div className="mx-auto mb-2 h-1.5 w-16 rounded-full bg-neutral-700" />

        <button
          type="button"
          onClick={() => setSmsModal(null)}
          className="absolute right-3 top-3 z-10 rounded-full bg-neutral-800 p-1 text-neutral-300 hover:bg-neutral-700"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <div className="rounded-2xl bg-neutral-100 p-3 text-neutral-900 dark:bg-neutral-100">
          <div className="mb-2 flex items-center gap-1.5 border-b border-neutral-300 pb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            <Phone className="h-3 w-3" /> Messages
          </div>
          <div className="text-[11px] text-neutral-500">
            💬 MOCK SMS SENT TO:
          </div>
          <div className="mb-3 text-xs font-bold text-neutral-800">
            {smsModal.recipient}
          </div>

          <div className="rounded-2xl rounded-tl-sm bg-red-600 px-3 py-2 text-[13px] leading-snug text-white shadow">
            {smsModal.body}
          </div>

          <div className="mt-2 text-right text-[10px] text-neutral-400">
            <ClientTime
              iso={smsModal.dispatchedAt}
              options={{ hour: "2-digit", minute: "2-digit" }}
            />
          </div>

        </div>

        <button
          type="button"
          onClick={() => setSmsModal(null)}
          className="mt-3 w-full rounded-xl bg-red-600 py-2 text-sm font-bold text-white hover:bg-red-700"
        >
          Acknowledge Critical Alert
        </button>
      </div>
    </div>
  );
}

export default NotificationSimulator;
